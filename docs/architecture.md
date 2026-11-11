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
 -> resample to evenly spaced control points (every 2-5 px of path)
 -> uniform cubic B-spline (C2 smooth)       <- this is the live ink
 -> width profile: pressure x speed x curvature x taper, slope-limited
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
| Resampled cubic B-spline for live preview | Catmull-Rom, quadratic midpoint spline | Approximates instead of interpolating, so residual jitter is averaged out. Even spacing makes smoothing depend on distance, not pointer speed; the B-spline is C2 and averages three neighbours. Measured on the synthetic set (600 px/s, smoothing 0.5): roughness error 0.0078 vs 0.0167 for the quadratic midpoint spline and ~0.03 for Catmull-Rom, at the same ~0.38 px mean error; 0.91 vs 1.04 px at 1400 px/s. Local (last three segments change) and the final stroke is within 0.2 px of it. |
| Curvature-driven width | Speed only | Heavier on bends, lighter on straights (Atrament-like ink pooling), regardless of pointer speed. Bend = turning angle between chords 9 px behind/ahead per px of arc length, so it does not depend on sampling density. Full effect at radius 40 px. |
| Width slope limit (0.04 / px) | Blur only | Inspired by Atrament's stepped thickness, but per px of travel so it is independent of event rate. Thickness cannot pulse from noisy speed/pressure. |
| Corner split before smoothing | Smooth everything | Prevents rounding deliberate cusps. Detection uses a fixed arc-length arm, so it is independent of sampling rate and tolerant of ±1 px jitter. |
| Gap and small-loop closing in the outline | Leave the exact swept shape | The exact swept shape keeps white where real ink would have run together. Two cases are closed, both only in `final` quality (live frames skip them): **(1) hairline slivers** where a stroke retraces nearly the same path (legs of a cursive loop): if the *closest* other part of the stroke is less than 0.8 px from touching, and this holds along >= 12 px of path, the facing edge thickens just enough to overlap; **(2) tiny loops**: where the centre line crosses itself, the loop's largest inscribed circle minus the pen half-width is measured, and if the hole is thinner than 2 px (a lens) the inner side thickens until it closes. Real counters (the inside of an "e" or "l", ~70 px² and up) are left open. What this deliberately does *not* do: a distance-only rule (any near gap up to 1-2.4 px) fused the legs of every V-shaped joint into a heavy lump (+3-5 % ink), because the gap between converging legs passes through every size on its way to zero. Two things prevent that now: only the nearest partner counts (a diagonal far partner at the "right" distance must not trigger when the adjacent point already overlaps), and short near-gap zones are ignored. Measured: V-joints final/live area 0.998-1.001 at every leg angle; 60 random strokes +0.02-0.09 % ink; small lens holes (up to ~35 px²) close, larger loops are unchanged. The animation measures gaps once on the whole stroke and hands them to every slice, since a slice cannot see the other leg. |
| Inner-offset clamp at bends | Plain offset | On the inside of a bend the edge may not be offset by more than the radius of curvature; beyond that it folds into a reverse-wound loop. Verified harmless against the exact swept shape (identical on 60 strokes), kept as a safeguard. |
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
  `<mask>` holding the centre line (extended past the stroke's ends so the round caps are revealed),
  animated with the same dash technique. The outline is cut into ~70 px slices and every slice has
  its **own** outline and its own mask. With one mask per stroke, a later part of the stroke that
  passes near an earlier part is revealed early through the earlier part's mask (visible as little
  nubs ahead of the pen at crossings and loops). Per-slice masks make that impossible by
  construction. Measured on a crossing-heavy test signature: 5-13 px of ink leaked ahead of the pen
  before, 0 px after, in every frame; the finished frame differs from the static export by 0.24 % of
  its ink pixels (sub-pixel antialiasing). Cost: ~0.8 KB per slice (a 1400 px stroke: 5 KB -> 16 KB).
  The outline's edge points (with the bend clamp, hairline bridging and small-loop closing applied) are
  computed once for the whole stroke (`outlineSamples`); each slice is a contiguous piece of those same points
  (`outlinePiece`), so the slices fit together exactly and their union is the static outline. Recomputing the
  clamps and bridges per slice made the slices differ slightly near loops. The reveal mask band must also be
  wider than the pen by `MAX_OUTLINE_BOOST` (2.5 px), because loop closing deliberately pushes the edges that
  far past the plain pen width: a band sized only for the pen clips the thickening, and the tiny white lens it
  was meant to close reappears *in the animation only* (the canvas and static export looked right).
  Each slice is timed from the stroke's easing curve (inverted), so the slices together follow the
  same easing as the whole stroke. Slices overlap by 1.5 px and have flat joins, so no seam shows.
- The mask path is a polyline, not a curve (`flatten.ts`). The mask is the slice's centre line stroked
  ~14 px wide, and where that is wider than the radius of a bend (every tiny loop or hairpin) the curve
  stroker in Chromium-based browsers (Skia) can fold the offset curve over itself and leave a **hole in the
  band**: a small white triangle inside the loop, in the animation only. Cairo (`rsvg-convert`) does not
  show it, so a Cairo-only check passes while the browser fails. Found by rendering the exported file in
  headless Brave and removing parts one at a time: no masks -> 0 px² of holes; masks with or without the
  animation CSS, with an explicit mask region, or with miter joins -> unchanged; masks as a polyline ->
  0 px². Straight segments with round joins are always the union of rectangles and discs. The polyline is
  flattened to within 0.1 px, and the dash length is that of the *rounded* polyline, so the dash covers it
  exactly. Verified in Brave: static and animated renders agree on 11 zigzag configurations and 24 random
  sharp-hairpin strokes (0 missing and 0 extra ink). Always verify exports in a real browser engine.
- The default state is the finished drawing; the hidden state exists only in the keyframes, so
  viewers without animation support (and `prefers-reduced-motion`) show the full signature.
- The dash/gap geometry keeps a margin on both sides so no round-cap dot can appear at the start
  or end of a hidden stroke.
- Constant-width mode needs no mask at all, and is the smallest and most widely compatible choice.

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

## Outline integrity

The outline must be **one closed, contiguous chain**. Any break, even 1e-6 px, makes the path emitter
start a second subpath, and the fill then closes each piece with its own straight chord: a long thin spike
or a notch cut out of the stroke. Chords are not Bézier segments, so geometry checks that sample the
curves cannot see them; only rasterising does. Every join (edge to cap, cap to edge, chunk to chunk, and
the final closure) therefore goes through `joinLine`, and `segmentsToPathData(..., close = true)` bridges a
break with a line and drops zero-length pieces instead of emitting `M`. Regression tests assert contiguity
over random strokes at two pen widths.

## Known limitations

- The inner side of very tight curves can self-overlap in the outline (harmless under non-zero fill).
- The causal filter makes ink end up to ~0.7 px (smoothing 0.5; up to ~2.5 px at 1.0) behind the pen, and rounds sharp corners by a few px (use `refine` for crisp corners at the cost of a visible settle on release).
- Live frame cost grows linearly with stroke length (~14 ms at ~1100 samples); an incremental outline would make it constant.
- The smoothing mapping is tuned on synthetic data; it needs tuning with real hands.
