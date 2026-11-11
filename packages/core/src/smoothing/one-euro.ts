import type { InputPoint, Vec2 } from '../types';

const TWO_PI = Math.PI * 2;

/** Smoothing factor of a first-order low-pass with cutoff `fc` (Hz) at time step `dt` (s). */
export function lowPassAlpha(fc: number, dt: number): number {
  const tau = 1 / (TWO_PI * fc);
  return 1 / (1 + tau / dt);
}

/** Smallest time step we accept (s); guards duplicate timestamps from coalesced events. */
export const MIN_DT = 0.001;
/** Largest time step (s); long pauses should not make the filter "forget" more than needed. */
export const MAX_DT = 0.1;
/** Used when timestamps are missing / non-monotonic. */
export const FALLBACK_DT = 1 / 120;

/**
 * Time steps (seconds) between consecutive samples, repaired so they are
 * always within [MIN_DT, MAX_DT]. Synthetic input without timestamps
 * (all equal) gets a uniform fallback.
 */
export function timeSteps(points: readonly InputPoint[]): number[] {
  const out = new Array<number>(points.length).fill(FALLBACK_DT);
  let valid = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i].t - points[i - 1].t) / 1000;
    if (dt > 0) valid++;
  }
  if (valid < (points.length - 1) / 2) return out; // timestamps unusable
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i].t - points[i - 1].t) / 1000;
    out[i] = Math.min(MAX_DT, Math.max(MIN_DT, dt > 0 ? dt : FALLBACK_DT));
  }
  return out;
}

/**
 * Two-dimensional One Euro filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 * An adaptive first-order low-pass whose cutoff rises with pointer speed:
 * heavy smoothing while slow (removes jitter), almost none while fast
 * (removes lag). Speed is the magnitude of the 2D velocity vector, so x and y
 * always share one cutoff and the filter never distorts directions.
 */
export class OneEuroFilter2D {
  private x = 0;
  private y = 0;
  private dx = 0;
  private dy = 0;
  private started = false;
  private seeded = false;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly derivativeCutoff = 6,
  ) {}

  reset(): void {
    this.started = false;
    this.seeded = false;
  }

  /** Filters one sample. `dt` is seconds since the previous sample. */
  filter(p: Vec2, dt: number): Vec2 {
    if (!this.started) {
      this.started = true;
      this.x = p.x;
      this.y = p.y;
      this.dx = 0;
      this.dy = 0;
      return { x: p.x, y: p.y };
    }
    const step = Math.min(MAX_DT, Math.max(MIN_DT, dt));
    if (!this.seeded) {
      // Seed the speed estimate from the first real delta instead of ramping up from zero.
      // Otherwise the first ~10 samples are over-smoothed and short strokes end short of the pen.
      this.seeded = true;
      this.dx = (p.x - this.x) / step;
      this.dy = (p.y - this.y) / step;
    } else {
      const ad = lowPassAlpha(this.derivativeCutoff, step);
      this.dx += ad * ((p.x - this.x) / step - this.dx);
      this.dy += ad * ((p.y - this.y) / step - this.dy);
    }
    const speed = Math.hypot(this.dx, this.dy);
    const a = lowPassAlpha(this.minCutoff + this.beta * speed, step);
    this.x += a * (p.x - this.x);
    this.y += a * (p.y - this.y);
    return { x: this.x, y: this.y };
  }
}

/**
 * Zero-phase smoothing for finished strokes.
 *
 * A causal filter always trails the pen: every feature is delayed, so turns
 * land late and strokes shift along the direction of travel. Here the signal
 * is low-passed once forward and once backward and the results averaged: the
 * opposite-signed delays cancel exactly (zero phase), so features stay where
 * the hand put them. (Amplitude is attenuated *more* than by one pass, since
 * the averaged response is Re(H) = |H|² for a first-order filter; the
 * smoothing parameters are tuned with that in mind.)
 *
 * For the cancellation to be exact both passes must use the *same* cutoff at
 * each sample, so the One Euro speed term is estimated once, non-causally
 * (central differences, lightly blurred) instead of by each pass's own
 * start-up-limited derivative filter. This is also why it can use the same
 * `minCutoff`/`beta` semantics as the live filter. End points stay pinned to
 * the raw first/last sample.
 */
export function smoothZeroPhase(points: readonly InputPoint[], minCutoff: number, beta: number): Vec2[] {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const dts = timeSteps(points);

  // Non-causal speed estimate (px/s).
  let speed = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let span = 0;
    for (let k = a + 1; k <= b; k++) span += dts[k];
    speed[i] = Math.hypot(points[b].x - points[a].x, points[b].y - points[a].y) / span;
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = speed.slice();
    for (let i = 1; i < n - 1; i++) next[i] = 0.25 * speed[i - 1] + 0.5 * speed[i] + 0.25 * speed[i + 1];
    speed = next;
  }
  const cutoff = speed.map((v) => minCutoff + beta * v);

  const fwd = new Array<Vec2>(n);
  fwd[0] = { x: points[0].x, y: points[0].y };
  for (let i = 1; i < n; i++) {
    const a = lowPassAlpha(cutoff[i], dts[i]);
    fwd[i] = { x: fwd[i - 1].x + a * (points[i].x - fwd[i - 1].x), y: fwd[i - 1].y + a * (points[i].y - fwd[i - 1].y) };
  }
  const bwd = new Array<Vec2>(n);
  bwd[n - 1] = { x: points[n - 1].x, y: points[n - 1].y };
  for (let i = n - 2; i >= 0; i--) {
    const a = lowPassAlpha(cutoff[i], dts[i + 1]);
    bwd[i] = { x: bwd[i + 1].x + a * (points[i].x - bwd[i + 1].x), y: bwd[i + 1].y + a * (points[i].y - bwd[i + 1].y) };
  }

  const out = new Array<Vec2>(n);
  for (let i = 0; i < n; i++) out[i] = { x: (fwd[i].x + bwd[i].x) / 2, y: (fwd[i].y + bwd[i].y) / 2 };
  out[0] = { x: points[0].x, y: points[0].y };
  out[n - 1] = { x: points[n - 1].x, y: points[n - 1].y };
  return out;
}
