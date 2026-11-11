import { describe, expect, it } from 'vitest';
import { processStroke, type InputPoint, type Stroke } from '@signflow/core';
import { buildAnimatedSvg, buildTimeline, easingInverse, resolveAnimation, sanitizeEasing, DOT_MS, MIN_STROKE_MS } from '../src';

function line(x0: number, y0: number, x1: number, y1: number, id: string, n = 40): Stroke {
  const points: InputPoint[] = Array.from({ length: n + 1 }, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / n,
    y: y0 + ((y1 - y0) * i) / n + Math.sin(i / 3) * 6,
    t: i * 8,
    pressure: 0.5,
  }));
  return processStroke({ id, pointerKind: 'mouse', points });
}
const dot = (x: number, y: number) => processStroke({ id: 'd', pointerKind: 'mouse', points: [{ x, y, t: 0, pressure: 0.5 }] });

const long = line(100, 100, 500, 140, 'a');
const short = line(120, 220, 220, 200, 'b', 20);
const strokes = [long, short, dot(300, 60)];
const base = { strokes, width: 960, height: 420, strokeWidth: 5 };

describe('buildTimeline', () => {
  const opts = resolveAnimation({ duration: 2000, strokeDelay: 200, startDelay: 100 });

  it('keeps strokes in order and never overlaps them', () => {
    const t = buildTimeline([300, 100, 0], opts);
    expect(t.starts[0]).toBe(100);
    for (let i = 0; i < 3; i++) expect(t.ends[i]).toBeGreaterThan(t.starts[i]);
    for (let i = 1; i < 3; i++) expect(t.starts[i] - t.ends[i - 1]).toBeCloseTo(200, 9);
  });

  it('shares the drawing time in proportion to length (constant pen speed)', () => {
    const t = buildTimeline([300, 100], opts);
    expect((t.ends[0] - t.starts[0]) / (t.ends[1] - t.starts[1])).toBeCloseTo(3, 6);
    expect(t.ends[0] - t.starts[0] + (t.ends[1] - t.starts[1])).toBeCloseTo(2000, 6);
  });

  it('gives tiny strokes a minimum duration and dots a short one', () => {
    const t = buildTimeline([1000, 1, 0], opts);
    expect(t.ends[1] - t.starts[1]).toBe(MIN_STROKE_MS);
    expect(t.ends[2] - t.starts[2]).toBe(DOT_MS);
  });

  it('adds the hold only when looping', () => {
    const once = buildTimeline([100], resolveAnimation({ loop: false, holdAfter: 900 }));
    const loop = buildTimeline([100], resolveAnimation({ loop: true, holdAfter: 900 }));
    expect(loop.cycle - once.cycle).toBe(900);
    expect(once.cycle).toBe(once.ends[0]);
  });

  it('handles a drawing made only of dots', () => {
    const t = buildTimeline([0, 0], opts);
    expect(t.cycle).toBeGreaterThan(0);
    expect(t.starts[1]).toBeGreaterThan(t.ends[0]);
  });
});

describe('easing sanitisation', () => {
  it('accepts keywords and valid cubic-beziers', () => {
    for (const e of ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']) expect(sanitizeEasing(e)).toBe(e);
    expect(sanitizeEasing('cubic-bezier(0.4, 0, 0.2, 1)')).toBe('cubic-bezier(0.4,0,0.2,1)');
  });
  it('rejects anything that could break out of the CSS', () => {
    for (const e of ['red;}</style><script>', 'steps(4)', 'cubic-bezier(2,0,0,1)', 'url(x)', '']) expect(sanitizeEasing(e)).toBe('ease-in-out');
  });
});

describe('buildAnimatedSvg', () => {
  it('is a standalone SVG with CSS keyframes and no scripts or external references', () => {
    const { svg } = buildAnimatedSvg(base);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<style>');
    expect(svg).toContain('@keyframes sf-k0');
    expect(svg).not.toMatch(/<script|href=|<image|<foreignObject|onload|javascript:|@import|<animate/i);
    // Only same-document references (the masks).
    for (const m of svg.matchAll(/url\(([^)]*)\)/g)) expect(m[1]).toMatch(/^#sf-m\d+(-\d+)?$/);
  });

  it('starts strokes in the original order', () => {
    const r = buildAnimatedSvg({ ...base, variableWidth: false });
    for (let i = 1; i < 3; i++) expect(r.timeline.starts[i]).toBeGreaterThan(r.timeline.ends[i - 1]);
    // The keyframe start percentages in the file follow the same order.
    const pct = (i: number) => +r.svg.match(new RegExp(`@keyframes sf-k${i}\\{(?:0%\\{[^}]*\\})?([\\d.]+)%\\{`))![1];
    expect(pct(1)).toBeGreaterThan(pct(0));
  });

  it('the finished signature is the default state: no hidden offset outside the keyframes', () => {
    const { svg } = buildAnimatedSvg(base);
    const withoutKeyframes = svg.replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^}]*\})*\}/g, '');
    expect(withoutKeyframes).not.toMatch(/stroke-dashoffset/);
    expect(withoutKeyframes).not.toMatch(/opacity:0/);
  });

  it('respects prefers-reduced-motion', () => {
    expect(buildAnimatedSvg(base).svg).toContain('@media (prefers-reduced-motion:reduce)');
  });

  it('variable width: outlines are revealed through masks that hold the animated centre line', () => {
    const { svg } = buildAnimatedSvg({ ...base, variableWidth: true });
    expect(svg.match(/<mask /g)!.length).toBeGreaterThanOrEqual(2); // at least one per stroke; the dot has none
    expect(svg).toContain('mask="url(#sf-m0-0)"');
    expect(svg).toMatch(/<mask id="sf-m0-0"[^>]*><path class="sf-a0-0"[^>]*stroke="#fff"/);
    expect(svg).not.toMatch(/stroke-linecap/); // butt caps in the mask: the reveal edge is a clean cut
  });

  it('constant width: the stroke itself is animated, with round caps', () => {
    const { svg } = buildAnimatedSvg({ ...base, variableWidth: false });
    expect(svg).not.toContain('<mask');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toMatch(/<path class="sf-a0" d="M/);
  });

  it('dash geometry hides the stroke completely at the start and shows it completely at the end', () => {
    const { svg } = buildAnimatedSvg({ ...base, variableWidth: false });
    const rule = svg.match(/\.sf-a0\{stroke-dasharray:([\d.]+) ([\d.]+);/)!;
    const dash = +rule[1];
    const gap = +rule[2];
    const hidden = +svg.match(/@keyframes sf-k0\{(?:0%\{stroke-dashoffset:([\d.]+)\})/)![1];
    expect(dash).toBeGreaterThanOrEqual(long.length); // the dash covers the whole path at offset 0
    expect(hidden).toBeGreaterThan(long.length); // pushed fully into the gap
    expect(gap).toBeGreaterThan(long.length + 2); // the next dash starts beyond the path end: no dot at the end
    expect(hidden - dash).toBeGreaterThan(1); // the dash that precedes the path ends before it: no cap dot at the start
  });

  it('loops forever only when asked, and all strokes share one cycle length', () => {
    const once = buildAnimatedSvg(base).svg;
    const loop = buildAnimatedSvg({ ...base, loop: true }).svg;
    expect(once).toMatch(/linear 1 both/);
    expect(once).not.toContain('infinite');
    expect(loop).toContain('infinite');
    const cycles = new Set([...loop.matchAll(/animation:sf-k\d+ (\d+)ms/g)].map((m) => m[1]));
    expect(cycles.size).toBe(1);
  });

  it('constant width: the requested easing is applied inside the stroke keyframes', () => {
    const c = { ...base, variableWidth: false };
    expect(buildAnimatedSvg({ ...c, easing: 'linear' }).svg).toContain('animation-timing-function:linear');
    expect(buildAnimatedSvg({ ...c, easing: 'bad;}' }).svg).toContain('animation-timing-function:ease-in-out');
  });

  it('total drawing time follows the duration option', () => {
    const r = buildAnimatedSvg({ ...base, duration: 4000, strokeDelay: 0, startDelay: 0 });
    const drawn = r.timeline.ends.map((e, i) => e - r.timeline.starts[i]).reduce((a, b) => a + b, 0);
    expect(drawn).toBeGreaterThan(4000);
    expect(drawn).toBeLessThan(4000 + 2 * MIN_STROKE_MS + DOT_MS + 1);
  });

  it('a dot is revealed with an opacity step', () => {
    const { svg } = buildAnimatedSvg(base);
    expect(svg).toMatch(/@keyframes sf-k2\{0%,[\d.]+%\{opacity:0\}[\d.]+%,100%\{opacity:1\}\}/);
  });

  it('works with no strokes, crop and output size like the static export', () => {
    const empty = buildAnimatedSvg({ ...base, strokes: [] });
    expect(empty.svg).toContain('<g fill="#000000"></g>');
    const r = buildAnimatedSvg({ ...base, crop: true, outputWidth: 500 });
    expect(r.width).toBe(500);
    expect(r.viewBox.width).toBeLessThan(960);
  });

  it('sanitises hostile input exactly like the static export', () => {
    const r = buildAnimatedSvg({ ...base, color: 'red" onload="x', title: '<script>', background: 'url(http://evil)' });
    expect(r.svg).not.toMatch(/onload|<script|evil/i);
  });

  it('survives non-finite options', () => {
    const r = buildAnimatedSvg({ ...base, duration: NaN, strokeDelay: Infinity, startDelay: -5, easing: undefined });
    expect(r.svg).not.toMatch(/NaN|Infinity|undefined/);
  });
});

/** (start %, end %) of every slice of stroke `i`, from the keyframes in the file. */
function slices(svg: string, i: number): [number, number][] {
  const out: [number, number][] = [];
  for (const m of svg.matchAll(new RegExp(`@keyframes sf-k${i}-(\\d+)\\{(?:0%\\{[^}]*\\})?([\\d.]+)%\\{[^}]*\\}([\\d.]+)%\\{`, 'g'))) out[+m[1]] = [+m[2], +m[3]];
  return out;
}

describe('variable width reveals slice by slice (no ink ahead of the pen)', () => {
  const v = { ...base, variableWidth: true, easing: 'linear' };

  it('cuts a long stroke into several slices, each with its own mask, and a short one into one', () => {
    const { svg } = buildAnimatedSvg(v);
    expect(slices(svg, 0).length).toBeGreaterThan(3);
    expect(svg).toMatch(/<mask id="sf-m0-0">/);
    expect(svg).toMatch(/<mask id="sf-m0-1">/);
    const tiny = line(100, 100, 130, 105, 't', 8);
    expect(buildAnimatedSvg({ ...v, strokes: [tiny] }).svg).toMatch(/<mask id="sf-m0">/); // one slice: unsuffixed
  });

  it('pairs every outline with exactly its own mask', () => {
    const { svg } = buildAnimatedSvg(v);
    const used = [...svg.matchAll(/mask="url\(#(sf-m[\d-]+)\)"/g)].map((m) => m[1]);
    const defined = [...svg.matchAll(/<mask id="(sf-m[\d-]+)"/g)].map((m) => m[1]);
    expect(new Set(used).size).toBe(used.length); // no mask shared between two outlines
    expect(used.sort()).toEqual(defined.sort());
  });

  it('slices are revealed in path order, back to back, covering the whole stroke time', () => {
    const r = buildAnimatedSvg(v);
    const sl = slices(r.svg, 0);
    for (let k = 1; k < sl.length; k++) expect(sl[k][0]).toBeGreaterThanOrEqual(sl[k - 1][0] - 1e-6);
    for (const [a, b] of sl) expect(b).toBeGreaterThanOrEqual(a);
    const pct = (ms: number) => (ms / r.cycle) * 100;
    expect(sl[0][0]).toBeCloseTo(pct(r.timeline.starts[0]), 2);
    expect(sl[sl.length - 1][1]).toBeCloseTo(pct(r.timeline.ends[0]), 2);
  });

  it('under linear easing every interior slice takes about the same time; under ease-in-out the ends are slower', () => {
    const lin = slices(buildAnimatedSvg(v).svg, 0).map(([a, b]) => b - a);
    const mid = lin.slice(2, -2);
    expect(Math.max(...mid) / Math.min(...mid)).toBeLessThan(1.5);
    const eased = slices(buildAnimatedSvg({ ...v, easing: 'ease-in-out' }).svg, 0).map(([a, b]) => b - a);
    expect(eased[0]).toBeGreaterThan(eased[Math.floor(eased.length / 2)] * 1.3);
  });

  it('chunkLength: 0 restores a single mask per stroke', () => {
    const { svg } = buildAnimatedSvg({ ...v, chunkLength: 0 });
    expect(svg.match(/<mask /g)).toHaveLength(2);
    expect(svg).toContain('mask="url(#sf-m0)"');
  });

  it('the default (un-animated) state is still the full drawing', () => {
    const { svg } = buildAnimatedSvg(v);
    const noKeyframes = svg.replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^}]*\})*\}/g, '');
    expect(noKeyframes).not.toMatch(/stroke-dashoffset/);
  });
});

describe('easingInverse', () => {
  it('is the identity for linear and respects the bounds', () => {
    const f = easingInverse('linear');
    expect(f(0)).toBe(0);
    expect(f(0.3)).toBeCloseTo(0.3, 12);
    expect(f(1)).toBe(1);
    expect(f(-1)).toBe(0);
    expect(f(2)).toBe(1);
  });

  it('inverts the standard curves: monotonic, symmetric for ease-in-out, slow at the ends', () => {
    for (const e of ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(0.3,0.1,0.6,0.9)']) {
      const f = easingInverse(e);
      let prev = -1;
      for (let i = 0; i <= 20; i++) {
        const v = f(i / 20);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
    }
    expect(easingInverse('ease-in-out')(0.5)).toBeCloseTo(0.5, 6);
    // ease-in starts slowly, so the first 10 % of the path takes more than 10 % of the time.
    expect(easingInverse('ease-in')(0.1)).toBeGreaterThan(0.2);
  });

  it('only accepts monotonic custom curves', () => {
    expect(sanitizeEasing('cubic-bezier(0.4,2,0.2,1)')).toBe('ease-in-out');
    expect(sanitizeEasing('cubic-bezier(0.4,-1,0.2,1)')).toBe('ease-in-out');
    expect(sanitizeEasing('cubic-bezier(0.4,0.2,0.2,1)')).toBe('cubic-bezier(0.4,0.2,0.2,1)');
  });
});
