import type { CubicBezier } from '../types';
import { bezierLength, bezierPoint } from '../geometry/bezier';
import { dedupe } from './process-stroke';
import { fitCurve } from './fit-curve';

/** Max distance (px) the compacted curve may deviate from the original. Far below a screen pixel. */
export const COMPACT_TOLERANCE = 0.2;

/**
 * Re-expresses a long, dense chain of Béziers (one per input sample) with far
 * fewer segments, within `tolerance` px of the original curve. Used to keep
 * exported files small *without* changing what the user saw.
 */
export function compactSegments(segments: readonly CubicBezier[], tolerance = COMPACT_TOLERANCE): CubicBezier[] {
  if (segments.length < 3) return segments.slice();
  const pts = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const n = Math.max(2, Math.ceil(bezierLength(seg) / 0.75));
    for (let j = i === 0 ? 0 : 1; j <= n; j++) pts.push(bezierPoint(seg, j / n));
  }
  const fitted = fitCurve(dedupe(pts, 1e-3), tolerance);
  return fitted.length ? fitted : segments.slice();
}
