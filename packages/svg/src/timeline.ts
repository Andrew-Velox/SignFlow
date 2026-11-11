import { sanitizeNumber } from './sanitize';

export interface AnimationOptions {
  /** Total time (ms) spent drawing all strokes; shared between strokes in proportion to their length. Default 2500. */
  duration?: number;
  /** Pause (ms) between one stroke ending and the next starting. Default 250. */
  strokeDelay?: number;
  /** Pause (ms) before the first stroke. Default 300. */
  startDelay?: number;
  /** Per-stroke easing: a CSS keyword or `cubic-bezier(a, b, c, d)`. Default `ease-in-out`. */
  easing?: string;
  /** Repeat forever (after `holdAfter`). Default false: draw once and stay. */
  loop?: boolean;
  /** When looping, how long (ms) the finished signature stays visible before restarting. Default 1800. */
  holdAfter?: number;
}

export interface ResolvedAnimation {
  duration: number;
  strokeDelay: number;
  startDelay: number;
  easing: string;
  loop: boolean;
  holdAfter: number;
}

const EASING_KEYWORDS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']);
const CUBIC = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/;

/** Only well-formed easing values reach the file's CSS. */
export function sanitizeEasing(input: string | undefined, fallback = 'ease-in-out'): string {
  const e = (input ?? '').trim().toLowerCase();
  if (EASING_KEYWORDS.has(e)) return e;
  const m = CUBIC.exec(e);
  if (m) {
    const [x1, y1, x2, y2] = m.slice(1).map(Number);
    if ([x1, y1, x2, y2].every(Number.isFinite) && x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1) return `cubic-bezier(${x1},${y1},${x2},${y2})`;
  }
  return fallback;
}

export function resolveAnimation(o: AnimationOptions = {}): ResolvedAnimation {
  return {
    duration: sanitizeNumber(o.duration, 2500, 100, 600_000),
    strokeDelay: sanitizeNumber(o.strokeDelay, 250, 0, 60_000),
    startDelay: sanitizeNumber(o.startDelay, 300, 0, 60_000),
    easing: sanitizeEasing(o.easing),
    loop: o.loop === true,
    holdAfter: sanitizeNumber(o.holdAfter, 1800, 0, 600_000),
  };
}

/** A tap is "drawn" in this many ms. */
export const DOT_MS = 80;
/** No stroke is animated faster than this. */
export const MIN_STROKE_MS = 120;

export interface Timeline {
  /** Start / end time (ms from the start of the cycle) of each stroke. */
  starts: number[];
  ends: number[];
  /** Length of one full cycle (ms). Includes the hold when looping. */
  cycle: number;
}

/**
 * Lays strokes out one after another, in their original order, never
 * overlapping. `lengths[i] === 0` means a dot.
 */
export function buildTimeline(lengths: readonly number[], opts: ResolvedAnimation): Timeline {
  const total = lengths.reduce((a, b) => a + b, 0);
  const starts: number[] = [];
  const ends: number[] = [];
  let t = opts.startDelay;
  lengths.forEach((len, i) => {
    const draw = len <= 0 ? DOT_MS : Math.max(MIN_STROKE_MS, total > 0 ? (opts.duration * len) / total : 0);
    if (i > 0) t += opts.strokeDelay;
    starts.push(t);
    t += draw;
    ends.push(t);
  });
  return { starts, ends, cycle: Math.max(1, t + (opts.loop ? opts.holdAfter : 0)) };
}
