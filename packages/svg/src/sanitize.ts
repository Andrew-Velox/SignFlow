/** Escapes text for use inside XML text nodes and double-quoted attributes. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL = /^(?:rgb|hsl)a?\(\s*[\d.]+%?(?:\s*[,\s]\s*[\d.]+%?){2}(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i;
const NAMED = /^[a-z]{3,20}$/i;

/**
 * Only lets plain colour values into the file (hex, rgb()/hsl(), named
 * colours). Anything else, such as `url(...)`, `;` or quotes that could
 * smuggle in markup, falls back to `fallback`.
 */
export function sanitizeColor(input: string | null | undefined, fallback = '#000000'): string {
  const c = (input ?? '').trim();
  return HEX.test(c) || FUNCTIONAL.test(c) || NAMED.test(c) ? c : fallback;
}

/** Finite number, clamped to [min, max]; otherwise `fallback`. */
export function sanitizeNumber(v: number | undefined, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
