import { bezierTangent, lineToBezier, segmentsToPathData, type CubicBezier, type Stroke } from '@signflow/core';
import { escapeXml } from './sanitize';
import { backgroundRect, layoutDrawing, svgOpen, type DrawingLayout, type StaticSvgOptions, type ViewBox } from './layout';
import { buildTimeline, resolveAnimation, type AnimationOptions, type ResolvedAnimation, type Timeline } from './timeline';

export type AnimatedSvgOptions = StaticSvgOptions & AnimationOptions;

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

/** Centre line extended by `e` along the end tangents, so a butt-capped mask also reveals the round start/end caps. */
function extendedCenterline(stroke: Stroke, e: number): CubicBezier[] {
  const first = stroke.segments[0];
  const last = stroke.segments[stroke.segments.length - 1];
  const t0 = bezierTangent(first, 0);
  const t1 = bezierTangent(last, 1);
  const a = { x: first.p0.x - t0.x * e, y: first.p0.y - t0.y * e };
  const b = { x: last.p3.x + t1.x * e, y: last.p3.y + t1.y * e };
  return [lineToBezier(a, first.p0), ...stroke.segments, lineToBezier(last.p3, b)];
}

/**
 * A standalone animated SVG that writes the signature stroke by stroke, in
 * the original order, using only CSS (no JavaScript, works in `<img>`).
 *
 *  - Constant width: each stroke's centre line is revealed with
 *    `stroke-dasharray` / `stroke-dashoffset`.
 *  - Variable width: the filled outline is revealed through a mask that
 *    contains the (slightly extended) centre line, animated the same way, so
 *    the ink still appears to follow the real pen path.
 *
 * The *default* (un-animated) state is the finished signature; the hidden
 * state exists only inside the keyframes. Viewers that do not run CSS
 * animations, and users with `prefers-reduced-motion`, therefore see the
 * complete drawing rather than an empty image.
 */
export function buildAnimatedSvg(o: AnimatedSvgOptions): AnimatedSvg {
  const l = layoutDrawing(o);
  const anim = resolveAnimation(o);
  const lengths = l.items.map((it) => (it.stroke.isDot ? 0 : it.stroke.length));
  const timeline = buildTimeline(lengths, anim);
  const { svg } = serialize(l, anim, timeline);
  return { svg, width: l.width, height: l.height, viewBox: l.viewBox, cycle: timeline.cycle, timeline };
}

function serialize(l: DrawingLayout, anim: ResolvedAnimation, tl: Timeline): { svg: string } {
  const f = l.fmt;
  const pct = (ms: number) => Math.min(100, Math.max(0, +((ms / tl.cycle) * 100).toFixed(3)));
  const iterations = anim.loop ? 'infinite' : '1';
  const css: string[] = [];
  const defs: string[] = [];
  const paths: string[] = [];
  const maskHalf = (l.strokeWidth * l.maxRelativeWidth) / 2 + 1;

  l.items.forEach((it, i) => {
    const s = it.stroke;
    const start = pct(tl.starts[i]);
    const end = pct(tl.ends[i]);
    const cls = `sf-a${i}`;
    const kf = `sf-k${i}`;
    const run = `animation:${kf} ${Math.round(tl.cycle)}ms linear ${iterations} both`;

    if (s.isDot) {
      // A tap simply appears.
      css.push(`.${cls}{${run}}@keyframes ${kf}{0%,${start}%{opacity:0}${end}%,100%{opacity:1}}`);
      paths.push(`<path class="${cls}" d="${it.d}"/>`);
      return;
    }

    // Variable width reveals the outline through a mask holding the extended centre line.
    const revealD = l.variable ? segmentsToPathData(extendedCenterline(s, maskHalf), l.precision) : it.d;
    const len = l.variable ? s.length + 2 * maskHalf : s.length;
    const dash = Math.ceil(len * 100) / 100 + 0.5;
    const gap = dash + 2 * MARGIN;
    const hidden = dash + MARGIN;

    css.push(
      `.${cls}{stroke-dasharray:${f(dash)} ${f(gap)};${run}}` +
        `@keyframes ${kf}{` +
        (start > 0 ? `0%{stroke-dashoffset:${f(hidden)}}` : '') +
        `${start}%{stroke-dashoffset:${f(hidden)};animation-timing-function:${anim.easing}}` +
        `${end}%{stroke-dashoffset:0}` +
        (end < 100 ? `100%{stroke-dashoffset:0}` : '') +
        `}`,
    );

    if (l.variable) {
      const v = l.viewBox;
      defs.push(
        `<mask id="sf-m${i}" maskUnits="userSpaceOnUse" x="${f(v.x)}" y="${f(v.y)}" width="${f(v.width)}" height="${f(v.height)}">` +
          `<path class="${cls}" d="${revealD}" fill="none" stroke="#fff" stroke-width="${f(maskHalf * 2)}" stroke-linejoin="round"/></mask>`,
      );
      paths.push(`<path d="${it.d}" mask="url(#sf-m${i})"/>`);
    } else {
      paths.push(`<path class="${cls}" d="${revealD}"/>`);
    }
  });

  css.push(`@media (prefers-reduced-motion:reduce){[class^="sf-a"]{animation:none}}`);

  const color = escapeXml(l.color);
  const group = l.variable
    ? `<g fill="${color}">${paths.join('')}</g>`
    : `<g fill="none" stroke="${color}" stroke-width="${f(l.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</g>`;

  return {
    svg:
      svgOpen(l) +
      `<style>${css.join('')}</style>` +
      (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
      backgroundRect(l) +
      group +
      '</svg>',
  };
}
