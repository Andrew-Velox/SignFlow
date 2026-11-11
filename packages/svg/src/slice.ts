import { bezierLength, splitBezier, widthAt, type CubicBezier, type Stroke, type WidthSample } from '@signflow/core';

/** Cumulative arc-length index over a chain of Béziers. */
export interface ArcIndex {
  segments: readonly CubicBezier[];
  cum: number[];
  total: number;
}

export function indexSegments(segments: readonly CubicBezier[]): ArcIndex {
  const cum = [0];
  for (const s of segments) cum.push(cum[cum.length - 1] + bezierLength(s));
  return { segments, cum, total: cum[cum.length - 1] };
}

/** Segment index and curve parameter at arc length `s` (clamped to the chain). */
function locate(idx: ArcIndex, s: number): { i: number; t: number } {
  const n = idx.segments.length;
  const pos = Math.min(idx.total, Math.max(0, s));
  let i = 0;
  while (i < n - 1 && idx.cum[i + 1] < pos) i++;
  const local = pos - idx.cum[i];
  const seg = idx.segments[i];
  // Exact end points, so a slice that starts or ends at a segment boundary does so exactly.
  if (local <= 1e-9) return { i, t: 0 };
  if (local >= idx.cum[i + 1] - idx.cum[i] - 1e-9) return { i, t: 1 };
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (bezierLength(splitBezier(seg, mid)[0]) < local) lo = mid;
    else hi = mid;
  }
  return { i, t: (lo + hi) / 2 };
}

/** The part of the chain between two arc-length positions. */
export function sliceSegments(idx: ArcIndex, from: number, to: number): CubicBezier[] {
  if (to <= from) return [];
  const a = locate(idx, from);
  const b = locate(idx, to);
  if (a.i === b.i) {
    const right = splitBezier(idx.segments[a.i], a.t)[1];
    const rel = (b.t - a.t) / Math.max(1e-12, 1 - a.t);
    return [splitBezier(right, Math.min(1, Math.max(0, rel)))[0]];
  }
  const out: CubicBezier[] = [];
  if (a.t < 1 - 1e-9) out.push(splitBezier(idx.segments[a.i], a.t)[1]);
  for (let i = a.i + 1; i < b.i; i++) out.push(idx.segments[i]);
  if (b.t > 1e-9) out.push(splitBezier(idx.segments[b.i], b.t)[0]);
  return out;
}

/**
 * A stroke made of the part of `stroke` between two arc-length positions. The
 * width profile is re-keyed to the slice, so the slice has exactly the same
 * thickness at every point as the whole stroke.
 */
export function sliceStroke(stroke: Stroke, idx: ArcIndex, from: number, to: number): Stroke {
  const segments = sliceSegments(idx, from, to);
  const u0 = from / idx.total;
  const u1 = to / idx.total;
  const prof = stroke.widthProfile;
  let widthProfile: WidthSample[] = [];
  if (prof.length) {
    const span = u1 - u0;
    const inner = prof.filter((p) => p.u > u0 + 1e-9 && p.u < u1 - 1e-9).map((p) => ({ u: (p.u - u0) / span, w: p.w }));
    widthProfile = [{ u: 0, w: widthAt(prof, u0) }, ...inner, { u: 1, w: widthAt(prof, u1) }];
  }
  return { ...stroke, segments, widthProfile, length: to - from, isDot: false };
}
