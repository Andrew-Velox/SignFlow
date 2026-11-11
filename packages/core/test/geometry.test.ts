import { describe, expect, it } from 'vitest';
import {
  bezierBounds,
  bezierDerivative,
  bezierLength,
  bezierPoint,
  bezierSecondDerivative,
  bezierTangent,
  catmullRomToBezier,
  cubicBSplineToBezier,
  formatNumber,
  lineToBezier,
  midpointSplineToBezier,
  segmentsToPathData,
  splitBezier,
  type CubicBezier,
} from '../src';

const K = 0.5522847498307936;
/** Quarter of a circle with radius r, centred on the origin, from (r,0) to (0,r). */
const quarter = (r: number): CubicBezier => ({
  p0: { x: r, y: 0 },
  p1: { x: r, y: K * r },
  p2: { x: K * r, y: r },
  p3: { x: 0, y: r },
});

describe('bezier', () => {
  it('interpolates the end points', () => {
    const b = quarter(10);
    expect(bezierPoint(b, 0)).toEqual(b.p0);
    expect(bezierPoint(b, 1)).toEqual(b.p3);
  });

  it('derivative matches a finite difference', () => {
    const b = quarter(37);
    for (const t of [0.1, 0.5, 0.83]) {
      const h = 1e-5;
      const a = bezierPoint(b, t - h);
      const c = bezierPoint(b, t + h);
      const d = bezierDerivative(b, t);
      expect(d.x).toBeCloseTo((c.x - a.x) / (2 * h), 3);
      expect(d.y).toBeCloseTo((c.y - a.y) / (2 * h), 3);
    }
  });

  it('second derivative matches a finite difference of the first', () => {
    const b = quarter(20);
    const h = 1e-5;
    const t = 0.4;
    const a = bezierDerivative(b, t - h);
    const c = bezierDerivative(b, t + h);
    const d = bezierSecondDerivative(b, t);
    expect(d.x).toBeCloseTo((c.x - a.x) / (2 * h), 2);
    expect(d.y).toBeCloseTo((c.y - a.y) / (2 * h), 2);
  });

  it('splitting reproduces the original curve', () => {
    const b = quarter(50);
    const [l, r] = splitBezier(b, 0.3);
    expect(l.p3).toEqual(r.p0);
    for (const t of [0, 0.25, 0.7, 1]) {
      const p = bezierPoint(l, t);
      const q = bezierPoint(b, 0.3 * t);
      expect(p.x).toBeCloseTo(q.x, 9);
      expect(p.y).toBeCloseTo(q.y, 9);
      const p2 = bezierPoint(r, t);
      const q2 = bezierPoint(b, 0.3 + 0.7 * t);
      expect(p2.x).toBeCloseTo(q2.x, 9);
      expect(p2.y).toBeCloseTo(q2.y, 9);
    }
  });

  it('measures arc length accurately', () => {
    expect(bezierLength(lineToBezier({ x: 0, y: 0 }, { x: 30, y: 40 }))).toBeCloseTo(50, 8);
    // Quarter circle: π·r/2, the cubic approximation is within ~0.03 %.
    expect(bezierLength(quarter(100))).toBeCloseTo((Math.PI * 100) / 2, 1);
  });

  it('computes exact bounds from curve extrema, not control points', () => {
    const b = quarter(10);
    const bb = bezierBounds(b);
    expect(bb.minX).toBeCloseTo(0, 9);
    expect(bb.maxX).toBeCloseTo(10, 9);
    expect(bb.minY).toBeCloseTo(0, 9);
    expect(bb.maxY).toBeCloseTo(10, 9);
    // A bulging curve whose extreme is interior.
    const arch: CubicBezier = { p0: { x: 0, y: 0 }, p1: { x: 0, y: 40 }, p2: { x: 10, y: 40 }, p3: { x: 10, y: 0 } };
    const ab = bezierBounds(arch);
    expect(ab.maxY).toBeCloseTo(30, 9); // 0.75 * 40
    expect(ab.minY).toBe(0);
  });

  it('falls back to the chord for degenerate tangents', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const t = bezierTangent({ p0: a, p1: a, p2: b, p3: b }, 0);
    expect(t.x).toBeCloseTo(1, 9);
    expect(bezierTangent({ p0: a, p1: a, p2: a, p3: a }, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('catmullRomToBezier', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 4 },
    { x: 22, y: 3 },
    { x: 31, y: 12 },
    { x: 33, y: 25 },
  ];

  it('passes through every input point', () => {
    const segs = catmullRomToBezier(pts);
    expect(segs).toHaveLength(pts.length - 1);
    segs.forEach((s, i) => {
      expect(s.p0).toEqual(pts[i]);
      expect(s.p3).toEqual(pts[i + 1]);
    });
  });

  it('is tangent-continuous (C1 direction) at the joins', () => {
    const segs = catmullRomToBezier(pts);
    for (let i = 0; i < segs.length - 1; i++) {
      const a = bezierTangent(segs[i], 1);
      const b = bezierTangent(segs[i + 1], 0);
      expect(a.x * b.x + a.y * b.y).toBeCloseTo(1, 6);
    }
  });

  it('alpha = 0 reduces to the classic uniform spline', () => {
    const segs = catmullRomToBezier(pts, 0);
    // Uniform CR: c1 = p1 + (p2 - p0) / 6
    expect(segs[1].p1.x).toBeCloseTo(pts[1].x + (pts[2].x - pts[0].x) / 6, 9);
    expect(segs[1].p1.y).toBeCloseTo(pts[1].y + (pts[2].y - pts[0].y) / 6, 9);
  });

  it('survives coincident points without NaN', () => {
    const segs = catmullRomToBezier([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }]);
    for (const s of segs) for (const p of [s.p0, s.p1, s.p2, s.p3]) expect(Number.isFinite(p.x + p.y)).toBe(true);
  });

  it('returns nothing for fewer than two points', () => {
    expect(catmullRomToBezier([])).toEqual([]);
    expect(catmullRomToBezier([{ x: 1, y: 1 }])).toEqual([]);
  });
});

describe('path data', () => {
  it('formats numbers compactly', () => {
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(2)).toBe('2');
    expect(formatNumber(-0.001)).toBe('0');
    expect(formatNumber(3.14159, 3)).toBe('3.142');
    expect(formatNumber(10)).toBe('10');
    expect(formatNumber(100)).toBe('100');
  });

  it('chains contiguous curves under a single C command', () => {
    const a = lineToBezier({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = lineToBezier({ x: 10, y: 0 }, { x: 10, y: 10 });
    const d = segmentsToPathData([a, b]);
    expect(d.startsWith('M0 0C')).toBe(true);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.match(/C/g)).toHaveLength(1);
  });

  it('starts a new subpath where the chain is broken', () => {
    const a = lineToBezier({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = lineToBezier({ x: 50, y: 0 }, { x: 60, y: 0 });
    expect(segmentsToPathData([a, b]).match(/M/g)).toHaveLength(2);
  });

  it('renders collapsed segments as zero-length dots', () => {
    const p = { x: 4, y: 5 };
    expect(segmentsToPathData([{ p0: p, p1: p, p2: p, p3: p }])).toBe('M4 5h0');
  });

  it('closes outlines', () => {
    const a = lineToBezier({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(segmentsToPathData([a], 2, true).endsWith('Z')).toBe(true);
    expect(segmentsToPathData([], 2, true)).toBe('');
  });
});

describe('midpointSplineToBezier', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 4 },
    { x: 22, y: 3 },
    { x: 31, y: 12 },
    { x: 33, y: 25 },
    { x: 40, y: 30 },
  ];

  it('starts and ends exactly on the first and last point, as a contiguous chain', () => {
    const segs = midpointSplineToBezier(pts);
    expect(segs[0].p0).toEqual(pts[0]);
    expect(segs[segs.length - 1].p3).toEqual(pts[pts.length - 1]);
    for (let i = 0; i < segs.length - 1; i++) {
      expect(segs[i].p3.x).toBeCloseTo(segs[i + 1].p0.x, 9);
      expect(segs[i].p3.y).toBeCloseTo(segs[i + 1].p0.y, 9);
    }
  });

  it('is tangent-continuous at every join', () => {
    const segs = midpointSplineToBezier(pts);
    for (let i = 0; i < segs.length - 1; i++) {
      const a = bezierTangent(segs[i], 1);
      const b = bezierTangent(segs[i + 1], 0);
      expect(a.x * b.x + a.y * b.y).toBeCloseTo(1, 6);
    }
  });

  it('approximates: it does not pass through interior points (that is what averages jitter out)', () => {
    const segs = midpointSplineToBezier(pts);
    const onCurve = segs.flatMap((s) => [s.p0, s.p3]);
    expect(onCurve.some((p) => p.x === pts[1].x && p.y === pts[1].y)).toBe(false);
  });

  it('appending a point only changes the last segment (no wobbling tail)', () => {
    const before = midpointSplineToBezier(pts.slice(0, 5));
    const after = midpointSplineToBezier(pts);
    for (let i = 0; i < before.length - 1; i++) expect(after[i]).toEqual(before[i]);
  });

  it('handles tiny inputs', () => {
    expect(midpointSplineToBezier([])).toEqual([]);
    expect(midpointSplineToBezier([{ x: 1, y: 1 }])).toEqual([]);
    expect(midpointSplineToBezier(pts.slice(0, 2))).toHaveLength(1);
  });
});

describe('cubicBSplineToBezier', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 4 },
    { x: 22, y: 3 },
    { x: 31, y: 12 },
    { x: 33, y: 25 },
    { x: 40, y: 30 },
    { x: 52, y: 28 },
  ];

  it('starts and ends exactly on the first and last point, as a contiguous chain', () => {
    const segs = cubicBSplineToBezier(pts);
    expect(segs[0].p0).toEqual(pts[0]);
    const end = segs[segs.length - 1].p3;
    expect(end.x).toBeCloseTo(pts[pts.length - 1].x, 9);
    expect(end.y).toBeCloseTo(pts[pts.length - 1].y, 9);
    for (let i = 0; i < segs.length - 1; i++) {
      expect(segs[i].p3.x).toBeCloseTo(segs[i + 1].p0.x, 9);
      expect(segs[i].p3.y).toBeCloseTo(segs[i + 1].p0.y, 9);
    }
  });

  it('is C2: tangent AND curvature vector continuous at every join', () => {
    const segs = cubicBSplineToBezier(pts);
    for (let i = 0; i < segs.length - 1; i++) {
      const a = segs[i];
      const b = segs[i + 1];
      // C1: matching first derivative (3·(p3 − p2) = 3·(q1 − q0)).
      expect(a.p3.x - a.p2.x).toBeCloseTo(b.p1.x - b.p0.x, 9);
      expect(a.p3.y - a.p2.y).toBeCloseTo(b.p1.y - b.p0.y, 9);
      // C2: matching second derivative (6·(p1 − 2·p2 + p3)).
      const sa = { x: a.p1.x - 2 * a.p2.x + a.p3.x, y: a.p1.y - 2 * a.p2.y + a.p3.y };
      const sb = { x: b.p0.x - 2 * b.p1.x + b.p2.x, y: b.p0.y - 2 * b.p1.y + b.p2.y };
      expect(sa.x).toBeCloseTo(sb.x, 9);
      expect(sa.y).toBeCloseTo(sb.y, 9);
    }
  });

  it('is local: appending a point only changes the last three segments', () => {
    const before = cubicBSplineToBezier(pts.slice(0, 6));
    const after = cubicBSplineToBezier(pts);
    for (let i = 0; i < before.length - 3; i++) expect(after[i]).toEqual(before[i]);
  });

  it('averages out jitter instead of tracing it', () => {
    const zig = Array.from({ length: 30 }, (_, i) => ({ x: i * 4, y: i % 2 ? 1 : -1 }));
    const segs = cubicBSplineToBezier(zig);
    const mid = segs.slice(5, -5).flatMap((s) => [s.p0.y, s.p3.y]);
    expect(Math.max(...mid.map(Math.abs))).toBeLessThan(0.5); // input swings ±1
  });

  it('handles tiny inputs', () => {
    expect(cubicBSplineToBezier([])).toEqual([]);
    expect(cubicBSplineToBezier([{ x: 1, y: 1 }])).toEqual([]);
    expect(cubicBSplineToBezier(pts.slice(0, 2)).length).toBeGreaterThan(0);
  });
});
