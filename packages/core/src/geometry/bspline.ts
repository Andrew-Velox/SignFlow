import type { CubicBezier, Vec2 } from '../types';
import { mix } from './math';

/**
 * Uniform cubic B-spline with the points as control points, converted to
 * cubic Béziers. Compared with the quadratic midpoint spline this is C2
 * (continuous curvature), so lines look drawn by one smooth motion instead of
 * a chain of arcs, and it averages over three neighbours so leftover jitter
 * is flattened further.
 *
 * The end points are tripled, so the curve starts and ends exactly on the
 * first and last point. It is local: appending a point changes only the last
 * three segments, so already-drawn ink never moves.
 */
export function cubicBSplineToBezier(points: readonly Vec2[]): CubicBezier[] {
  const n = points.length;
  if (n < 2) return [];
  const q = [points[0], points[0], ...points, points[n - 1], points[n - 1]];
  const out: CubicBezier[] = [];
  for (let i = 0; i + 3 < q.length; i++) {
    const [a, b, c, d] = [q[i], q[i + 1], q[i + 2], q[i + 3]];
    out.push({
      p0: { x: (a.x + 4 * b.x + c.x) / 6, y: (a.y + 4 * b.y + c.y) / 6 },
      p1: mix(b, c, 1 / 3),
      p2: mix(b, c, 2 / 3),
      p3: { x: (b.x + 4 * c.x + d.x) / 6, y: (b.y + 4 * c.y + d.y) / 6 },
    });
  }
  return out;
}
