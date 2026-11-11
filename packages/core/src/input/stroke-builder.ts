import type { InputPoint, PointerKind, RawStroke, Stroke, Vec2 } from '../types';
import { cubicBSplineToBezier } from '../geometry/bspline';
import { distance } from '../geometry/math';
import { OneEuroFilter2D } from '../smoothing/one-euro';
import { type ProcessOptions, resolveOptions, resolveSmoothing } from '../smoothing/options';
import { dotStroke, emptyStroke, segmentsLength, strokeHasPressure } from '../smoothing/process-stroke';
import { computeWidthProfile } from '../smoothing/width';
import { compactSegments } from '../smoothing/compact';

/**
 * Incremental stroke capture for *live* feedback while the pen is down.
 *
 * Two parallel records are kept:
 *  - `raw`: every sample exactly as received (the source of truth),
 *  - a causally filtered copy (One Euro; no look-ahead), resampled to evenly
 *    spaced control points (every few px of travel) and drawn as a uniform
 *    cubic B-spline. Even spacing makes the smoothing depend on distance
 *    instead of pointer speed, the B-spline approximates instead of
 *    interpolating (so leftover jitter is averaged out) and is C2 smooth,
 *    and it is local: appending a sample never changes already-drawn geometry.
 *
 * `finish()` returns the same curve compacted to few segments (≤ 0.2 px
 * change), so the stroke does not visibly change when the pen is lifted.
 * `processStroke` replays `raw` through this class, so re-processing a stored
 * stroke with the same options reproduces exactly what was drawn.
 */
export class StrokeBuilder {
  private readonly rawPoints: InputPoint[] = [];
  private readonly livePoints: InputPoint[] = [];
  private filter: OneEuroFilter2D;
  private readonly minDistance: number;
  private lastT = 0;
  private readonly spacing: number;
  /** Evenly spaced control points along the filtered path. */
  private readonly controls: Vec2[] = [];
  private tip: Vec2 | null = null;
  /** Path length travelled since the last control point. */
  private carried = 0;
  private opts: ProcessOptions;

  constructor(
    readonly id: string,
    readonly pointerKind: PointerKind,
    options: Partial<ProcessOptions> = {},
  ) {
    this.opts = resolveOptions(options);
    const r = resolveSmoothing(this.opts.smoothing);
    this.filter = new OneEuroFilter2D(r.minCutoff, r.beta);
    this.minDistance = r.minPointDistance;
    this.spacing = r.resampleSpacing;
  }

  get pointCount(): number {
    return this.rawPoints.length;
  }

  /** Adds a sample (logical canvas coordinates, timestamp in ms). Returns false if it was ignored as non-finite. */
  push(p: InputPoint): boolean {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    const point: InputPoint = { x: p.x, y: p.y, t: p.t, pressure: Number.isFinite(p.pressure) ? p.pressure : 0.5 };
    const dt = this.rawPoints.length ? (point.t - this.lastT) / 1000 : 0;
    this.lastT = point.t;
    this.rawPoints.push(point);

    const f = this.filter.filter(point, dt > 0 ? dt : 1 / 120);
    this.advance(f);
    const prev = this.livePoints[this.livePoints.length - 1];
    if (!prev || distance(prev, f) >= this.minDistance) {
      this.livePoints.push({ x: f.x, y: f.y, t: point.t, pressure: point.pressure });
    }
    return true;
  }

  /**
   * Places a control point every `spacing` px of *path* length along the filtered polyline (causal,
   * deterministic). Walking the path itself, instead of stepping toward the newest point, means
   * controls always lie on the polyline and never cut its corners.
   */
  private advance(f: Vec2): void {
    const prev = this.tip;
    this.tip = { x: f.x, y: f.y };
    if (!prev) {
      this.controls.push({ x: f.x, y: f.y });
      return;
    }
    const len = distance(prev, f);
    if (len < 1e-9) return;
    let s = 0;
    let need = this.spacing - this.carried;
    while (len - s >= need) {
      s += need;
      const k = s / len;
      this.controls.push({ x: prev.x + (f.x - prev.x) * k, y: prev.y + (f.y - prev.y) * k });
      need = this.spacing;
      this.carried = 0;
    }
    this.carried += len - s;
  }

  /** Exact captured data, for storage and re-processing. */
  raw(): RawStroke {
    return { id: this.id, pointerKind: this.pointerKind, points: this.rawPoints.slice() };
  }

  /** The final stroke: identical to {@link preview} within 0.2 px, but compact. */
  finish(): Stroke {
    const s = this.preview();
    if (s.isDot || s.segments.length < 3) return s;
    const segments = compactSegments(s.segments);
    return { ...s, segments, length: segmentsLength(segments) };
  }

  /** Cheap, stable geometry for drawing while the pen is still down. */
  preview(): Stroke {
    const meta = { id: this.id, pointerKind: this.pointerKind };
    const pts = this.livePoints;
    if (pts.length === 0) return emptyStroke(meta);
    if (pts.length === 1) return dotStroke(meta, pts[0]);
    // The control points trail the pen by < `spacing` px, so the live tip is appended as the last one.
    const last = this.controls[this.controls.length - 1];
    const ctrl = this.tip && distance(last, this.tip) > 0.25 ? [...this.controls, this.tip] : this.controls;
    if (ctrl.length < 2) return dotStroke(meta, pts[0]);
    const segments = cubicBSplineToBezier(ctrl);
    return {
      ...meta,
      segments,
      widthProfile: computeWidthProfile(pts, {
        hasPressure: strokeHasPressure({ pointerKind: this.pointerKind, points: this.rawPoints }),
        pressureSensitivity: this.opts.pressureSensitivity,
        velocitySensitivity: this.opts.velocitySensitivity,
        curvature: this.opts.curvature,
        taper: this.opts.taper,
      }),
      length: segmentsLength(segments),
      isDot: false,
    };
  }
}
