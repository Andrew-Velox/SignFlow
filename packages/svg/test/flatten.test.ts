import { describe, expect, it } from 'vitest';
import { bezierPoint, lineToBezier, type CubicBezier, type Vec2 } from '@signflow/core';
import { flattenSegments, polylinePath } from '../src/flatten';

const dense = (segs: readonly CubicBezier[], n = 400): Vec2[] => segs.flatMap((s) => Array.from({ length: n + 1 }, (_, i) => bezierPoint(s, i / n)));
const distToPolyline = (p: Vec2, pl: readonly Vec2[]) => {
  let best = Infinity;
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1];
    const b = pl[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
};

const arc: CubicBezier = { p0: { x: 0, y: 0 }, p1: { x: 0, y: 40 }, p2: { x: 60, y: 40 }, p3: { x: 60, y: 0 } };
// A loop: the end point coincides with the start, the control points are far away (the chord is a point).
const loop: CubicBezier = { p0: { x: 10, y: 10 }, p1: { x: 40, y: -20 }, p2: { x: 40, y: 40 }, p3: { x: 10, y: 10 } };
// A hairpin: goes out and straight back.
const hairpin: CubicBezier = { p0: { x: 0, y: 0 }, p1: { x: 50, y: 4 }, p2: { x: 50, y: -4 }, p3: { x: 0, y: 0 } };

describe('flattenSegments', () => {
  it('stays within the tolerance of the curve, for gentle arcs, loops and hairpins', () => {
    for (const [name, c] of [['arc', arc], ['loop', loop], ['hairpin', hairpin]] as const) {
      const pl = flattenSegments([c], 0.1);
      for (const p of dense([c])) expect(distToPolyline(p, pl), name).toBeLessThan(0.1 + 1e-6);
      for (const q of pl) expect(distToPolyline(q, dense([c], 2000)), name).toBeLessThan(0.01); // vertices lie on the curve
    }
  });

  it('keeps the end points exactly', () => {
    const pl = flattenSegments([arc], 0.1);
    expect(pl[0]).toEqual({ x: 0, y: 0 });
    expect(pl[pl.length - 1]).toEqual({ x: 60, y: 0 });
  });

  it('subdivides loops and hairpins even though their chord is (almost) a point', () => {
    expect(flattenSegments([loop], 0.1).length).toBeGreaterThan(8);
    expect(flattenSegments([hairpin], 0.1).length).toBeGreaterThan(8);
  });

  it('turns a straight line into just its two end points', () => {
    expect(flattenSegments([lineToBezier({ x: 0, y: 0 }, { x: 50, y: 20 })], 0.1)).toHaveLength(2);
  });

  it('is compact on gentle curves', () => {
    expect(flattenSegments([arc], 0.1).length).toBeLessThan(40);
  });

  it('copes with nothing and with a fully collapsed curve', () => {
    expect(flattenSegments([], 0.1)).toEqual([]);
    const p = { x: 3, y: 4 };
    expect(flattenSegments([{ p0: p, p1: p, p2: p, p3: p }], 0.1).length).toBeGreaterThanOrEqual(1);
  });
});

describe('polylinePath', () => {
  it('emits M then L only, rounded', () => {
    const { d } = polylinePath([{ x: 0.004, y: 0 }, { x: 10.126, y: 5 }, { x: 20, y: 5.555 }], 2);
    expect(d).toBe('M0 0L10.13 5L20 5.56');
  });

  it('reports the exact length of the ROUNDED polyline (what the browser will measure)', () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ x: i * 1.0049, y: Math.sin(i / 9) * 7.0031 }));
    const { d, length } = polylinePath(pts, 2);
    const nums = d.replace(/[ML]/g, ' ').trim().split(/\s+/).map(Number);
    let l = 0;
    for (let i = 2; i < nums.length; i += 2) l += Math.hypot(nums[i] - nums[i - 2], nums[i + 1] - nums[i - 1]);
    expect(length).toBeCloseTo(l, 9);
  });

  it('drops repeated points', () => {
    expect(polylinePath([{ x: 1, y: 1 }, { x: 1.001, y: 1.001 }, { x: 5, y: 5 }], 2).d).toBe('M1 1L5 5');
  });
});
