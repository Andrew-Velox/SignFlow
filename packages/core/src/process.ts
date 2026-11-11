import type { RawStroke, Stroke } from './types';
import { StrokeBuilder } from './input/stroke-builder';
import { type ProcessOptions, resolveOptions } from './smoothing/options';
import { refineStroke } from './smoothing/process-stroke';

/**
 * Turns captured pointer data into smooth vector geometry. Pure function of
 * (raw, options), so changing options later re-derives from the raw samples.
 *
 * By default the stroke is produced by replaying the samples through the same
 * {@link StrokeBuilder} used for live drawing, so the result is exactly what
 * the user saw while drawing (only compacted). With `refine: true` the
 * offline pipeline is used instead (see {@link refineStroke}).
 */
export function processStroke(raw: RawStroke, options: Partial<ProcessOptions> = {}): Stroke {
  const o = resolveOptions(options);
  if (o.refine) return refineStroke(raw, o);
  const b = new StrokeBuilder(raw.id, raw.pointerKind, o);
  for (const p of raw.points) b.push(p);
  return b.finish();
}
