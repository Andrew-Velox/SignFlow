import type { CubicBezier, Vec2 } from '../types';
import { distance } from './math';

/**
 * Converts a polyline into a chain of cubic Béziers that passes through every
 * input point, using a (by default centripetal) Catmull–Rom spline.
 *
 * `alpha` = 0 is the uniform spline, 0.5 centripetal, 1 chordal. Centripetal
 * is the only variant that is guaranteed free of cusps and self-intersections
 * inside a segment, which matters for unevenly spaced pointer samples.
 *
 * Used for the *live* preview (local, stable, no look-ahead). Final geometry
 * comes from {@link fitCurve}, which does not interpolate noise.
 *
 * Conversion follows Yuksel et al., "Parameterization and applications of
 * Catmull-Rom curves" (2011).
 */
export function catmullRomToBezier(points: readonly Vec2[], alpha = 0.5): CubicBezier[] {
  const n = points.length;
  if (n < 2) return [];
  const out: CubicBezier[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    // Mirror the neighbours at the ends so the end tangents follow the chord.
    const p0 = i > 0 ? points[i - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
    const p3 = i + 2 < n ? points[i + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };

    const d1 = Math.pow(distance(p0, p1), alpha);
    const d2 = Math.pow(distance(p1, p2), alpha);
    const d3 = Math.pow(distance(p2, p3), alpha);

    let c1: Vec2;
    let c2: Vec2;
    if (d1 < 1e-9 || d3 < 1e-9 || d2 < 1e-9) {
      // Coincident points: uniform spline avoids division by zero.
      c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    } else {
      const d1s = d1 * d1;
      const d2s = d2 * d2;
      const d3s = d3 * d3;
      const k1 = 3 * d1 * (d1 + d2);
      const k2 = 3 * d3 * (d3 + d2);
      const a1 = 2 * d1s + 3 * d1 * d2 + d2s;
      const a2 = 2 * d3s + 3 * d3 * d2 + d2s;
      c1 = {
        x: (d1s * p2.x - d2s * p0.x + a1 * p1.x) / k1,
        y: (d1s * p2.y - d2s * p0.y + a1 * p1.y) / k1,
      };
      c2 = {
        x: (d3s * p1.x - d2s * p3.x + a2 * p2.x) / k2,
        y: (d3s * p1.y - d2s * p3.y + a2 * p2.y) / k2,
      };
    }
    out.push({ p0: p1, p1: c1, p2: c2, p3: p2 });
  }
  return out;
}
