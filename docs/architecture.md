# SignFlow architecture & algorithm decisions

## Layout

```
packages/core   framework-free engine (types, geometry, smoothing, outline, input)
apps/web        Svelte 5 + Vite app (currently: engine playground)
packages/svg    static + animated SVG generation (done)
```

`@signflow/core` has no runtime dependencies and only one DOM-touching file
(`input/pointer-recorder.ts`), so it can become a standalone npm package.

## Data model

`RawStroke` (exact pointer samples) is the source of truth. `Stroke` (Bezier
centre line + width profile) is *derived* by `processStroke(raw, options)`.
Changing smoothing later re-derives from raw, so it is never lossy.

## Pipeline (what you draw is what you get)

```
pointer samples
 -> One Euro filter (causal, time-based; speed estimate seeded from the first delta)
 -> drop sub-threshold jitter
 -> quadratic midpoint B-spline            <- this is the live ink
 -> width profile: pressure x speed x taper, slope-limited
 -> on release: compactSegments() re-fits the *same* curve within 0.2 px   <- the final stroke
 -> strokeToOutline(): variable-width closed outline for fill
```

`processStroke(raw, options)` replays the raw samples through the same
`StrokeBuilder` used live, so a stored stroke re-processed with the same
options reproduces exactly what was drawn, and nothing is re-derived when the
pen lifts (measured: final vs live <= 0.25 px, identical width profile).

An *offline* pipeline remains behind `refine: true` (`refineStroke`): corner
detection, zero-phase One Euro smoothing, Schneider curve fit. It is more
faithful to sharp turns, but it cannot be used live (appending a sample changes
the fit's segmentation, so all drawn ink would shimmer ~0.5-1 px per frame) and
the ink visibly shifts on release (~0.4 px mean, 1.3 px max).

Live frames draw the outline with `quality: 'live'` (dense offset polyline,
~3x faster than fitting each side); files use `'final'`.

## Trade-offs

| Decision | Alternatives | Why |
|---|---|---|
| One Euro filter | EMA, moving average, Kalman | Adaptive: heavy smoothing when slow (jitter), almost none when fast (lag). With `beta = 1/featureScale`, details larger than `featureScale` px survive at any speed and lag is bounded by ~featureScale/2π px. One slider maps to that single length. |
| Zero-phase (forward+backward), only with `refine` | Causal only | Removes the pen-trailing delay. Not free: amplitude is attenuated like \|H\|², so parameters are tuned for that. Speed is estimated once, non-causally, so both passes use identical cutoffs. |
| Schneider fitting | Catmull-Rom through all samples, B-spline | Interpolating splines reproduce the noise and need one segment per sample. Fitting gives ~1 segment per 7-30 samples under a hard pixel tolerance, G1 at splits. |
| Midpoint B-spline for live preview | Catmull-Rom | Approximates instead of interpolating, so residual jitter is averaged out. Measured on the synthetic set (true-path roughness 0.131): live roughness 0.143-0.160 vs 0.173-0.206 for Catmull-Rom, mean error ~0.38 vs ~0.42 px. Still local and C1. |
| Width slope limit (0.03 / px) | Blur only | Inspired by Atrament's stepped thickness, but per px of travel so it is independent of event rate. Thickness cannot pulse from noisy speed/pressure. |
| Corner split before smoothing | Smooth everything | Prevents rounding deliberate cusps. Detection uses a fixed arc-length arm, so it is independent of sampling rate and tolerant of ±1 px jitter. |
| Filled outline for variable width | Constant-width `stroke` | SVG strokes cannot vary in width. Phase 3 will reveal the outline with a dash-animated centre-line mask so playback still follows the real pen path. |
| Width from speed even for mouse | Pressure only | Gives mouse signatures an inked look; pressure is used on top when the device actually reports it. |

## Animated SVG

Each stroke is revealed in its original order with `stroke-dasharray` /
`stroke-dashoffset`, driven by one CSS `@keyframes` cycle per stroke (all with
the same cycle length, so loops stay in sync). No JavaScript, so it works as
an `<img>`, in CSS backgrounds and inline.

- Timing: drawing time is shared between strokes in proportion to their length (constant pen
  speed), with a minimum per stroke, a configurable pause between strokes, per-stroke easing, and
  optional looping with a hold at the end. It does not replay the *recorded* speed.
- Variable width: SVG cannot dash-animate a filled shape, so each outline is revealed through a
  `<mask>` holding the centre line (extended past both ends so the round caps are revealed),
  animated with the same dash technique.
- The default state is the finished drawing; the hidden state exists only in the keyframes, so
  viewers without animation support (and `prefers-reduced-motion`) show the full signature.
- The dash/gap geometry keeps a margin on both sides so no round-cap dot can appear at the start
  or end of a hidden stroke.
- Known limit: where the path crosses itself (loops), a few px of the later stroke can appear
  slightly early inside the mask band of the earlier one. Constant-width mode has no mask and is
  the most widely compatible choice.

## Measured (synthetic cursive loops, 120 Hz, 0.6 px noise, integer-quantised)

| smoothing | segments (raw: 144 samples) | roughness (true path: 0.131) | mean error vs truth |
|---|---|---|---|
| raw | - | 0.184 | 0.52 px |
| 0.0 | 105 | 0.204 | 0.47 |
| 0.5 | 20 | 0.131 | 0.45 |
| 0.75 | 17 | 0.130 | 0.41 |
| 1.0 | 10 | 0.133 | 0.78 (loops start to flatten) |

## Reference: Atrament

Atrament (raster, per-event recursive pull `p = x - (x - prev) * k`, k ≈ 0.85) feels smooth because the ink glides behind the pointer, never redraws old ink and rate-limits thickness. It smooths *more* at higher speed, depends on event rate, ends short of the cursor and stores no geometry. SignFlow keeps those good properties (incremental/layered drawing, bounded width change) but filters by time, so behaviour does not depend on device event rate, and keeps vector output.

## Known limitations

- The inner side of very tight curves can self-overlap in the outline (harmless under non-zero fill).
- The causal filter makes ink end up to ~0.7 px (smoothing 0.5; up to ~2.5 px at 1.0) behind the pen, and rounds sharp corners by a few px (use `refine` for crisp corners at the cost of a visible settle on release).
- Live frame cost grows linearly with stroke length (~14 ms at ~1100 samples); an incremental outline would make it constant.
- The smoothing mapping is tuned on synthetic data; it needs tuning with real hands.
