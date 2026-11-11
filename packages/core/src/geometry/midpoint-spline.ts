import type { CubicBezier, Vec2 } from '../types';
import { lineToBezier } from './bezier';
import { mix } from './math';

/** Elevates a quadratic Bézier (p0, q, p2) to the equivalent cubic. */
function quadToCubic(p0: Vec2, q: Vec2, p2: Vec2): CubicBezier {
  return { p0, p1: mix(p0, q, 2 / 3), p2: mix(p2, q, 2 / 3), p3: p2 };
}

/**
 * Quadratic "midpoint" B-spline: the input points act as *control* points and
 * the curve passes through the midpoints of consecutive pairs (the technique
 * used by signature pads and note-taking apps).
 *
 * Unlike Catmull-Rom it approximates rather than interpolates, so residual
 * jitter in the points is averaged out instead of being traced exactly. It
 * is C1, local (appending a point only changes the last two segments, so
 * already-drawn ink never moves), and starts/ends exactly on the first/last
 * point via a straight half-segment.
 */
export function midpointSplineToBezier(points: readonly Vec2[]): CubicBezier[] {
  const n = points.length;
  if (n < 2) return [];
  if (n === 2) return [lineToBezier(points[0], points[1])];
  const out: CubicBezier[] = [];
  let cur = points[0];
  let mid = mix(points[0], points[1], 0.5);
  out.push(lineToBezier(cur, mid));
  cur = mid;
  for (let i = 1; i < n - 1; i++) {
    mid = mix(points[i], points[i + 1], 0.5);
    out.push(quadToCubic(cur, points[i], mid));
    cur = mid;
  }
  out.push(lineToBezier(cur, points[n - 1]));
  return out;
}
