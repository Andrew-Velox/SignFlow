import { formatNumber, type CubicBezier, type Vec2 } from '@signflow/core';

/**
 * Straight-line approximation of a chain of cubic Béziers, within `tolerance` px.
 *
 * Why the animation needs this: each slice is revealed through a mask that is the slice's centre line
 * stroked about 14 px wide. When that stroke is wider than the radius of a bend (every tiny loop or hairpin
 * of a signature), browsers' curve strokers can fold the offset curve over itself and leave a hole in the
 * band (measured in Chromium/Brave: a white triangle inside the loop, in the animation only). Straight
 * segments with round joins give a stroke that is always the plain union of rectangles and discs, which
 * every renderer draws correctly.
 */
export function flattenSegments(segments: readonly CubicBezier[], tolerance = 0.1): Vec2[] {
  const out: Vec2[] = [];
  if (segments.length === 0) return out;
  out.push({ x: segments[0].p0.x, y: segments[0].p0.y });
  for (const s of segments) flattenOne(s, tolerance, 0, out);
  return out;
}

function flattenOne(b: CubicBezier, tol: number, depth: number, out: Vec2[]): void {
  if (depth >= 12 || isFlat(b, tol)) {
    out.push({ x: b.p3.x, y: b.p3.y });
    return;
  }
  // de Casteljau split at the middle
  const m = (a: Vec2, c: Vec2): Vec2 => ({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });
  const p01 = m(b.p0, b.p1);
  const p12 = m(b.p1, b.p2);
  const p23 = m(b.p2, b.p3);
  const p012 = m(p01, p12);
  const p123 = m(p12, p23);
  const mid = m(p012, p123);
  flattenOne({ p0: b.p0, p1: p01, p2: p012, p3: mid }, tol, depth + 1, out);
  flattenOne({ p0: mid, p1: p123, p2: p23, p3: b.p3 }, tol, depth + 1, out);
}

/** True when both control points lie within `tol` of the chord (and the chord is not a collapsed hairpin). */
function isFlat(b: CubicBezier, tol: number): boolean {
  const dx = b.p3.x - b.p0.x;
  const dy = b.p3.y - b.p0.y;
  const len2 = dx * dx + dy * dy;
  const dist = (p: Vec2) => {
    if (len2 < 1e-12) return Math.hypot(p.x - b.p0.x, p.y - b.p0.y); // loop or hairpin: chord is a point
    return Math.abs((p.x - b.p0.x) * dy - (p.y - b.p0.y) * dx) / Math.sqrt(len2);
  };
  if (dist(b.p1) > tol || dist(b.p2) > tol) return false;
  // Control points must also stay between the end points along the chord, or the curve doubles back.
  if (len2 >= 1e-12) {
    const t1 = ((b.p1.x - b.p0.x) * dx + (b.p1.y - b.p0.y) * dy) / len2;
    const t2 = ((b.p2.x - b.p0.x) * dx + (b.p2.y - b.p0.y) * dy) / len2;
    if (t1 < -0.01 || t1 > 1.01 || t2 < -0.01 || t2 > 1.01) return false;
  }
  return true;
}

/** `M x y L x y …` with the coordinates rounded to `precision` decimals, plus the exact length of that rounded polyline. */
export function polylinePath(points: readonly Vec2[], precision: number): { d: string; length: number } {
  const k = Math.pow(10, precision);
  const r = (v: number) => Math.round(v * k) / k;
  let d = '';
  let length = 0;
  let px = NaN;
  let py = NaN;
  for (const p of points) {
    const x = r(p.x);
    const y = r(p.y);
    if (x === px && y === py) continue; // a repeated point adds nothing
    d += (d === '' ? 'M' : 'L') + formatNumber(x, precision) + ' ' + formatNumber(y, precision);
    if (!Number.isNaN(px)) length += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return { d, length };
}
