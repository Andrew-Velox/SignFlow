import { escapeXml } from './sanitize';
import { backgroundRect, layoutDrawing, svgOpen, type StaticSvgOptions, type ViewBox } from './layout';

export type { StaticSvgOptions, ViewBox } from './layout';

export interface StaticSvg {
  svg: string;
  /** Rendered size in px. */
  width: number;
  height: number;
  viewBox: ViewBox;
}

/**
 * A standalone, dependency-free SVG of the signature: real vector paths in
 * stroke order, transparent background by default, no scripts or external
 * references.
 */
export function buildStaticSvg(o: StaticSvgOptions): StaticSvg {
  const l = layoutDrawing(o);
  const body = l.items.map((it) => `<path d="${it.d}"/>`).join('');
  const color = escapeXml(l.color);
  const group = l.variable
    ? `<g fill="${color}">${body}</g>`
    : `<g fill="none" stroke="${color}" stroke-width="${l.fmt(l.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
  return {
    svg: svgOpen(l) + backgroundRect(l) + group + '</svg>',
    width: l.width,
    height: l.height,
    viewBox: l.viewBox,
  };
}
