import type { CubicBezier } from '../types';

/** Fixed-precision number with trailing zeros (and "-0") removed. */
export function formatNumber(n: number, precision = 2): string {
  const s = n.toFixed(precision);
  if (!s.includes('.')) return s === '-0' ? '0' : s;
  const trimmed = s.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-0' || trimmed === '' ? '0' : trimmed;
}

const EPS = 1e-6;

/**
 * SVG path data (`d` attribute) for a chain of cubic Béziers. A new subpath
 * (`M`) is emitted wherever the chain is not contiguous. Fully collapsed
 * segments become `M x y h0`, which every renderer paints as a round-cap dot.
 *
 * The output is valid for both SVG `<path d>` and canvas `new Path2D(d)`, so
 * the editor canvas and the exported file are drawn from identical geometry.
 */
export function segmentsToPathData(segments: readonly CubicBezier[], precision = 2, close = false): string {
  const f = (n: number) => formatNumber(n, precision);
  let d = '';
  let cx = NaN;
  let cy = NaN;
  let inCurve = false;
  for (const s of segments) {
    const collapsed =
      Math.abs(s.p0.x - s.p3.x) < EPS && Math.abs(s.p0.y - s.p3.y) < EPS &&
      Math.abs(s.p0.x - s.p1.x) < EPS && Math.abs(s.p0.y - s.p1.y) < EPS &&
      Math.abs(s.p0.x - s.p2.x) < EPS && Math.abs(s.p0.y - s.p2.y) < EPS;
    if (collapsed) {
      if (close) continue; // a zero-length piece of a closed outline is simply dropped, never a new subpath
      d += `M${f(s.p0.x)} ${f(s.p0.y)}h0`;
      inCurve = false;
      cx = s.p3.x;
      cy = s.p3.y;
      continue;
    }
    if (Math.abs(s.p0.x - cx) > EPS || Math.abs(s.p0.y - cy) > EPS || Number.isNaN(cx)) {
      // In a closed outline a break must not start a new subpath: the fill would close each piece with a
      // chord of its own. Bridge it with a straight line instead.
      d += close && !Number.isNaN(cx) ? `L${f(s.p0.x)} ${f(s.p0.y)}` : `M${f(s.p0.x)} ${f(s.p0.y)}`;
      inCurve = false;
    }
    d += (inCurve ? ' ' : 'C') + `${f(s.p1.x)} ${f(s.p1.y)} ${f(s.p2.x)} ${f(s.p2.y)} ${f(s.p3.x)} ${f(s.p3.y)}`;
    inCurve = true;
    cx = s.p3.x;
    cy = s.p3.y;
  }
  return close && d ? d + 'Z' : d;
}
