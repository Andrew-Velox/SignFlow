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
    // Control points stay inside the unit square so the curve is monotonic (a pen never moves backwards).
    if ([x1, y1, x2, y2].every(Number.isFinite) && x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1 && y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1) return `cubic-bezier(${x1},${y1},${x2},${y2})`;
  }
  return fallback;
}

const KEYWORD_CURVES: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/**
 * The inverse of a (sanitised) CSS easing: given how far along the path the
 * pen is (0..1), returns how far through the stroke's time that happens.
 * Needed to time each slice of a stroke so the slices together follow the
 * same easing as the stroke as a whole.
 */
export function easingInverse(easing: string): (progress: number) => number {
  if (easing === 'linear') return (p) => Math.min(1, Math.max(0, p));
  const m = CUBIC.exec(easing);
  const [x1, y1, x2, y2] = m ? m.slice(1).map(Number) : (KEYWORD_CURVES[easing] ?? KEYWORD_CURVES['ease-in-out']);
  const bez = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  // y(x) is monotonic; find x for a given y by bisection on the curve parameter.
  return (p) => {
    const target = Math.min(1, Math.max(0, p));
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const t = (lo + hi) / 2;
      if (bez(y1, y2, t) < target) lo = t;
      else hi = t;
    }
    return bez(x1, x2, (lo + hi) / 2);
  };
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
