import type { CubicBezier, Vec2 } from '../types';
import { add, distance, distanceSq, dot, normalize, scale, sub } from '../geometry/math';
import { bezierPoint, bezierDerivative, bezierSecondDerivative } from '../geometry/bezier';

/**
 * Least-squares cubic Bézier fitting, after P. J. Schneider,
 * "An Algorithm for Automatically Fitting Digitized Curves" (Graphics Gems, 1990).
 *
 * Why this and not "just interpolate the points":
 *  - Catmull–Rom/B-splines through the samples reproduce the (quantised,
 *    jittery) input exactly or need one segment per sample. SVG size explodes
 *    and every wobble is kept.
 *  - Fitting solves for *one* Bézier per run of samples, with a hard bound
 *    (`maxError`) on how far it may stray from them. Typical output is one
 *    segment per 15-40 samples, G1-continuous across splits.
 *
 * The input must contain distinct consecutive points. Corners must be handled
 * by the caller (split first, fit each side separately).
 */
export function fitCurve(points: readonly Vec2[], maxError: number): CubicBezier[] {
  const n = points.length;
  if (n < 2) return [];
  const ctx: FitContext = {
    pts: points,
    errSq: maxError * maxError,
    lookahead: Math.min(8, Math.max(1.5, maxError * 4)),
    out: [],
  };
  const t1 = tangentFrom(points, 0, 1, ctx.lookahead);
  const t2 = tangentFrom(points, n - 1, -1, ctx.lookahead);
  fitCubic(ctx, 0, n - 1, t1, t2);
  return ctx.out;
}

interface FitContext {
  pts: readonly Vec2[];
  errSq: number;
  lookahead: number;
  out: CubicBezier[];
}

const MAX_REPARAM_ITERATIONS = 6;
/** Reparameterisation is attempted when the error is within this factor of the tolerance (squared units). */
const REPARAM_ERROR_FACTOR = 16;

/**
 * Unit tangent at `idx` pointing *into* the curve (dir = +1: toward higher
 * indices, -1: toward lower). Uses the first sample at least `minDist` away
 * so single noisy neighbours cannot flip the direction.
 */
function tangentFrom(pts: readonly Vec2[], idx: number, dir: 1 | -1, minDist: number): Vec2 {
  const end = dir === 1 ? pts.length - 1 : 0;
  let j = idx + dir;
  while ((dir === 1 ? j < end : j > end) && distance(pts[idx], pts[j]) < minDist) j += dir;
  j = dir === 1 ? Math.min(j, end) : Math.max(j, end);
  return normalize(sub(pts[j], pts[idx]));
}

function centerTangent(ctx: FitContext, first: number, last: number, c: number): Vec2 {
  const { pts, lookahead } = ctx;
  const half = lookahead / 2;
  let a = c - 1;
  while (a > first && distance(pts[c], pts[a]) < half) a--;
  let b = c + 1;
  while (b < last && distance(pts[c], pts[b]) < half) b++;
  // Points backward (toward lower indices), per the Graphics Gems convention for "tHat2".
  return normalize(sub(pts[a], pts[b]));
}

function fitCubic(ctx: FitContext, first: number, last: number, tHat1: Vec2, tHat2: Vec2): void {
  const { pts, errSq, out } = ctx;
  const nPts = last - first + 1;

  if (nPts === 2) {
    const dist = distance(pts[first], pts[last]) / 3;
    out.push({
      p0: pts[first],
      p1: add(pts[first], scale(tHat1, dist)),
      p2: add(pts[last], scale(tHat2, dist)),
      p3: pts[last],
    });
    return;
  }

  const pathLen = polylineSpan(pts, first, last);
  let u = chordLengthParameterize(pts, first, last);
  let bez = generateBezier(pts, first, last, u, tHat1, tHat2);
  let { maxErr, split } = maxError(pts, first, last, bez, u);
  // The error is only measured at the samples, so a curve can swing wildly *between* them (a spike).
  if (overshoots(bez, pathLen)) maxErr = Infinity;
  if (maxErr < errSq) {
    out.push(bez);
    return;
  }

  if (maxErr < errSq * REPARAM_ERROR_FACTOR) {
    for (let i = 0; i < MAX_REPARAM_ITERATIONS; i++) {
      u = reparameterize(pts, first, u, bez);
      bez = generateBezier(pts, first, last, u, tHat1, tHat2);
      ({ maxErr, split } = maxError(pts, first, last, bez, u));
      if (overshoots(bez, pathLen)) break;
      if (maxErr < errSq) {
        out.push(bez);
        return;
      }
    }
  }

  const tCenter = centerTangent(ctx, first, last, split);
  fitCubic(ctx, first, split, tHat1, tCenter);
  fitCubic(ctx, split, last, scale(tCenter, -1), tHat2);
}

/** Total length of the data polyline between two indices. */
function polylineSpan(pts: readonly Vec2[], first: number, last: number): number {
  let l = 0;
  for (let i = first + 1; i <= last; i++) l += distance(pts[i], pts[i - 1]);
  return l;
}

/**
 * A handle longer than the stretch of data the curve describes is never a real
 * feature: it is a spike. Non-finite control points are rejected too.
 */
function overshoots(b: CubicBezier, pathLength: number): boolean {
  const limit = pathLength + 1e-6;
  const finite = [b.p0, b.p1, b.p2, b.p3].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  return !finite || distance(b.p0, b.p1) > limit || distance(b.p3, b.p2) > limit;
}

function chordLengthParameterize(pts: readonly Vec2[], first: number, last: number): number[] {
  const u = new Array<number>(last - first + 1);
  u[0] = 0;
  for (let i = first + 1; i <= last; i++) u[i - first] = u[i - first - 1] + distance(pts[i], pts[i - 1]);
  const total = u[last - first];
  for (let i = 1; i < u.length; i++) u[i] = total > 0 ? u[i] / total : i / (u.length - 1);
  return u;
}

function generateBezier(
  pts: readonly Vec2[],
  first: number,
  last: number,
  u: readonly number[],
  tHat1: Vec2,
  tHat2: Vec2,
): CubicBezier {
  const p0 = pts[first];
  const p3 = pts[last];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < u.length; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * t * mt * mt;
    const b2 = 3 * t * t * mt;
    const b3 = t * t * t;
    const a1 = scale(tHat1, b1);
    const a2 = scale(tHat2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[first + i], add(scale(p0, b0 + b1), scale(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const detC0X = c00 * x1 - c01 * x0;
  const detXC1 = x0 * c11 - x1 * c01;
  const alphaL = det === 0 ? 0 : detXC1 / det;
  const alphaR = det === 0 ? 0 : detC0X / det;

  const segLength = distance(p0, p3);
  const eps = 1e-6 * segLength;
  if (alphaL < eps || alphaR < eps) {
    // Degenerate fit: Wu/Barsky heuristic, handles at a third of the chord.
    const d = segLength / 3;
    return { p0, p1: add(p0, scale(tHat1, d)), p2: add(p3, scale(tHat2, d)), p3 };
  }
  return { p0, p1: add(p0, scale(tHat1, alphaL)), p2: add(p3, scale(tHat2, alphaR)), p3 };
}

/** One Newton–Raphson step per sample: moves each parameter to the closest point on the curve. */
function reparameterize(
  pts: readonly Vec2[],
  first: number,
  u: readonly number[],
  bez: CubicBezier,
): number[] {
  const out = new Array<number>(u.length);
  for (let i = 0; i < u.length; i++) {
    const t = u[i];
    const d = sub(bezierPoint(bez, t), pts[first + i]);
    const q1 = bezierDerivative(bez, t);
    const q2 = bezierSecondDerivative(bez, t);
    const num = dot(d, q1);
    const den = dot(q1, q1) + dot(d, q2);
    const next = Math.abs(den) < 1e-12 ? t : t - num / den;
    out[i] = Math.min(1, Math.max(0, next));
  }
  // The end points must stay anchored.
  out[0] = 0;
  out[out.length - 1] = 1;
  return out;
}

function maxError(
  pts: readonly Vec2[],
  first: number,
  last: number,
  bez: CubicBezier,
  u: readonly number[],
): { maxErr: number; split: number } {
  let maxErr = 0;
  let split = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const e = distanceSq(bezierPoint(bez, u[i - first]), pts[i]);
    if (e >= maxErr) {
      maxErr = e;
      split = i;
    }
  }
  return { maxErr, split };
}
