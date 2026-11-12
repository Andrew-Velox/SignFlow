import { describe, expect, it } from 'vitest';
import {
  bezierBounds,
  bezierLength,
  lineToBezier,
  rotateBezier,
  rotatePoint,
  rotateStroke,
  sinCosDeg,
  type Stroke,
} from '../src';

const stroke: Stroke = {
  id: 's',
  pointerKind: 'mouse',
  segments: [lineToBezier({ x: 10, y: 20 }, { x: 110, y: 20 }), { p0: { x: 110, y: 20 }, p1: { x: 140, y: 20 }, p2: { x: 150, y: 50 }, p3: { x: 150, y: 80 } }],
  widthProfile: [{ u: 0, w: 0.5 }, { u: 1, w: 1.2 }],
  length: 0,
  isDot: false,
};
stroke.length = stroke.segments.reduce((a, b) => a + bezierLength(b), 0);
const pivot = { x: 80, y: 50 };

describe('sinCosDeg', () => {
  it('is exact at multiples of 90 degrees', () => {
    expect(sinCosDeg(90)).toEqual({ sin: 1, cos: 0 });
    expect(sinCosDeg(180)).toEqual({ sin: 0, cos: -1 });
    expect(sinCosDeg(-90)).toEqual({ sin: -1, cos: 0 });
    expect(sinCosDeg(450)).toEqual({ sin: 1, cos: 0 });
    expect(sinCosDeg(0)).toEqual({ sin: 0, cos: 1 });
  });
  it('matches Math.sin/cos elsewhere', () => {
    const r = sinCosDeg(30);
    expect(r.sin).toBeCloseTo(0.5, 12);
    expect(r.cos).toBeCloseTo(Math.sqrt(3) / 2, 12);
  });
});

describe('rotatePoint', () => {
  it('turns clockwise on screen for positive angles (y points down)', () => {
    // A point to the right of the pivot moves DOWN the screen after +90°.
    expect(rotatePoint({ x: 100, y: 50 }, 90, pivot)).toEqual({ x: 80, y: 70 });
    expect(rotatePoint({ x: 100, y: 50 }, -90, pivot)).toEqual({ x: 80, y: 30 });
    expect(rotatePoint({ x: 100, y: 50 }, 180, pivot)).toEqual({ x: 60, y: 50 });
  });
  it('keeps the pivot fixed and preserves distances', () => {
    expect(rotatePoint(pivot, 37, pivot)).toEqual(pivot);
    const p = { x: 3, y: 9 };
    const q = rotatePoint(p, 37, pivot);
    expect(Math.hypot(q.x - pivot.x, q.y - pivot.y)).toBeCloseTo(Math.hypot(p.x - pivot.x, p.y - pivot.y), 10);
  });
  it('a full turn, and the inverse turn, return the original point', () => {
    const p = { x: 12.5, y: -4 };
    const a = rotatePoint(rotatePoint(p, 123, pivot), -123, pivot);
    expect(a.x).toBeCloseTo(p.x, 10);
    expect(a.y).toBeCloseTo(p.y, 10);
    expect(rotatePoint(p, 360, pivot)).toEqual(p);
  });
});

describe('rotateStroke', () => {
  it('rotates every control point and keeps the contiguous chain connected', () => {
    const r = rotateStroke(stroke, 33, pivot);
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0].p3.x).toBeCloseTo(r.segments[1].p0.x, 10);
    expect(r.segments[0].p3.y).toBeCloseTo(r.segments[1].p0.y, 10);
    expect(r.segments[0]).toEqual(rotateBezier(stroke.segments[0], 33, pivot));
  });

  it('is rigid: length, width profile, id and order are untouched', () => {
    const r = rotateStroke(stroke, 71, pivot);
    expect(r.widthProfile).toEqual(stroke.widthProfile);
    expect(r.id).toBe('s');
    expect(r.length).toBe(stroke.length);
    const len = r.segments.reduce((a, b) => a + bezierLength(b), 0);
    expect(len).toBeCloseTo(stroke.length, 6);
  });

  it('swaps the bounding box width and height at 90 degrees', () => {
    const box = (s: Stroke) => {
      const bs = s.segments.map(bezierBounds);
      return { w: Math.max(...bs.map((b) => b.maxX)) - Math.min(...bs.map((b) => b.minX)), h: Math.max(...bs.map((b) => b.maxY)) - Math.min(...bs.map((b) => b.minY)) };
    };
    const a = box(stroke);
    const b = box(rotateStroke(stroke, 90, pivot));
    expect(b.w).toBeCloseTo(a.h, 6);
    expect(b.h).toBeCloseTo(a.w, 6);
  });

  it('returns the very same object for no rotation and for whole turns', () => {
    expect(rotateStroke(stroke, 0, pivot)).toBe(stroke);
    expect(rotateStroke(stroke, 360, pivot)).toBe(stroke);
    expect(rotateStroke(stroke, -720, pivot)).toBe(stroke);
  });

  it('does not modify its input', () => {
    const copy = JSON.stringify(stroke);
    rotateStroke(stroke, 45, pivot);
    expect(JSON.stringify(stroke)).toBe(copy);
  });

  it('rotates a dot', () => {
    const dot: Stroke = { ...stroke, isDot: true, segments: [{ p0: { x: 100, y: 50 }, p1: { x: 100, y: 50 }, p2: { x: 100, y: 50 }, p3: { x: 100, y: 50 } }], length: 0, widthProfile: [] };
    expect(rotateStroke(dot, 90, pivot).segments[0].p0).toEqual({ x: 80, y: 70 });
  });
});
