import { describe, expect, it } from 'vitest';
import { bezierLength, bezierPoint, processStroke, widthAt, type InputPoint } from '@signflow/core';
import { indexSegments, sliceSegments, sliceStroke } from '../src/slice';

const wavy = (() => {
  const points: InputPoint[] = Array.from({ length: 121 }, (_, i) => ({
    x: 20 + i * 4,
    y: 100 + Math.sin(i / 7) * 40,
    t: i * 8,
    pressure: 0.5,
  }));
  return processStroke({ id: 's', pointerKind: 'mouse', points });
})();

const len = (segs: readonly { p0: any; p1: any; p2: any; p3: any }[]) => segs.reduce((s, b) => s + bezierLength(b), 0);

describe('sliceSegments', () => {
  const idx = indexSegments(wavy.segments);

  it('indexes the total length', () => {
    expect(idx.total).toBeCloseTo(wavy.length, 1);
  });

  it('returns exactly the requested stretch of arc length', () => {
    for (const [a, b] of [[0, 50], [37, 160], [120.5, 121.5], [idx.total - 40, idx.total]]) {
      expect(len(sliceSegments(idx, a, b))).toBeCloseTo(b - a, 1);
    }
  });

  it('produces a contiguous chain that starts and ends where asked', () => {
    const segs = sliceSegments(idx, 33, 210);
    for (let i = 0; i < segs.length - 1; i++) {
      expect(segs[i].p3.x).toBeCloseTo(segs[i + 1].p0.x, 6);
      expect(segs[i].p3.y).toBeCloseTo(segs[i + 1].p0.y, 6);
    }
    const whole = sliceSegments(idx, 0, idx.total);
    expect(whole[0].p0).toEqual(wavy.segments[0].p0);
    const end = whole[whole.length - 1].p3;
    const want = wavy.segments[wavy.segments.length - 1].p3;
    expect(end.x).toBeCloseTo(want.x, 6);
    expect(end.y).toBeCloseTo(want.y, 6);
  });

  it('slices of the same curve reassemble into it (point on a slice lies on the original)', () => {
    const [seg] = sliceSegments(idx, 10, 11);
    const p = bezierPoint(seg, 0.5);
    let best = Infinity;
    for (const s of wavy.segments) for (let i = 0; i <= 200; i++) { const q = bezierPoint(s, i / 200); best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y)); }
    expect(best).toBeLessThan(0.05);
  });

  it('returns nothing for an empty range', () => {
    expect(sliceSegments(idx, 50, 50)).toEqual([]);
    expect(sliceSegments(idx, 50, 10)).toEqual([]);
  });
});

describe('sliceStroke', () => {
  const idx = indexSegments(wavy.segments);
  const L = idx.total;

  it('keeps the exact thickness of the whole stroke at every point', () => {
    const [from, to] = [L * 0.3, L * 0.6];
    const s = sliceStroke(wavy, idx, from, to);
    for (const u of [0, 0.2, 0.5, 0.8, 1]) {
      const global = (from + u * (to - from)) / L;
      expect(widthAt(s.widthProfile, u)).toBeCloseTo(widthAt(wavy.widthProfile, global), 2);
    }
  });

  it('reports the slice length and is never a dot', () => {
    const s = sliceStroke(wavy, idx, 20, 90);
    expect(s.length).toBeCloseTo(70, 6);
    expect(s.isDot).toBe(false);
  });

  it('a slice covering everything has the same profile as the stroke', () => {
    const s = sliceStroke(wavy, idx, 0, L);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) expect(widthAt(s.widthProfile, u)).toBeCloseTo(widthAt(wavy.widthProfile, u), 6);
  });
});
