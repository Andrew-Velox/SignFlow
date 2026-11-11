import type { Bounds, CubicBezier, InputPoint, RawStroke, Stroke } from '../types';
import { bezierBounds, bezierLength, unionBounds } from '../geometry/bezier';
import { distance } from '../geometry/math';
import { detectCorners } from './corners';
import { fitCurve } from './fit-curve';
import { smoothZeroPhase } from './one-euro';
import { type ProcessOptions, resolveOptions, resolveSmoothing } from './options';
import { computeWidthProfile } from './width';

/**
 * Whether a stroke carries meaningful pressure. Mice report a constant 0.5
 * while pressed, so they (and any device with < 3 distinct values) are
 * treated as pressure-less.
 */
export function strokeHasPressure(raw: Pick<RawStroke, 'pointerKind' | 'points'>): boolean {
  if (raw.pointerKind === 'mouse') return false;
  const seen = new Set<number>();
  for (const p of raw.points) {
    seen.add(Math.round(p.pressure * 100));
    if (seen.size >= 3) return true;
  }
  return false;
}

/** Drops non-finite samples and any sample closer than `minDistance` to the last kept one (first and last are always kept). */
export function prepareInput(points: readonly InputPoint[], minDistance: number): InputPoint[] {
  const kept: InputPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (kept.length === 0 || distance(kept[kept.length - 1], p) >= minDistance) kept.push(p);
  }
  const last = points[points.length - 1];
  if (kept.length > 1 && last && Number.isFinite(last.x) && Number.isFinite(last.y) && kept[kept.length - 1] !== last) {
    // Keep the true release point, replacing a too-close predecessor instead of creating a stub.
    if (distance(kept[kept.length - 1], last) < minDistance * 0.5) kept[kept.length - 1] = last;
    else kept.push(last);
  }
  return kept;
}

export function emptyStroke(raw: Pick<RawStroke, 'id' | 'pointerKind'>): Stroke {
  return { id: raw.id, pointerKind: raw.pointerKind, segments: [], widthProfile: [], length: 0, isDot: false };
}

export function dotStroke(raw: Pick<RawStroke, 'id' | 'pointerKind'>, p: { x: number; y: number }): Stroke {
  const c = { x: p.x, y: p.y };
  const seg: CubicBezier = { p0: c, p1: c, p2: c, p3: c };
  return { id: raw.id, pointerKind: raw.pointerKind, segments: [seg], widthProfile: [], length: 0, isDot: true };
}

export function strokeBounds(stroke: Stroke): Bounds | null {
  let b: Bounds | null = null;
  for (const s of stroke.segments) b = unionBounds(b, bezierBounds(s));
  return b;
}

export function segmentsLength(segments: readonly CubicBezier[]): number {
  let l = 0;
  for (const s of segments) l += bezierLength(s);
  return l;
}

/**
 * Offline ("refined") pipeline: turns captured pointer data into smooth vector geometry
 * by looking at the whole stroke at once. Used when `refine: true`.
 *
 *   raw samples
 *     → sanitise + drop sub-threshold jitter
 *     → corner detection, split into smooth spans
 *     → per span: zero-phase One Euro smoothing (no lag, no shrinkage)
 *     → per span: Schneider least-squares Bézier fitting within a pixel tolerance
 *     → width profile (pressure / speed / taper)
 *
 * Pure function of (raw, options).
 */
export function refineStroke(raw: RawStroke, userOptions: Partial<ProcessOptions> = {}): Stroke {
  const o = resolveOptions(userOptions);
  const r = resolveSmoothing(o.smoothing);
  const pts = prepareInput(raw.points, r.minPointDistance);

  if (pts.length === 0) return emptyStroke(raw);
  if (pts.length === 1 || distance(pts[0], pts[pts.length - 1]) < 1e-6 && pts.every((p) => distance(p, pts[0]) < 1e-6)) {
    return dotStroke(raw, pts[0]);
  }

  const corners = detectCorners(pts, r.cornerWindow, o.cornerAngle);
  const cuts = [0, ...corners, pts.length - 1];

  const segments: CubicBezier[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const span = pts.slice(cuts[k], cuts[k + 1] + 1);
    const smooth = smoothZeroPhase(span, r.minCutoff, r.beta);
    segments.push(...fitCurve(dedupe(smooth), r.fitTolerance));
  }

  return {
    id: raw.id,
    pointerKind: raw.pointerKind,
    segments,
    widthProfile: computeWidthProfile(pts, {
      hasPressure: strokeHasPressure(raw),
      pressureSensitivity: o.pressureSensitivity,
      velocitySensitivity: o.velocitySensitivity,
      taper: o.taper,
    }),
    length: segmentsLength(segments),
    isDot: false,
  };
}

/** Removes (near-)coincident consecutive points, which would break tangent estimation in the fitter. */
export function dedupe<T extends { x: number; y: number }>(points: readonly T[], eps = 1e-4): T[] {
  const out: T[] = [];
  for (const p of points) {
    if (out.length === 0 || distance(out[out.length - 1], p) > eps) out.push(p);
  }
  return out;
}
