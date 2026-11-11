import type { CubicBezier, Stroke } from '../types';
import { segmentsToPathData } from '../geometry/path-data';
import { type OutlineQuality, strokeToOutline } from './outline';

/** `d` for the stroke's centre line (use with `stroke`, constant width). */
export function strokeCenterlinePath(stroke: Stroke, precision = 2): string {
  return segmentsToPathData(stroke.segments, precision);
}

/** `d` for the closed variable-width silhouette (use with `fill`). */
export function strokeOutlinePath(stroke: Stroke, baseWidth: number, precision = 2, quality: OutlineQuality = 'final'): string {
  return outlineToPath(strokeToOutline(stroke, baseWidth, quality), precision);
}

export function outlineToPath(outline: readonly CubicBezier[], precision = 2): string {
  return segmentsToPathData(outline, precision, true);
}
