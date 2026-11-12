import type { CubicBezier, Stroke, Vec2 } from '../types';

/**
 * Sine and cosine of an angle in degrees. Multiples of 90° are exact (not 6e-17 off), so rotating by a
 * quarter turn gives clean coordinates and path data.
 */
export function sinCosDeg(degrees: number): { sin: number; cos: number } {
  const d = ((degrees % 360) + 360) % 360;
  if (d === 0) return { sin: 0, cos: 1 };
  if (d === 90) return { sin: 1, cos: 0 };
  if (d === 180) return { sin: 0, cos: -1 };
  if (d === 270) return { sin: -1, cos: 0 };
  const r = (d * Math.PI) / 180;
  return { sin: Math.sin(r), cos: Math.cos(r) };
}

/** Rotates a point about `pivot`. Positive degrees turn clockwise on screen (y points down). */
export function rotatePoint(p: Vec2, degrees: number, pivot: Vec2): Vec2 {
  const { sin, cos } = sinCosDeg(degrees);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

export function rotateBezier(b: CubicBezier, degrees: number, pivot: Vec2): CubicBezier {
  return {
    p0: rotatePoint(b.p0, degrees, pivot),
    p1: rotatePoint(b.p1, degrees, pivot),
    p2: rotatePoint(b.p2, degrees, pivot),
    p3: rotatePoint(b.p3, degrees, pivot),
  };
}

/**
 * A stroke rotated about `pivot`. Rotation is rigid, so the width profile, the length, the stroke order
 * and everything derived from them stay valid: only the centre line moves.
 */
export function rotateStroke(stroke: Stroke, degrees: number, pivot: Vec2): Stroke {
  if (degrees % 360 === 0) return stroke;
  return { ...stroke, segments: stroke.segments.map((s) => rotateBezier(s, degrees, pivot)) };
}
