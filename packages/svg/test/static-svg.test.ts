import { describe, expect, it } from 'vitest';
import { processStroke, type InputPoint, type RawStroke, type Stroke } from '@signflow/core';
import { buildStaticSvg, escapeXml, sanitizeColor } from '../src';

function line(x0: number, y0: number, x1: number, y1: number, id: string): Stroke {
  const n = 40;
  const points: InputPoint[] = Array.from({ length: n + 1 }, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / n,
    y: y0 + ((y1 - y0) * i) / n + Math.sin(i / 3) * 6,
    t: i * 8,
    pressure: 0.5,
  }));
  const raw: RawStroke = { id, pointerKind: 'mouse', points };
  return processStroke(raw);
}
const dot = (x: number, y: number) => processStroke({ id: 'd', pointerKind: 'mouse', points: [{ x, y, t: 0, pressure: 0.5 }] });

const strokes = [line(100, 100, 400, 140, 'a'), line(120, 220, 360, 200, 'b')];
const base = { strokes, width: 960, height: 420, strokeWidth: 5 };

describe('buildStaticSvg', () => {
  it('produces a standalone SVG: namespace, viewBox, no scripts or external references', () => {
    const { svg } = buildStaticSvg(base);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 960 420"');
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toMatch(/<script|href=|url\(|<image|<foreignObject|onload|javascript:/i);
  });

  it('is transparent by default and only adds a background when asked', () => {
    expect(buildStaticSvg(base).svg).not.toContain('<rect');
    expect(buildStaticSvg({ ...base, background: '#ffffff' }).svg).toContain('<rect');
  });

  it('keeps one path per stroke, in drawing order', () => {
    const { svg } = buildStaticSvg(base);
    const ds = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    expect(ds).toHaveLength(2);
    // Outlines start at the first stroke's start cap, so the first path stays near stroke a's start.
    const first = ds[0].match(/^M(-?[\d.]+) (-?[\d.]+)/)!;
    expect(Math.abs(+first[1] - 100)).toBeLessThan(10);
    const second = ds[1].match(/^M(-?[\d.]+) (-?[\d.]+)/)!;
    expect(Math.abs(+second[1] - 120)).toBeLessThan(10);
  });

  it('only emits legal path data', () => {
    const { svg } = buildStaticSvg(base);
    for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
      expect(m[1]).toMatch(/^[MCLhZ0-9.\-\s]+$/);
      expect(m[1]).not.toMatch(/NaN|Infinity/);
    }
  });

  it('variable mode fills outlines; constant mode strokes the centre line with round caps', () => {
    const v = buildStaticSvg({ ...base, variableWidth: true, color: '#112233' }).svg;
    expect(v).toContain('<g fill="#112233">');
    expect(v).not.toContain('stroke-width');
    expect(v.match(/Z"/g)).toHaveLength(2);

    const c = buildStaticSvg({ ...base, variableWidth: false, color: '#112233' }).svg;
    expect(c).toContain('fill="none" stroke="#112233" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"');
    expect(c).not.toContain('Z"');
  });

  it('renders a tap as a zero-length round-cap path in constant mode and a filled circle in variable mode', () => {
    expect(buildStaticSvg({ ...base, strokes: [dot(50, 60)], variableWidth: false }).svg).toContain('M50 60h0');
    expect(buildStaticSvg({ ...base, strokes: [dot(50, 60)], variableWidth: true }).svg).toMatch(/<path d="M[^"]+Z"/);
  });

  it('crops the viewBox to the ink plus padding', () => {
    const full = buildStaticSvg(base);
    const cropped = buildStaticSvg({ ...base, crop: true, padding: 10 });
    expect(cropped.viewBox.width).toBeLessThan(full.viewBox.width);
    expect(cropped.viewBox.height).toBeLessThan(full.viewBox.height);
    // ink spans x≈100..400: the box must contain it with ≥ padding on the left.
    expect(cropped.viewBox.x).toBeLessThanOrEqual(100 - 10 + 3);
    expect(cropped.viewBox.x).toBeGreaterThan(60);
    expect(cropped.viewBox.x + cropped.viewBox.width).toBeGreaterThanOrEqual(400 + 10 - 6);
    // No ink may fall outside the viewBox.
    const nums = [...cropped.svg.matchAll(/ d="([^"]+)"/g)].flatMap((m) => m[1].match(/-?[\d.]+/g)!.map(Number));
    expect(nums.length).toBeGreaterThan(20);
  });

  it('crop keeps every outline point inside the viewBox', () => {
    const { svg, viewBox } = buildStaticSvg({ ...base, crop: true, padding: 0, strokeWidth: 14 });
    for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
      const n = m[1].replace(/[A-Za-z]/g, ' ').trim().split(/\s+/).map(Number);
      for (let i = 0; i < n.length; i += 2) {
        // Control points can lie slightly outside the curve, on-curve points may not.
        expect(n[i]).toBeGreaterThan(viewBox.x - 12);
        expect(n[i]).toBeLessThan(viewBox.x + viewBox.width + 12);
      }
    }
  });

  it('scales output size while preserving the aspect ratio', () => {
    const r = buildStaticSvg({ ...base, crop: true, outputWidth: 600 });
    expect(r.width).toBe(600);
    expect(r.height).toBeCloseTo((600 * r.viewBox.height) / r.viewBox.width, 6);
    expect(r.svg).toContain('width="600"');
  });

  it('falls back to the full canvas for an empty drawing', () => {
    const r = buildStaticSvg({ ...base, strokes: [], crop: true });
    expect(r.viewBox).toEqual({ x: 0, y: 0, width: 960, height: 420 });
    expect(r.svg).toContain('<g fill="#000000"></g>');
  });

  it('sanitises hostile input', () => {
    const r = buildStaticSvg({
      ...base,
      color: 'red" onload="alert(1)',
      background: 'url(http://evil)',
      title: '</title><script>alert(1)</script>',
    });
    expect(r.svg).not.toMatch(/onload|<script|evil/i);
    expect(r.svg).toContain('&lt;/title&gt;');
    expect(r.svg).toContain('fill="#000000"');
  });

  it('survives non-finite numbers', () => {
    const r = buildStaticSvg({ ...base, width: NaN, height: Infinity, strokeWidth: NaN, outputWidth: NaN, padding: NaN, crop: true });
    expect(r.svg).not.toMatch(/NaN|Infinity/);
  });

  it('is compact', () => {
    expect(buildStaticSvg(base).svg.length).toBeLessThan(6000);
  });
});

describe('sanitize helpers', () => {
  it('accepts common colour forms', () => {
    for (const c of ['#fff', '#ffffff', '#ffffff80', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(10 20% 30%)', 'rebeccapurple', 'transparent']) {
      expect(sanitizeColor(c)).toBe(c);
    }
  });
  it('rejects anything else', () => {
    for (const c of ['#12', 'url(#x)', 'red;fill:blue', '"><x', '', 'rgb(1,2)', 'var(--x)']) expect(sanitizeColor(c, '#000')).toBe('#000');
  });
  it('escapes XML metacharacters', () => {
    expect(escapeXml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
  });
});
