import {
  bezierLength,
  bezierTangent,
  lineToBezier,
  outlineToPath,
  segmentsToPathData,
  strokeToOutline,
  type CubicBezier,
} from '@signflow/core';
import { escapeXml, sanitizeNumber } from './sanitize';
import { backgroundRect, layoutDrawing, svgOpen, type DrawingLayout, type StaticSvgOptions, type ViewBox } from './layout';
import { indexSegments, sliceStroke } from './slice';
import { buildTimeline, easingInverse, resolveAnimation, type AnimationOptions, type ResolvedAnimation, type Timeline } from './timeline';

export interface AnimatedSvgOptions extends StaticSvgOptions, AnimationOptions {
  /**
   * Variable-width strokes are revealed slice by slice, each slice through its own mask, so ink
   * belonging to a later part of the stroke can never show through an earlier part's mask where the
   * path crosses itself. Target slice length in px; 0 disables slicing (one mask per stroke).
   * Default 70.
   */
  chunkLength?: number;
}

export interface AnimatedSvg {
  svg: string;
  width: number;
  height: number;
  viewBox: ViewBox;
  /** Length of one animation cycle in ms (drawing + hold when looping). */
  cycle: number;
  /** When each stroke starts / ends drawing, in ms. */
  timeline: Timeline;
}

/** Gap kept on both sides of the dash so neither end of a round cap can show before/after the reveal. */
const MARGIN = 2;
/** Neighbouring slices overlap by this much (px) so no antialiasing seam can show between them. */
const OVERLAP = 1.5;
const DEFAULT_CHUNK = 70;

/** The chain with straight lines added `before` / `after` px beyond its ends, along the end tangents. */
function extend(segments: readonly CubicBezier[], before: number, after: number): CubicBezier[] {
  const first = segments[0];
  const last = segments[segments.length - 1];
  const out = segments.slice();
  if (before > 0) {
    const t = bezierTangent(first, 0);
    out.unshift(lineToBezier({ x: first.p0.x - t.x * before, y: first.p0.y - t.y * before }, first.p0));
  }
  if (after > 0) {
    const t = bezierTangent(last, 1);
    out.push(lineToBezier(last.p3, { x: last.p3.x + t.x * after, y: last.p3.y + t.y * after }));
  }
  return out;
}

function chainLength(segments: readonly CubicBezier[]): number {
  let l = 0;
  for (const s of segments) l += bezierLength(s);
  return l;
}

/**
 * A standalone animated SVG that writes the signature stroke by stroke, in
 * the original order, using only CSS (no JavaScript, works in `<img>`).
 *
 *  - Constant width: each stroke's centre line is revealed with
 *    `stroke-dasharray` / `stroke-dashoffset`.
 *  - Variable width: the filled outline is cut into short slices; each slice
 *    is revealed through a mask holding just its own piece of centre line,
 *    animated the same way, so the ink follows the real pen path and nothing
 *    appears ahead of the pen where the path crosses itself.
 *
 * The *default* (un-animated) state is the finished signature; the hidden
 * state exists only inside the keyframes. Viewers that do not run CSS
 * animations, and users with `prefers-reduced-motion`, therefore see the
 * complete drawing rather than an empty image.
 */
export function buildAnimatedSvg(o: AnimatedSvgOptions): AnimatedSvg {
  const l = layoutDrawing(o);
  const anim = resolveAnimation(o);
  const chunk = o.chunkLength === 0 ? 0 : sanitizeNumber(o.chunkLength, DEFAULT_CHUNK, 20, 100_000);
  const lengths = l.items.map((it) => (it.stroke.isDot ? 0 : it.stroke.length));
  const timeline = buildTimeline(lengths, anim);
  return { svg: serialize(l, anim, timeline, chunk), width: l.width, height: l.height, viewBox: l.viewBox, cycle: timeline.cycle, timeline };
}

function serialize(l: DrawingLayout, anim: ResolvedAnimation, tl: Timeline, chunk: number): string {
  const f = l.fmt;
  const pct = (ms: number) => Math.min(100, Math.max(0, +((ms / tl.cycle) * 100).toFixed(3)));
  const iterations = anim.loop ? 'infinite' : '1';
  const inverse = easingInverse(anim.easing);
  const css: string[] = [];
  const defs: string[] = [];
  const paths: string[] = [];
  const maskHalf = (l.strokeWidth * l.maxRelativeWidth) / 2 + 1;

  /** Dash-reveal rule + keyframes for one animated element, hidden until `startPct`, fully drawn at `endPct`. */
  const reveal = (cls: string, kf: string, len: number, startPct: number, endPct: number, timing: string) => {
    const dash = Math.ceil(len * 100) / 100 + 0.5;
    const gap = dash + 2 * MARGIN;
    const hidden = dash + MARGIN;
    css.push(
      `.${cls}{stroke-dasharray:${f(dash)} ${f(gap)};animation:${kf} ${Math.round(tl.cycle)}ms linear ${iterations} both}` +
        `@keyframes ${kf}{` +
        (startPct > 0 ? `0%{stroke-dashoffset:${f(hidden)}}` : '') +
        `${startPct}%{stroke-dashoffset:${f(hidden)};animation-timing-function:${timing}}` +
        `${endPct}%{stroke-dashoffset:0}` +
        (endPct < 100 ? `100%{stroke-dashoffset:0}` : '') +
        `}`,
    );
  };

  l.items.forEach((it, i) => {
    const s = it.stroke;
    const start = tl.starts[i];
    const end = tl.ends[i];

    if (s.isDot) {
      // A tap simply appears.
      const cls = `sf-a${i}`;
      css.push(`.${cls}{animation:sf-k${i} ${Math.round(tl.cycle)}ms linear ${iterations} both}@keyframes sf-k${i}{0%,${pct(start)}%{opacity:0}${pct(end)}%,100%{opacity:1}}`);
      paths.push(`<path class="${cls}" d="${it.d}"/>`);
      return;
    }

    if (!l.variable) {
      // Constant width: the stroke itself is revealed, eased as one piece.
      reveal(`sf-a${i}`, `sf-k${i}`, s.length, pct(start), pct(end), anim.easing);
      paths.push(`<path class="sf-a${i}" d="${it.d}"/>`);
      return;
    }

    // Variable width: slices, each with its own outline and its own mask.
    const idx = indexSegments(s.segments);
    const L = idx.total;
    const count = chunk > 0 ? Math.max(1, Math.round(L / chunk)) : 1;
    const timeAt = (pos: number) => start + (end - start) * inverse(Math.min(1, Math.max(0, pos / L)));

    for (let k = 0; k < count; k++) {
      const first = k === 0;
      const lastSlice = k === count - 1;
      const from = first ? 0 : (L * k) / count - OVERLAP;
      const to = lastSlice ? L : (L * (k + 1)) / count + OVERLAP;
      const slice = count === 1 ? s : sliceStroke(s, idx, from, to);
      const outline =
        count === 1
          ? it.d
          : outlineToPath(strokeToOutline(slice, l.strokeWidth, 'final', { start: first ? 'round' : 'butt', end: lastSlice ? 'round' : 'butt' }), l.precision);

      // The mask path is the slice's centre line, extended at the stroke's ends so the round caps are revealed.
      const maskSegs = extend(slice.segments, first ? maskHalf : 0, lastSlice ? maskHalf : 0);
      const len = chainLength(maskSegs);
      const j = count === 1 ? `${i}` : `${i}-${k}`;
      // The slice is revealed over the time the pen needs to cover its range of the path.
      const t0 = timeAt(first ? -maskHalf : from);
      const t1 = timeAt(lastSlice ? L + maskHalf : to);

      reveal(`sf-a${j}`, `sf-k${j}`, len, pct(t0), pct(Math.max(t1, t0)), 'linear');
      defs.push(
        `<mask id="sf-m${j}"><path class="sf-a${j}" d="${segmentsToPathData(maskSegs, l.precision)}" fill="none" stroke="#fff" stroke-width="${f(maskHalf * 2)}" stroke-linejoin="round"/></mask>`,
      );
      paths.push(`<path d="${outline}" mask="url(#sf-m${j})"/>`);
    }
  });

  css.push(`@media (prefers-reduced-motion:reduce){[class^="sf-a"]{animation:none}}`);

  const color = escapeXml(l.color);
  const group = l.variable
    ? `<g fill="${color}">${paths.join('')}</g>`
    : `<g fill="none" stroke="${color}" stroke-width="${f(l.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g>`;

  return svgOpen(l) + `<style>${css.join('')}</style>` + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + backgroundRect(l) + group + '</svg>';
}
