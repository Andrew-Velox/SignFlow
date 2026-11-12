import {
  bezierBounds,
  formatNumber,
  outlineToPath,
  rotatePoint,
  rotateStroke,
  segmentsToPathData,
  strokeBounds,
  strokeToOutline,
  unionBounds,
  type Bounds,
  type Stroke,
} from '@signflow/core';
import { escapeXml, sanitizeColor, sanitizeNumber } from './sanitize';

export interface StaticSvgOptions {
  strokes: readonly Stroke[];
  /** Logical drawing size; becomes the viewBox unless `crop` is set. */
  width: number;
  height: number;
  /** Base pen width in logical units. */
  strokeWidth: number;
  color?: string;
  /** true: filled pressure/speed-tapered outlines. false: constant-width round-capped strokes. */
  variableWidth?: boolean;
  /** Fit the viewBox tightly around the ink (plus `padding`). */
  crop?: boolean;
  /** Margin around the ink in logical units when cropping. */
  padding?: number;
  /**
   * Rotates the whole signature by this many degrees, clockwise (negative = counter-clockwise). The ink turns
   * about its own centre when cropping, and the page turns about its centre otherwise; in both cases the
   * viewBox grows to contain the result, so nothing is clipped. 0 (default) leaves the output unchanged.
   */
  rotation?: number;
  /** Rendered width of the `<svg>` in px (height follows the aspect ratio). Defaults to the viewBox size. */
  outputWidth?: number;
  /** null / undefined = transparent (default). */
  background?: string | null;
  title?: string;
  /** Decimal places in path data. */
  precision?: number;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutItem {
  stroke: Stroke;
  /** Variable mode: closed outline (fill). Constant mode: centre line (stroke). */
  d: string;
}

export interface DrawingLayout {
  precision: number;
  strokeWidth: number;
  color: string;
  variable: boolean;
  title: string;
  background: string;
  viewBox: ViewBox;
  /** Rendered size in px. */
  width: number;
  height: number;
  items: LayoutItem[];
  /** Largest relative pen width of any stroke (1 = base width). */
  maxRelativeWidth: number;
  fmt: (n: number) => string;
}

const MAX_SIZE = 100_000;

/** Sanitises the options, converts strokes to path data and works out the viewBox. Shared by static and animated output. */
export function layoutDrawing(o: StaticSvgOptions): DrawingLayout {
  const precision = Math.round(sanitizeNumber(o.precision, 2, 0, 6));
  const strokeWidth = sanitizeNumber(o.strokeWidth, 4, 0.1, 500);
  const variable = o.variableWidth ?? true;
  const fmt = (n: number) => formatNumber(n, precision);

  const fullW = sanitizeNumber(o.width, 960, 1, MAX_SIZE);
  const fullH = sanitizeNumber(o.height, 420, 1, MAX_SIZE);
  const rotation = sanitizeNumber(o.rotation, 0, -3600, 3600);
  const turned = rotation % 360 !== 0;

  // Rotation is applied to the stroke geometry itself (rigid), so the outline, the crop box, the animation and
  // the PNG are all derived from the rotated shape and no `transform` attribute is needed in the file.
  let strokes: readonly Stroke[] = o.strokes;
  let pivot = { x: fullW / 2, y: fullH / 2 };
  if (turned) {
    if (o.crop) {
      let c: Bounds | null = null;
      for (const s of o.strokes) {
        const b = strokeBounds(s);
        if (b) c = unionBounds(c, b);
      }
      if (c) pivot = { x: (c.minX + c.maxX) / 2, y: (c.minY + c.maxY) / 2 };
    }
    strokes = o.strokes.map((s) => rotateStroke(s, rotation, pivot));
  }

  let ink: Bounds | null = null;
  let maxRel = 1;
  const items: LayoutItem[] = [];
  for (const s of strokes) {
    if (!s.segments.length) continue;
    for (const w of s.widthProfile) maxRel = Math.max(maxRel, w.w);
    if (variable) {
      const outline = strokeToOutline(s, strokeWidth, 'final');
      if (!outline.length) continue;
      for (const seg of outline) ink = unionBounds(ink, bezierBounds(seg));
      items.push({ stroke: s, d: outlineToPath(outline, precision) });
    } else {
      const half = strokeWidth / 2;
      for (const seg of s.segments) {
        const b = bezierBounds(seg);
        ink = unionBounds(ink, { minX: b.minX - half, minY: b.minY - half, maxX: b.maxX + half, maxY: b.maxY + half });
      }
      items.push({ stroke: s, d: segmentsToPathData(s.segments, precision) });
    }
  }

  let viewBox: ViewBox = { x: 0, y: 0, width: fullW, height: fullH };
  if (turned && !o.crop) {
    // The whole page is turned: use the bounding box of the rotated page so no corner is cut off.
    const corners = [
      { x: 0, y: 0 },
      { x: fullW, y: 0 },
      { x: fullW, y: fullH },
      { x: 0, y: fullH },
    ].map((p) => rotatePoint(p, rotation, pivot));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const x = Math.floor(Math.min(...xs) * 100) / 100;
    const y = Math.floor(Math.min(...ys) * 100) / 100;
    viewBox = {
      x,
      y,
      width: Math.max(1, Math.ceil((Math.max(...xs) - x) * 100) / 100),
      height: Math.max(1, Math.ceil((Math.max(...ys) - y) * 100) / 100),
    };
  }
  if (o.crop && ink) {
    const pad = sanitizeNumber(o.padding, 8, 0, 1000);
    // Round outwards so antialiased edges are never clipped.
    const x = Math.floor((ink.minX - pad) * 100) / 100;
    const y = Math.floor((ink.minY - pad) * 100) / 100;
    viewBox = {
      x,
      y,
      width: Math.max(1, Math.ceil((ink.maxX + pad - x) * 100) / 100),
      height: Math.max(1, Math.ceil((ink.maxY + pad - y) * 100) / 100),
    };
  }

  const outW = sanitizeNumber(o.outputWidth, viewBox.width, 1, MAX_SIZE);
  return {
    precision,
    strokeWidth,
    color: sanitizeColor(o.color, '#000000'),
    variable,
    title: o.title ?? 'Signature',
    background: o.background ? sanitizeColor(o.background, '') : '',
    viewBox,
    width: outW,
    height: (outW * viewBox.height) / viewBox.width,
    items,
    maxRelativeWidth: maxRel,
    fmt,
  };
}

/** `<svg …><title>…</title>` */
export function svgOpen(l: DrawingLayout): string {
  const f = l.fmt;
  const t = escapeXml(l.title);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(l.viewBox.x)} ${f(l.viewBox.y)} ${f(l.viewBox.width)} ${f(l.viewBox.height)}" ` +
    `width="${f(l.width)}" height="${f(l.height)}" role="img" aria-label="${t}"><title>${t}</title>`
  );
}

export function backgroundRect(l: DrawingLayout): string {
  if (!l.background) return '';
  const f = l.fmt;
  const v = l.viewBox;
  return `<rect x="${f(v.x)}" y="${f(v.y)}" width="${f(v.width)}" height="${f(v.height)}" fill="${escapeXml(l.background)}"/>`;
}
