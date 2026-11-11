import { clamp01, lerp } from '../geometry/math';

/** User-facing knobs. Everything else is derived so the UI stays simple. */
export interface ProcessOptions {
  /** 0 = faithful to the raw input, 1 = very smooth. Default 0.5. */
  smoothing: number;
  /** Turning angle (degrees, measured over ~`cornerWindow` px) above which the stroke is split into a hard corner. */
  cornerAngle: number;
  /** 0..1: how much real pen/touch pressure modulates width (only used when pressure data exists). */
  pressureSensitivity: number;
  /** 0..1: how much writing speed thins the line (fast = thin), simulating ink pens. Works for mouse too. */
  velocitySensitivity: number;
  /** 0..1: how much bends thicken the line (ink pools where the pen turns). Works for every device. */
  curvature: number;
  /** 0..1: length/strength of the tapered start and end of each stroke. */
  taper: number;
  /**
   * false (default): what you see while drawing *is* the result (WYSIWYG): the final stroke is the
   * live curve, only compacted. true: re-derive the stroke on release with the offline pipeline
   * (zero-phase smoothing, corner preservation, curve fit). More faithful to sharp turns, but the
   * ink visibly shifts (≈0.4 px, up to ≈1.3 px) when the pen is lifted.
   */
  refine: boolean;
}

export const DEFAULT_OPTIONS: Readonly<ProcessOptions> = Object.freeze({
  smoothing: 0.5,
  cornerAngle: 62,
  pressureSensitivity: 0.7,
  velocitySensitivity: 0.35,
  curvature: 0.7,
  taper: 0.5,
  refine: false,
});

/** Low-level parameters derived from the single `smoothing` slider. */
export interface ResolvedSmoothing {
  /** One Euro: cutoff (Hz) when the pen is (almost) still. Lower = steadier. */
  minCutoff: number;
  /** One Euro: cutoff increase per px/s of speed. Equals 1 / featureScale. */
  beta: number;
  /** Samples closer than this (px) to the previous kept sample are dropped. */
  minPointDistance: number;
  /** Max allowed distance (px) between the fitted Béziers and the filtered samples. */
  fitTolerance: number;
  /** Arc-length lever arm (px) for corner detection. */
  cornerWindow: number;
  /** Spacing (px) of the control points the live curve is built from. */
  resampleSpacing: number;
}

/**
 * Maps smoothing ∈ [0, 1] to filter parameters.
 *
 * The key idea is `beta = 1 / featureScale`. A One Euro filter's cutoff grows
 * with speed as `fc = minCutoff + beta·v`; a detail of size L drawn at speed v
 * has frequency content ≈ v / L, so choosing beta = 1/L keeps every feature
 * larger than L un-attenuated at *any* speed, while the residual lag stays
 * bounded by ≈ L / 2π px. Hand tremor and mouse quantisation noise are
 * smaller than L and get removed. `smoothing` is therefore literally "the size
 * of the detail (in px) that is allowed to be erased".
 */
export function resolveSmoothing(smoothing: number): ResolvedSmoothing {
  const s = clamp01(smoothing);
  const featureScale = 1.2 * Math.pow(16 / 1.2, s); // 1.2 px … 16 px, geometric
  return {
    minCutoff: 14 * Math.pow(1 / 14, s), // 14 Hz … 1 Hz
    beta: 1 / featureScale,
    minPointDistance: lerp(0.6, 2.6, s),
    fitTolerance: lerp(0.18, 2.2, s),
    cornerWindow: lerp(5, 9, s),
    resampleSpacing: lerp(2, 5, s),
  };
}

export function resolveOptions(user: Partial<ProcessOptions> = {}): ProcessOptions {
  const o: ProcessOptions = { ...DEFAULT_OPTIONS };
  for (const k of Object.keys(user) as (keyof ProcessOptions)[]) {
    const v = user[k];
    if (k === 'refine') {
      if (typeof v === 'boolean') o.refine = v;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      o[k] = v;
    }
  }
  o.smoothing = clamp01(o.smoothing);
  o.pressureSensitivity = clamp01(o.pressureSensitivity);
  o.velocitySensitivity = clamp01(o.velocitySensitivity);
  o.curvature = clamp01(o.curvature);
  o.taper = clamp01(o.taper);
  return o;
}
