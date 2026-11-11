import type { CubicBezier, Stroke, Vec2 } from '../types';
import { bezierLength, bezierPoint, bezierTangent, lineToBezier, reverseBezier } from '../geometry/bezier';
import { add, distance, dot, mix, perp, scale, sub } from '../geometry/math';
import { fitCurve } from '../smoothing/fit-curve';
import { dedupe } from '../smoothing/process-stroke';
import { widthAt } from '../smoothing/width';

const KAPPA = 0.5522847498307936; // cubic approximation of a quarter circle
const OUTLINE_TOLERANCE = 0.12; // px, fit error of the offset curves
const SAMPLE_SPACING = 1; // px between centre-line samples used to build the offsets

export interface Sample {
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
export interface OutlineCaps {
  /** `round` (default) is a half circle, `butt` a flat cut across the pen path (for joining slices end to end). */
  start?: 'round' | 'butt';
  end?: 'round' | 'butt';
}

/**
 * The offset edges of a whole stroke, computed once: for every centre-line sample, the point on each edge
 * after the bend clamp, gap bridging and small-loop closing have been applied.
 *
 * Building outlines from these shared points (rather than recomputing them for each piece of a stroke)
 * guarantees that pieces fit together exactly: the animation cuts a stroke into slices, and the union of
 * the slice outlines is the same shape as the whole-stroke outline.
 */
export interface OutlineSamples {
  samples: Sample[];
  /** Plain half-width (before clamp/bridging) at each sample, used for round caps. */
  half: number[];
  left: Vec2[];
  right: Vec2[];
}

export function outlineSamples(stroke: Stroke, baseWidth: number, quality: OutlineQuality = 'final'): OutlineSamples | null {
  if (stroke.segments.length === 0 || stroke.isDot) return null;
  const chunk = sampleChunks(stroke)[0];
  if (!chunk || chunk.length < 2) return null;
  const half = chunk.map((s) => Math.max(0.15, (baseWidth * widthAt(stroke.widthProfile, s.u)) / 2));
  const reach = innerReach(chunk);
  // Live frames skip the bridging (it is a finishing touch and costs time); committed strokes and exports get it.
  const bridge = quality === 'final' ? gapBridges(chunk, half, bridgeWidth(baseWidth)) : null;
  return {
    samples: chunk,
    half,
    left: chunk.map((s, i) => add(s.p, scale(s.n, Math.min(half[i] + (bridge?.left[i] ?? 0), reach.left[i])))),
    right: chunk.map((s, i) => sub(s.p, scale(s.n, Math.min(half[i] + (bridge?.right[i] ?? 0), reach.right[i])))),
  };
}

/** Index of the first sample whose normalised arc length is >= `u`. */
export function sampleIndexAt(os: OutlineSamples, u: number): number {
  let lo = 0;
  let hi = os.samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (os.samples[mid].u < u) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Closed outline of samples `i0..i1` (inclusive) of a stroke: the two edges re-fitted with Béziers, closed by
 * caps at both ends. The whole stroke is `0..samples.length - 1`; a slice of it is any sub-range.
 */
export function outlinePiece(os: OutlineSamples, i0: number, i1: number, quality: OutlineQuality = 'final', caps: OutlineCaps = {}): CubicBezier[] {
  const lp = dedupe(os.left.slice(i0, i1 + 1));
  const rp = dedupe(os.right.slice(i0, i1 + 1));
  if (lp.length < 2 || rp.length < 2) return [];
  const left = fitSide(lp, quality);
  const right = fitSide(rp, quality);

  const first = os.samples[i0];
  const last = os.samples[i1];
  // The normal is n = perp(T), hence T = -perp(n).
  const startT = scale(perp(first.n), -1);
  const endT = scale(perp(last.n), -1);
  const hStart = os.half[i0];
  const hEnd = os.half[i1];

  const out: CubicBezier[] = [...left];
  // The edges may stop a hair short of (or past) the plain half-width at the very ends (bend clamp,
  // gap bridging). Every join below therefore goes through joinLine, which adds a tiny straight
  // connector when the two points differ. Without it the chain has a break, the path emitter starts a
  // new subpath there, and the fill closes each piece with a long thin chord: a spike or a notch.
  // End cap: left end -> right end.
  if (caps.end === 'butt') {
    joinLine(out, right[right.length - 1].p3);
  } else {
    joinLine(out, add(last.p, scale(last.n, hEnd)));
    out.push(...semicircle(last.p, hEnd, last.n, endT));
  }
  // Right side, end -> start (reversed).
  const rev = right.slice().reverse().map(reverseBezier);
  joinLine(out, rev[0].p0);
  out.push(...rev);
  // Start cap: right start -> left start.
  if (caps.start !== 'butt') {
    joinLine(out, sub(first.p, scale(first.n, hStart)));
    out.push(...semicircle(first.p, hStart, scale(first.n, -1), scale(startT, -1)));
  }
  joinLine(out, out[0].p0); // close the loop exactly
  return out;
}

export function strokeToOutline(
  stroke: Stroke,
  baseWidth: number,
  quality: OutlineQuality = 'final',
  caps: OutlineCaps = {},
): CubicBezier[] {
  if (stroke.segments.length === 0) return [];
  if (stroke.isDot) {
    const c = stroke.segments[0].p0;
    const h = (baseWidth * widthAt(stroke.widthProfile, 0.5)) / 2;
    return circle(c, Math.max(h, 0.15));
  }
  const os = outlineSamples(stroke, baseWidth, quality);
  return os ? outlinePiece(os, 0, os.samples.length - 1, quality, caps) : [];
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

/**
 * Slits narrower than this (px) between two parts of one stroke get bridged: true hairlines only.
 * A larger value fuses the legs of every V-shaped joint over a long stretch (visibly heavier joints),
 * since the gap between converging legs sweeps through every width on its way to zero.
 */
const HAIRLINE = 0.8;
/** ...and only where the near-gap holds for at least this much path (px). */
const HAIRLINE_MIN_RUN = 12;
function bridgeWidth(_baseWidth: number): number {
  return HAIRLINE;
}

/**
 * A hole left inside a loop whose largest inscribed circle is smaller than this (px radius) is closed,
 * as flowing ink would. Thin lens-shaped holes qualify; round counters (the inside of a cursive "e") do not.
 */
const LOOP_HOLE_CLOSE = 2;
/** Loops longer than this (px of path) are never closed: their counter is a deliberate part of the drawing. */
const LOOP_MAX_PERIMETER = 90;

/**
 * The most the outline can extend beyond the plain pen half-width (loop closing: the hole radius, at most
 * LOOP_HOLE_CLOSE, plus 0.5; hairline bridging needs less). A reveal mask must be at least this much wider
 * than the pen, or it clips the thickening and the hole it was meant to close reopens.
 */
export const MAX_OUTLINE_BOOST = LOOP_HOLE_CLOSE + 0.5;

/**
 * Radius of the largest circle that fits inside a closed polygon (0 if it has no interior), found by
 * scanning a grid of points and taking the one farthest from the boundary. Used only on small loops.
 */
function inscribedRadius(poly: readonly Vec2[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const step = Math.max(0.4, Math.max(maxX - minX, maxY - minY) / 40);
  let best = 0;
  for (let gx = minX + step / 2; gx < maxX; gx += step) {
    for (let gy = minY + step / 2; gy < maxY; gy += step) {
      // Inside? (even-odd ray cast)
      let inside = false;
      let nearest = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > gy !== b.y > gy && gx < ((b.x - a.x) * (gy - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((gx - a.x) * dx + (gy - a.y) * dy) / l2)) : 0;
        nearest = Math.min(nearest, Math.hypot(gx - (a.x + t * dx), gy - (a.y + t * dy)));
      }
      if (inside && nearest > best) best = nearest;
    }
  }
  return best;
}

/** Zeroes every run of positive values whose path length is shorter than `minLength`. */
function dropShortRuns(values: number[], arc: readonly number[], minLength: number): void {
  let i = 0;
  while (i < values.length) {
    if (values[i] <= 0) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < values.length && values[j + 1] > 0) j++;
    if (arc[j] - arc[i] < minLength) for (let k = i; k <= j; k++) values[k] = 0;
    i = j + 1;
  }
}

/** Intersection point of segments p1p2 and p3p4, or null. */
function segmentIntersection(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): Vec2 | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/**
 * Closes hairline gaps where a stroke retraces nearly the same path.
 *
 * The exact shape a pen sweeps keeps a sliver of white wherever two parts of
 * a stroke pass within a pixel or two of each other without quite touching,
 * for example the legs of a cursive loop. It is geometrically right but reads
 * as a rendering defect, and real ink would have run together there.
 *
 * For every sample, a sample on a *different part* of the stroke (path
 * distance much longer than straight-line distance) that is closer than
 * `tau` to touching makes the facing edge thicken just enough to overlap it.
 * The thickening is spread along the path so it ramps in and out smoothly.
 * Overlapping parts (gap <= 0) are left alone, and so is everything farther
 * apart than `tau`, so ordinary strokes are untouched.
 */
function gapBridges(samples: readonly Sample[], half: readonly number[], tau: number): { left: number[]; right: number[] } {
  const n = samples.length;
  const left = new Array<number>(n).fill(0);
  const right = new Array<number>(n).fill(0);
  if (n < 8) return { left, right };

  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + distance(samples[i - 1].p, samples[i].p));
  const hMax = Math.max(...half);
  const cell = Math.max(4, 2 * hMax + tau);
  const key = (cx: number, cy: number) => (cx + 50_000) * 100_003 + (cy + 50_000);
  const grid = new Map<number, number[]>();
  samples.forEach((s, i) => {
    const k = key(Math.floor(s.p.x / cell), Math.floor(s.p.y / cell));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });

  for (let i = 0; i < n; i++) {
    const pi = samples[i].p;
    const cx = Math.floor(pi.x / cell);
    const cy = Math.floor(pi.y / cell);
    // Only the CLOSEST other part matters: if it already overlaps (gap <= 0) there is nothing to bridge, however
    // many farther samples happen to sit at a distance that looks like a hairline.
    let bestGap = Infinity;
    let bestToward = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(key(cx + dx, cy + dy)) ?? []) {
          const along = Math.abs(arc[i] - arc[j]);
          if (along < 6) continue;
          const d = distance(pi, samples[j].p);
          if (d > 0.7 * along) continue; // the same part of the stroke, not a neighbour across a gap
          const gap = d - half[i] - half[j];
          if (gap < bestGap) {
            bestGap = gap;
            bestToward = (samples[j].p.x - pi.x) * samples[i].n.x + (samples[j].p.y - pi.y) * samples[i].n.y;
          }
        }
      }
    }
    if (bestGap > 0 && bestGap < tau) {
      const need = bestGap / 2 + 0.35; // overlap by ~0.7 px so antialiasing cannot leave a seam
      const side = bestToward > 0 ? left : right;
      if (need > side[i]) side[i] = need;
    }
  }

  // A real hairline sliver persists along a long stretch of both passes. The short zone where two converging
  // legs (every V-shaped joint) pass through the same gap sizes does not, so short runs are dropped.
  for (const side of [left, right]) dropShortRuns(side, arc, HAIRLINE_MIN_RUN);

  // Small loops: where the centre line crosses itself, the loop's interior stays white if it is only a little
  // larger than the pen. Real ink would fill it, so thicken the inner side along the loop until it closes.
  const segGrid = new Map<number, number[]>();
  for (let k = 0; k < n - 1; k++) {
    const mx = (samples[k].p.x + samples[k + 1].p.x) / 2;
    const my = (samples[k].p.y + samples[k + 1].p.y) / 2;
    const gk = key(Math.floor(mx / cell), Math.floor(my / cell));
    const list = segGrid.get(gk);
    if (list) list.push(k);
    else segGrid.set(gk, [k]);
  }
  for (let k = 0; k < n - 1; k++) {
    const a1 = samples[k].p;
    const a2 = samples[k + 1].p;
    const cx = Math.floor((a1.x + a2.x) / 2 / cell);
    const cy = Math.floor((a1.y + a2.y) / 2 / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const m of segGrid.get(key(cx + dx, cy + dy)) ?? []) {
          if (m <= k + 8) continue;
          const X = segmentIntersection(a1, a2, samples[m].p, samples[m + 1].p);
          if (!X) continue;
          // The loop is X -> p[k+1] .. p[m] -> X.
          const poly: Vec2[] = [X];
          for (let i = k + 1; i <= m; i++) poly.push(samples[i].p);
          let area2 = 0;
          for (let i = 0; i < poly.length; i++) {
            const u = poly[i];
            const v = poly[(i + 1) % poly.length];
            area2 += u.x * v.y - v.x * u.y;
          }
          const perimeter = arc[m] - arc[k + 1] + distance(X, samples[k + 1].p) + distance(samples[m].p, X);
          if (perimeter < 4 || perimeter > LOOP_MAX_PERIMETER) continue;
          let hSum = 0;
          for (let i = k + 1; i <= m; i++) hSum += half[i];
          const hole = inscribedRadius(poly) - hSum / (m - k);
          if (hole <= 0 || hole > LOOP_HOLE_CLOSE) continue;
          const side = area2 > 0 ? left : right; // inside of the loop: the side the path turns toward
          const need = hole + 0.5;
          for (let i = k + 1; i <= m; i++) if (need > side[i]) side[i] = need;
        }
      }
    }
  }

  // Spread each bridge over its neighbours (max filter), then smooth, so it ramps in and out.
  for (const side of [left, right]) {
    const spread = side.slice();
    for (let i = 0; i < n; i++) {
      if (side[i] === 0) continue;
      for (let k = Math.max(0, i - 4); k <= Math.min(n - 1, i + 4); k++) spread[k] = Math.max(spread[k], side[i]);
    }
    let cur = spread;
    for (let pass = 0; pass < 2; pass++) {
      const next = cur.slice();
      for (let i = 1; i < n - 1; i++) next[i] = 0.25 * cur[i - 1] + 0.5 * cur[i] + 0.25 * cur[i + 1];
      cur = next;
    }
    for (let i = 0; i < n; i++) side[i] = cur[i];
  }
  return { left, right };
}

/**
 * How far each edge may be offset before it folds over itself.
 *
 * On the inside of a bend, an offset larger than the local radius of
 * curvature crosses the centre of the bend and the edge turns back on itself
 * in a small loop wound the *opposite* way. Under the non-zero fill rule that
 * loop cancels the stroke body where they overlap, which punches hairline
 * cracks and small pockets into thick strokes. Limiting the inner offset to
 * the radius removes the loop (at a true cusp the radius is 0, so the inner
 * edge collapses onto the turning point while the outer edge sweeps the round
 * tip). The outer side is never limited.
 */
function innerReach(samples: readonly Sample[]): { left: number[]; right: number[] } {
  const n = samples.length;
  const left = new Array<number>(n).fill(Infinity);
  const right = new Array<number>(n).fill(Infinity);
  // The normal is n = perp(T), so the tangent is T = -perp(n).
  const tangent = (s: Sample): Vec2 => scale(perp(s.n), -1);
  for (let i = 0; i < n; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(n - 1, i + 1)];
    const ta = tangent(a);
    const tb = tangent(b);
    const turn = Math.atan2(ta.x * tb.y - ta.y * tb.x, dot(ta, tb)); // > 0: bending toward the left normal
    if (Math.abs(turn) < 1e-6) continue;
    const radius = distance(a.p, b.p) / Math.abs(turn);
    if (turn > 0) left[i] = radius;
    else right[i] = radius;
  }
  return { left, right };
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
