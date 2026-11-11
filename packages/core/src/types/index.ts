/** 2D point / vector in logical canvas units (CSS pixels at the canvas' nominal size). */
export interface Vec2 {
  x: number;
  y: number;
}

export type PointerKind = 'mouse' | 'pen' | 'touch';

/** One captured pointer sample. `t` is a monotonic timestamp in milliseconds. */
export interface InputPoint extends Vec2 {
  t: number;
  /** Normalised 0..1. Meaningless unless the stroke `hasPressure`. */
  pressure: number;
}

/**
 * Untouched capture data. This is the source of truth of a drawing: vector
 * geometry is always *derived* from it, so changing the smoothing level later
 * never degrades the signature.
 */
export interface RawStroke {
  id: string;
  pointerKind: PointerKind;
  points: InputPoint[];
}

export interface CubicBezier {
  p0: Vec2;
  p1: Vec2;
  p2: Vec2;
  p3: Vec2;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Relative pen width at normalised arc length `u` (0 = start, 1 = end).
 * 1 means "the base stroke width". Kept independent of the base width so the
 * width slider never requires re-processing.
 */
export interface WidthSample {
  u: number;
  w: number;
}

/** Smooth vector result of processing one {@link RawStroke}. */
export interface Stroke {
  id: string;
  pointerKind: PointerKind;
  /** Centre line. A contiguous chain, except at hard corners where it is G0 only. */
  segments: CubicBezier[];
  /** Relative width along the stroke; empty means constant width. */
  widthProfile: WidthSample[];
  /** Centre line length in logical units. */
  length: number;
  /** True for a tap / zero-length stroke, rendered as a round dot. */
  isDot: boolean;
}
