import type { Bounds, CubicBezier, Vec2 } from '../types';
import { distance, mix, normalize, sub } from './math';

export function bezierPoint(b: CubicBezier, t: number): Vec2 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const c1 = 3 * mt * mt * t;
  const c2 = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * b.p0.x + c1 * b.p1.x + c2 * b.p2.x + d * b.p3.x,
    y: a * b.p0.y + c1 * b.p1.y + c2 * b.p2.y + d * b.p3.y,
  };
}

/** First derivative B'(t). */
export function bezierDerivative(b: CubicBezier, t: number): Vec2 {
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const c = 6 * mt * t;
  const d = 3 * t * t;
  return {
    x: a * (b.p1.x - b.p0.x) + c * (b.p2.x - b.p1.x) + d * (b.p3.x - b.p2.x),
    y: a * (b.p1.y - b.p0.y) + c * (b.p2.y - b.p1.y) + d * (b.p3.y - b.p2.y),
  };
}

/** Second derivative B''(t). */
export function bezierSecondDerivative(b: CubicBezier, t: number): Vec2 {
  const mt = 1 - t;
  return {
    x: 6 * (mt * (b.p2.x - 2 * b.p1.x + b.p0.x) + t * (b.p3.x - 2 * b.p2.x + b.p1.x)),
    y: 6 * (mt * (b.p2.y - 2 * b.p1.y + b.p0.y) + t * (b.p3.y - 2 * b.p2.y + b.p1.y)),
  };
}

/**
 * Unit tangent at `t`. Degenerate control polygons (coincident handles, as
 * produced at stroke ends) fall back to the nearest non-zero chord so the
 * result is only zero for a fully collapsed curve.
 */
export function bezierTangent(b: CubicBezier, t: number): Vec2 {
  let d = normalize(bezierDerivative(b, t));
  if (d.x === 0 && d.y === 0) {
    d = normalize(sub(b.p3, b.p0));
    if (d.x === 0 && d.y === 0) d = normalize(sub(b.p2, b.p1));
  }
  return d;
}

/** de Casteljau subdivision at `t`. */
export function splitBezier(b: CubicBezier, t: number): [CubicBezier, CubicBezier] {
  const p01 = mix(b.p0, b.p1, t);
  const p12 = mix(b.p1, b.p2, t);
  const p23 = mix(b.p2, b.p3, t);
  const p012 = mix(p01, p12, t);
  const p123 = mix(p12, p23, t);
  const m = mix(p012, p123, t);
  return [
    { p0: b.p0, p1: p01, p2: p012, p3: m },
    { p0: m, p1: p123, p2: p23, p3: b.p3 },
  ];
}

export function reverseBezier(b: CubicBezier): CubicBezier {
  return { p0: b.p3, p1: b.p2, p2: b.p1, p3: b.p0 };
}

/** A straight line expressed as a cubic, so paths can stay homogeneous. */
export function lineToBezier(a: Vec2, b: Vec2): CubicBezier {
  return { p0: a, p1: mix(a, b, 1 / 3), p2: mix(a, b, 2 / 3), p3: b };
}

// 5-point Gauss–Legendre on [-1, 1].
const GL_X = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
const GL_W = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];

/** Arc length: 5-point Gauss–Legendre over four sub-intervals (error « 0.001 px for stroke-sized curves). */
export function bezierLength(b: CubicBezier): number {
  const parts = 4;
  let sum = 0;
  for (let k = 0; k < parts; k++) {
    const a = k / parts;
    const half = 0.5 / parts;
    const mid = a + half;
    for (let i = 0; i < 5; i++) {
      const d = bezierDerivative(b, mid + half * GL_X[i]);
      sum += GL_W[i] * Math.hypot(d.x, d.y) * half;
    }
  }
  return sum;
}

function axisExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const v0 = p1 - p0;
  const v1 = p2 - p1;
  const v2 = p3 - p2;
  const A = v0 - 2 * v1 + v2;
  const B = 2 * (v1 - v0);
  const C = v0;
  const roots: number[] = [];
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) > 1e-12) roots.push(-C / B);
  } else {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-B + s) / (2 * A), (-B - s) / (2 * A));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/** Exact (extrema-based) axis-aligned bounds of the curve. */
export function bezierBounds(b: CubicBezier): Bounds {
  const ts = [0, 1, ...axisExtrema(b.p0.x, b.p1.x, b.p2.x, b.p3.x), ...axisExtrema(b.p0.y, b.p1.y, b.p2.y, b.p3.y)];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of ts) {
    const p = bezierPoint(b, t);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function polylineLength(points: readonly Vec2[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += distance(points[i - 1], points[i]);
  return s;
}
