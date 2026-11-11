import type { InputPoint, WidthSample } from '../types';
import { clamp, clamp01, cumulativeLength, lerp, smoothstep } from '../geometry/math';

export interface WidthParams {
  hasPressure: boolean;
  pressureSensitivity: number;
  velocitySensitivity: number;
  /** 0..1: how much tight bends thicken the stroke. */
  curvature: number;
  taper: number;
}

/** Speed (px/s) at which the velocity effect saturates. */
const SPEED_MAX = 2200;
/** Assumed speed when timestamps are unusable. */
const SPEED_DEFAULT = 700;
/** Length (px) of the end taper at taper = 1. */
const TAPER_LENGTH = 26;
/** Max change of relative width per px of arc length (before taper). */
export const MAX_WIDTH_SLOPE = 0.04;
/** Half-width (px of arc length) of the window the bend is measured over. */
const BEND_WINDOW = 9;
/** Curvature (rad per px) at which the bend effect is fully on: radius ≈ 40 px, i.e. every real bend of a signature. */
const BEND_FULL = 1 / 40;
/** At curvature = 1: extra relative width on a full bend... */
const BEND_GAIN = 0.9;
/** ...and how much thinner a straight run gets. The contrast comes from both sides, so average weight stays put. */
const STRAIGHT_THIN = 0.3;
const MIN_WIDTH = 0.12;
const MAX_WIDTH = 1.9;

/**
 * Relative width along a stroke, from three independent cues:
 *
 *  1. Pressure (pen / pressure-capable touch): w *= 0.25 + 1.5·p, so p = 0.5
 *     keeps the base width.
 *  2. Speed (any device): fast flicks get thinner, slow, deliberate
 *     movement thicker, like a fountain pen. This is what makes mouse
 *     signatures look inked rather than "vector-flat".
 *  3. Taper: the line narrows toward both ends, more at the exit (pen lift)
 *     than at the entry.
 *
 * The result is smoothed, then reduced to the few samples that matter
 * (Ramer–Douglas–Peucker on the width axis), keyed by normalised arc length
 * so it remains valid when the centre line is re-fitted.
 */
export function computeWidthProfile(points: readonly InputPoint[], params: WidthParams): WidthSample[] {
  const n = points.length;
  if (n < 2) return [];
  const arc = cumulativeLength(points);
  const total = arc[n - 1];
  if (total < 1e-6) return [];

  const factor = new Array<number>(n).fill(1);

  if (params.velocitySensitivity > 0) {
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 3);
      const i1 = Math.min(n - 1, i + 3);
      const dt = (points[i1].t - points[i0].t) / 1000;
      const speed = dt > 0.004 ? (arc[i1] - arc[i0]) / dt : SPEED_DEFAULT;
      const fv = lerp(1.2, 0.45, smoothstep(speed / SPEED_MAX));
      factor[i] *= lerp(1, fv, params.velocitySensitivity);
    }
  }

  if (params.hasPressure && params.pressureSensitivity > 0) {
    for (let i = 0; i < n; i++) {
      const fp = 0.25 + 1.5 * clamp01(points[i].pressure);
      factor[i] *= lerp(1, fp, params.pressureSensitivity);
    }
  }

  // Thickness may only change so fast per px of pen travel (cf. Atrament's stepped
  // thickness): kills pulsing from noisy speed/pressure without needing heavy blur.
  if (params.curvature > 0) {
    const bend = bendProfile(points, arc);
    for (let i = 0; i < n; i++) factor[i] *= 1 - params.curvature * STRAIGHT_THIN + params.curvature * (STRAIGHT_THIN + BEND_GAIN) * bend[i];
  }

  const smoothed = limitSlope(blur(factor, 3), arc, MAX_WIDTH_SLOPE);

  if (params.taper > 0) {
    const taperLen = Math.min(params.taper * TAPER_LENGTH, total / 2);
    if (taperLen > 1e-6) {
      for (let i = 0; i < n; i++) {
        const rampStart = smoothstep(arc[i] / taperLen);
        const rampEnd = smoothstep((total - arc[i]) / taperLen);
        smoothed[i] *= lerp(lerp(1, 0.55, params.taper), 1, rampStart);
        smoothed[i] *= lerp(lerp(1, 0.18, params.taper), 1, rampEnd);
      }
    }
  }

  const samples: WidthSample[] = smoothed.map((w, i) => ({ u: arc[i] / total, w: clamp(w, MIN_WIDTH, MAX_WIDTH) }));
  return simplifyProfile(samples, 0.04);
}

/**
 * 0..1 per sample: how tightly the path bends there. Measured as the turning
 * angle between the chords `BEND_WINDOW` px behind and ahead, per px of arc
 * length. A fixed arc-length window makes it independent of how densely the
 * pointer was sampled and robust against ±1 px jitter. Near the ends, where
 * a full window does not fit, there is no bend.
 */
function bendProfile(points: readonly InputPoint[], arc: readonly number[]): number[] {
  const n = points.length;
  const out = new Array<number>(n).fill(0);
  let a = 0;
  let b = 0;
  for (let i = 1; i < n - 1; i++) {
    while (a < i - 1 && arc[i] - arc[a + 1] >= BEND_WINDOW) a++;
    if (b < i) b = i;
    while (b < n - 1 && arc[b] - arc[i] < BEND_WINDOW) b++;
    if (arc[i] - arc[a] < BEND_WINDOW * 0.75 || arc[b] - arc[i] < BEND_WINDOW * 0.75) continue;
    const ux = points[i].x - points[a].x;
    const uy = points[i].y - points[a].y;
    const vx = points[b].x - points[i].x;
    const vy = points[b].y - points[i].y;
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (lu < 1e-9 || lv < 1e-9) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
    out[i] = smoothstep(angle / (arc[b] - arc[a]) / BEND_FULL);
  }
  return out;
}

/** Forward + backward slew-rate clamp: the result is Lipschitz with constant `maxSlope` per unit of `arc`. */
export function limitSlope(values: number[], arc: readonly number[], maxSlope: number): number[] {
  const out = values.slice();
  for (let i = 1; i < out.length; i++) {
    const d = maxSlope * (arc[i] - arc[i - 1]);
    out[i] = Math.min(out[i - 1] + d, Math.max(out[i - 1] - d, out[i]));
  }
  for (let i = out.length - 2; i >= 0; i--) {
    const d = maxSlope * (arc[i + 1] - arc[i]);
    out[i] = Math.min(out[i + 1] + d, Math.max(out[i + 1] - d, out[i]));
  }
  return out;
}

/** Repeated [1 2 1]/4 smoothing; end values stay fixed. */
function blur(values: number[], passes: number): number[] {
  let cur = values.slice();
  for (let p = 0; p < passes; p++) {
    const next = cur.slice();
    for (let i = 1; i < cur.length - 1; i++) next[i] = 0.25 * cur[i - 1] + 0.5 * cur[i] + 0.25 * cur[i + 1];
    cur = next;
  }
  return cur;
}

/** Ramer–Douglas–Peucker using the vertical (width) interpolation error. */
export function simplifyProfile(samples: WidthSample[], tolerance: number): WidthSample[] {
  const n = samples.length;
  if (n <= 2) return samples;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const t = (samples[i].u - samples[a].u) / Math.max(1e-12, samples[b].u - samples[a].u);
      const err = Math.abs(samples[i].w - lerp(samples[a].w, samples[b].w, t));
      if (err > worst) {
        worst = err;
        idx = i;
      }
    }
    if (idx >= 0 && worst > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return samples.filter((_, i) => keep[i] === 1);
}

/** Linear interpolation of the width profile at normalised arc length `u`. An empty profile means constant width. */
export function widthAt(profile: readonly WidthSample[], u: number): number {
  const n = profile.length;
  if (n === 0) return 1;
  if (u <= profile[0].u) return profile[0].w;
  if (u >= profile[n - 1].u) return profile[n - 1].w;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid].u <= u) lo = mid;
    else hi = mid;
  }
  const span = profile[hi].u - profile[lo].u;
  return span <= 1e-12 ? profile[lo].w : lerp(profile[lo].w, profile[hi].w, (u - profile[lo].u) / span);
}
