import type { CubicBezier, Stroke, Vec2 } from '../types';
import { bezierLength, bezierPoint, bezierTangent, lineToBezier, reverseBezier } from '../geometry/bezier';
import { add, distance, dot, mix, perp, scale, sub } from '../geometry/math';
import { fitCurve } from '../smoothing/fit-curve';
import { dedupe } from '../smoothing/process-stroke';
import { widthAt } from '../smoothing/width';

const KAPPA = 0.5522847498307936; // cubic approximation of a quarter circle
const OUTLINE_TOLERANCE = 0.12; // px, fit error of the offset curves
const SAMPLE_SPACING = 1; // px between centre-line samples used to build the offsets

interface Sample {
  p: Vec2;
  n: Vec2; // left normal
  u: number; // normalised arc length
}

/**
 * Variable-width outline of a stroke as a *closed* chain of cubic Béziers,
 * ready for `fill`.
 *
 * Why an outline: an SVG `stroke` has one constant width. Pressure/speed
 * tapered ink requires the stroke's silhouette as a filled shape. (The
 * animation phase will reveal this shape with a dash-animated centre-line
 * mask, so the drawing-playback still follows the original pen path.)
 *
 * Method: sample the centre line, offset each sample along its normal by half
 * the local width on both sides, then *re-fit* each side with the same Bézier
 * fitter used for the centre line (so the file stays compact and smooth),
 * and close with round caps. Hard corners get a bevel on the outer side and
 * a harmless overlap on the inner side (non-zero fill).
 */
export function strokeToOutline(stroke: Stroke, baseWidth: number, quality: OutlineQuality = 'final'): CubicBezier[] {
  if (stroke.segments.length === 0) return [];
  if (stroke.isDot) {
    const c = stroke.segments[0].p0;
    const h = (baseWidth * widthAt(stroke.widthProfile, 0.5)) / 2;
    return circle(c, Math.max(h, 0.01));
  }

  const chunks = sampleChunks(stroke);
  const halfAt = (u: number) => Math.max(0.01, (baseWidth * widthAt(stroke.widthProfile, u)) / 2);

  const left: CubicBezier[][] = [];
  const right: CubicBezier[][] = [];
  for (const chunk of chunks) {
    const lp = dedupe(chunk.map((s) => add(s.p, scale(s.n, halfAt(s.u)))));
    const rp = dedupe(chunk.map((s) => sub(s.p, scale(s.n, halfAt(s.u)))));
    if (lp.length >= 2) left.push(fitSide(lp, quality));
    if (rp.length >= 2) right.push(fitSide(rp, quality));
  }
  if (left.length === 0) return [];

  const first = chunks[0][0];
  const lastChunk = chunks[chunks.length - 1];
  const last = lastChunk[lastChunk.length - 1];
  // The normal is n = perp(T), hence T = -perp(n).
  const startT = scale(perp(first.n), -1);
  const endT = scale(perp(last.n), -1);

  const out: CubicBezier[] = [];
  // Left side, start → end.
  for (let k = 0; k < left.length; k++) {
    if (k > 0) joinLine(out, left[k][0].p0);
    out.push(...left[k]);
  }
  // End cap: left end → right end.
  const hEnd = halfAt(last.u);
  out.push(...semicircle(last.p, hEnd, last.n, endT));
  // Right side, end → start (reversed).
  for (let k = right.length - 1; k >= 0; k--) {
    const rev = right[k].slice().reverse().map(reverseBezier);
    if (k < right.length - 1) joinLine(out, rev[0].p0);
    out.push(...rev);
  }
  // Start cap: right start → left start.
  const hStart = halfAt(first.u);
  out.push(...semicircle(first.p, hStart, scale(first.n, -1), scale(startT, -1)));
  return out;
}

/**
 * `final`: each side is re-fitted with cubic Béziers (compact, smooth at any zoom: for files).
 * `live`: the dense offset samples are joined with short lines (≈ 3× faster: for per-frame drawing,
 * indistinguishable on screen because the samples are ~1 px apart).
 */
export type OutlineQuality = 'final' | 'live';

function fitSide(points: Vec2[], quality: OutlineQuality): CubicBezier[] {
  if (quality === 'final') return fitCurve(points, OUTLINE_TOLERANCE);
  const out: CubicBezier[] = [];
  for (let i = 1; i < points.length; i++) out.push(lineToBezier(points[i - 1], points[i]));
  return out;
}

function joinLine(out: CubicBezier[], to: Vec2): void {
  const from = out[out.length - 1].p3;
  if (distance(from, to) > 1e-6) out.push(lineToBezier(from, to));
}

/** Half circle from `P + e1·h` through `P + e2·h` to `P − e1·h` (e1 ⟂ e2). */
function semicircle(p: Vec2, h: number, e1: Vec2, e2: Vec2): [CubicBezier, CubicBezier] {
  const k = KAPPA * h;
  const A = add(p, scale(e1, h));
  const M = add(p, scale(e2, h));
  const B = sub(p, scale(e1, h));
  return [
    { p0: A, p1: add(A, scale(e2, k)), p2: add(M, scale(e1, k)), p3: M },
    { p0: M, p1: sub(M, scale(e1, k)), p2: add(B, scale(e2, k)), p3: B },
  ];
}

function circle(c: Vec2, r: number): CubicBezier[] {
  const ex = { x: 1, y: 0 };
  const ey = { x: 0, y: 1 };
  const [a, b] = semicircle(c, r, ex, ey);
  const [d, e] = semicircle(c, r, scale(ex, -1), scale(ey, -1));
  return [a, b, d, e];
}

/** Largest change of direction (rad) allowed between two consecutive offset samples (~10°). */
const MAX_TURN_STEP = 0.175;

function rotate(v: Vec2, a: number): Vec2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * Samples the centre line for offsetting, as one continuous run.
 *
 * Spacing alone is not enough: where the pen reverses (a hairpin), the
 * direction flips within a fraction of a pixel, so both offset edges would
 * jump from one side of the stroke to the other between two samples. The
 * curve fitter then draws a wild Bézier through that gap (a long thin spike).
 * Wherever the direction changes by more than {@link MAX_TURN_STEP} between
 * neighbouring samples, extra samples are inserted that *rotate the normal*
 * on the spot. The edges then sweep a smooth round join (a rounded tip at a
 * cusp), exactly like a round line join.
 */
function sampleChunks(stroke: Stroke): Sample[][] {
  const base: { p: Vec2; n: Vec2 }[] = [];
  stroke.segments.forEach((seg, i) => {
    const count = Math.max(3, Math.ceil(bezierLength(seg) / SAMPLE_SPACING));
    for (let j = i === 0 ? 0 : 1; j <= count; j++) {
      const t = j / count;
      base.push({ p: bezierPoint(seg, t), n: perp(bezierTangent(seg, t)) });
    }
    // Hard (G0) joins: the next segment's first sample carries its own normal, which the rotation below smooths over.
    if (i + 1 < stroke.segments.length) {
      const next = stroke.segments[i + 1];
      if (distance(seg.p3, next.p0) > 1e-4) base.push({ p: next.p0, n: perp(bezierTangent(next, 0)) });
    }
  });

  const dense: { p: Vec2; n: Vec2 }[] = [];
  for (let i = 0; i < base.length; i++) {
    if (i > 0) {
      const a = base[i - 1];
      const b = base[i];
      const cosA = Math.max(-1, Math.min(1, dot(a.n, b.n)));
      const angle = Math.acos(cosA);
      if (angle > MAX_TURN_STEP) {
        // A flip of ~180° has no preferred direction: sweep through the travel direction, where the outer round tip belongs.
        const flip = angle > Math.PI - 0.05;
        const sweep = flip ? Math.PI : angle;
        const sign = flip ? -1 : a.n.x * b.n.y - a.n.y * b.n.x >= 0 ? 1 : -1;
        const steps = Math.ceil(sweep / MAX_TURN_STEP);
        for (let k = 1; k < steps; k++) {
          dense.push({ p: mix(a.p, b.p, k / steps), n: rotate(a.n, (sign * sweep * k) / steps) });
        }
      }
    }
    dense.push(base[i]);
  }

  // Normalised arc length along the sampled polyline.
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + distance(dense[i - 1].p, dense[i].p));
  const total = cum[cum.length - 1];
  const samples: Sample[] = dense.map((d, i) => ({ p: d.p, n: d.n, u: total > 0 ? cum[i] / total : 0 }));
  return samples.length >= 2 ? [samples] : [];
}
