import { describe, expect, it } from 'vitest';
import {
  StrokeBuilder,
  lineToBezier,
  type CubicBezier,
  type Stroke,
  bezierBounds,
  bezierLength,
  bezierTangent,
  processStroke,
  strokeBounds,
  strokeCenterlinePath,
  strokeHasPressure,
  strokeOutlinePath,
  segmentsToPathData,
  outlinePiece,
  outlineSamples,
  strokeToOutline,
  unionBounds,
  widthAt,
  limitSlope,
  MAX_WIDTH_SLOPE,
  type Bounds,
  type InputPoint,
  type Vec2,
} from '../src';
import {
  loopsCurve,
  maxDeviation,
  meanDeviation,
  nearestDistance,
  polylineFromFn,
  rawStroke,
  penWalk,
  roughness,
  zigzagPath,
  samplePath,
  sampleSegments,
} from './helpers';

const truth = polylineFromFn(loopsCurve(), 6000);
const mouse = samplePath(truth, { seed: 42 });

describe.each([{ refine: false }, { refine: true }])('processStroke (refine: $refine): fidelity and smoothness on noisy mouse input', ({ refine }) => {
  const raw = rawStroke(mouse);

  it('has a realistic test input', () => {
    expect(mouse.length).toBeGreaterThan(100);
    // Integer-quantised, as real mouse events are.
    expect(mouse.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y))).toBe(true);
  });

  it('is closer to the intended path than the raw samples are', () => {
    const stroke = processStroke(raw, { refine, smoothing: 0.5 });
    const curve = sampleSegments(stroke.segments, 30);
    expect(meanDeviation(curve, truth)).toBeLessThan(meanDeviation(mouse, truth));
  });

  it('stays faithful: no sample of the result strays far from the intended path', () => {
    const stroke = processStroke(raw, { refine, smoothing: 0.5 });
    expect(maxDeviation(sampleSegments(stroke.segments, 30), truth)).toBeLessThan(2.5);
  });

  it('preserves the loops (does not round the signature into a blob)', () => {
    const stroke = processStroke(raw, { refine, smoothing: 0.5 });
    const b = strokeBounds(stroke)!;
    const tb = truth.reduce<Bounds>(
      (acc, p) => ({
        minX: Math.min(acc.minX, p.x),
        maxX: Math.max(acc.maxX, p.x),
        minY: Math.min(acc.minY, p.y),
        maxY: Math.max(acc.maxY, p.y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    // Loop height is 2·22 px; over-smoothing would flatten it.
    expect(tb.maxY - tb.minY).toBeGreaterThan(40);
    expect(b.maxY - b.minY).toBeGreaterThan(tb.maxY - tb.minY - 3);
  });

  it('removes jitter: roughness matches the intended curve, not the noisy input', () => {
    // Loops are inherently curvy, so compare against the roughness of the *true* path.
    const stroke = processStroke(raw, { refine, smoothing: 0.5 });
    const ideal = roughness(truth);
    const rawErr = Math.abs(roughness(mouse) - ideal);
    const smoothErr = Math.abs(roughness(sampleSegments(stroke.segments, 30)) - ideal);
    expect(smoothErr).toBeLessThan(rawErr * 0.5);
  });

  it('is a compact representation', () => {
    const stroke = processStroke(raw, { refine, smoothing: 0.5 });
    // The refined pipeline fits the data (≈ 1 segment / 7 samples); the live-equivalent one must keep the
    // live curve within 0.2 px, which is a much tighter promise.
    expect(stroke.segments.length).toBeLessThan(refine ? mouse.length / 4 : mouse.length * 0.7);
  });

  it('is a contiguous, G1-smooth chain when there are no corners', () => {
    const stroke = processStroke(raw, { refine, smoothing: 0.5, cornerAngle: 175 });
    for (let i = 0; i < stroke.segments.length - 1; i++) {
      expect(stroke.segments[i].p3).toEqual(stroke.segments[i + 1].p0);
      const a = bezierTangent(stroke.segments[i], 1);
      const b = bezierTangent(stroke.segments[i + 1], 0);
      expect(a.x * b.x + a.y * b.y).toBeGreaterThan(0.99);
    }
  });

  it('starts exactly at the first sample and ends at (refine) or just behind (live) the last one', () => {
    const stroke = processStroke(raw, { refine, smoothing: 0.8 });
    expect(stroke.segments[0].p0).toEqual({ x: mouse[0].x, y: mouse[0].y });
    const last = mouse[mouse.length - 1];
    const end = stroke.segments[stroke.segments.length - 1].p3;
    if (refine) expect(end).toEqual({ x: last.x, y: last.y });
    else expect(Math.hypot(end.x - last.x, end.y - last.y)).toBeLessThan(4); // causal filter lag, bounded
  });

  it('smoothing = 0 stays within ~1 px of the raw samples', () => {
    const stroke = processStroke(raw, { refine, smoothing: 0 });
    const curve = sampleSegments(stroke.segments, 30);
    expect(maxDeviation(mouse, curve)).toBeLessThan(1.0);
  });

  it('more smoothing means fewer segments and a smoother line', () => {
    const lo = processStroke(raw, { refine, smoothing: 0.1 });
    const hi = processStroke(raw, { refine, smoothing: 0.9 });
    expect(hi.segments.length).toBeLessThan(lo.segments.length);
    expect(roughness(sampleSegments(hi.segments, 30))).toBeLessThanOrEqual(roughness(sampleSegments(lo.segments, 30)));
  });

  it('is deterministic', () => {
    expect(processStroke(raw, { refine, smoothing: 0.4 })).toEqual(processStroke(raw, { refine, smoothing: 0.4 }));
  });

  it('does not modify the raw stroke (non-destructive re-smoothing)', () => {
    const copy = JSON.stringify(raw);
    processStroke(raw, { refine, smoothing: 1 });
    expect(JSON.stringify(raw)).toBe(copy);
  });

  it('processes a long stroke quickly', () => {
    const long = samplePath(polylineFromFn(loopsCurve(30, 40, 22), 20000), { seed: 9, hz: 240 });
    const t0 = performance.now();
    processStroke(rawStroke(long), { refine, smoothing: 0.5 });
    expect(long.length).toBeGreaterThan(1000);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});

describe('processStroke: corners', () => {
  // A "V" with a sharp apex, sampled with noise.
  const v = [
    ...polylineFromFn((t) => ({ x: 20 + 80 * t, y: 20 + 120 * t }), 100),
    ...polylineFromFn((t) => ({ x: 100 + 80 * t, y: 140 - 120 * t }), 100),
  ];

  it('live mode rounds the apex only slightly (a few px)', () => {
    const stroke = processStroke(rawStroke(samplePath(v, { seed: 5, noise: 0.4 })), { smoothing: 0.6 });
    expect(strokeBounds(stroke)!.maxY).toBeGreaterThan(134); // true apex at y = 140
  });

  it('refine mode keeps a sharp apex sharp instead of rounding it', () => {
    const pts = samplePath(v, { seed: 5, noise: 0.4 });
    const stroke = processStroke(rawStroke(pts), { smoothing: 0.6, refine: true });
    const { maxY } = strokeBounds(stroke)!;
    expect(maxY).toBeGreaterThan(138); // true apex at y = 140
    // Two spans meet at the apex: a G0 join (tangent flips).
    const joins = stroke.segments.filter((s, i) => i > 0 && Math.hypot(s.p0.x - stroke.segments[i - 1].p3.x, s.p0.y - stroke.segments[i - 1].p3.y) < 1e-9);
    const flips = joins.filter((s) => {
      const i = stroke.segments.indexOf(s);
      const a = bezierTangent(stroke.segments[i - 1], 1);
      const b = bezierTangent(s, 0);
      return a.x * b.x + a.y * b.y < 0.5;
    });
    expect(flips).toHaveLength(1);
  });
});

describe('processStroke: degenerate input', () => {
  it('returns an empty stroke for no points', () => {
    const s = processStroke(rawStroke([]));
    expect(s.segments).toEqual([]);
    expect(s.isDot).toBe(false);
  });

  it('turns a single tap into a dot', () => {
    const s = processStroke(rawStroke([{ x: 10, y: 12, t: 0, pressure: 0.5 }]));
    expect(s.isDot).toBe(true);
    expect(s.segments).toHaveLength(1);
    expect(strokeCenterlinePath(s)).toBe('M10 12h0');
  });

  it('treats repeated identical samples as a dot', () => {
    const p = { x: 3, y: 4, t: 0, pressure: 0.5 };
    expect(processStroke(rawStroke([p, { ...p, t: 8 }, { ...p, t: 16 }])).isDot).toBe(true);
  });

  it('handles a two-point stroke', () => {
    const s = processStroke(
      rawStroke([
        { x: 0, y: 0, t: 0, pressure: 0.5 },
        { x: 30, y: 0, t: 40, pressure: 0.5 },
      ]),
    );
    expect(s.segments).toHaveLength(1);
    expect(s.length).toBeGreaterThan(28); // causal filter lag, < 1.5 px
  });

  it('ignores NaN / Infinity samples', () => {
    const pts = [...mouse.slice(0, 50)];
    pts.splice(10, 0, { x: NaN, y: 3, t: 5, pressure: 0.5 }, { x: 2, y: Infinity, t: 6, pressure: 0.5 });
    const s = processStroke(rawStroke(pts));
    for (const seg of s.segments) for (const p of [seg.p0, seg.p1, seg.p2, seg.p3]) expect(Number.isFinite(p.x + p.y)).toBe(true);
  });

  it('works without timestamps', () => {
    const pts = mouse.map((p) => ({ ...p, t: 0 }));
    const s = processStroke(rawStroke(pts));
    expect(s.segments.length).toBeGreaterThan(0);
    expect(maxDeviation(sampleSegments(s.segments, 20), truth)).toBeLessThan(3);
  });
});

describe('pressure and width profile', () => {
  const path = polylineFromFn(loopsCurve(2, 120, 20), 3000);

  it('detects pressure only when it actually varies', () => {
    expect(strokeHasPressure({ pointerKind: 'mouse', points: samplePath(path, { pressure: (u) => u }) })).toBe(false);
    expect(strokeHasPressure({ pointerKind: 'pen', points: samplePath(path) })).toBe(false); // constant 0.5
    expect(strokeHasPressure({ pointerKind: 'pen', points: samplePath(path, { pressure: (u) => u }) })).toBe(true);
  });

  it('follows pen pressure', () => {
    const pts = samplePath(path, { pressure: (u) => 0.15 + 0.7 * u, speed: 300 });
    const s = processStroke(rawStroke(pts, 'pen'), { pressureSensitivity: 1, velocitySensitivity: 0, taper: 0 });
    expect(widthAt(s.widthProfile, 0.9)).toBeGreaterThan(widthAt(s.widthProfile, 0.15) * 1.5);
  });

  it('ignores pressure sensitivity for a mouse', () => {
    const pts = samplePath(path, { pressure: (u) => 0.15 + 0.7 * u });
    const s = processStroke(rawStroke(pts, 'mouse'), { pressureSensitivity: 1, velocitySensitivity: 0, curvature: 0, taper: 0 });
    expect(s.widthProfile.every((w) => Math.abs(w.w - 1) < 1e-9)).toBe(true);
  });

  it('writes fast strokes thinner than slow ones', () => {
    const slow = processStroke(rawStroke(samplePath(path, { speed: 120 })), { velocitySensitivity: 1, taper: 0 });
    const fast = processStroke(rawStroke(samplePath(path, { speed: 1800 })), { velocitySensitivity: 1, taper: 0 });
    expect(widthAt(fast.widthProfile, 0.5)).toBeLessThan(widthAt(slow.widthProfile, 0.5) * 0.7);
  });

  it('tapers toward the end more than toward the start', () => {
    const s = processStroke(rawStroke(samplePath(path, { speed: 400 })), { velocitySensitivity: 0, taper: 1 });
    const mid = widthAt(s.widthProfile, 0.5);
    expect(widthAt(s.widthProfile, 1)).toBeLessThan(mid * 0.3);
    expect(widthAt(s.widthProfile, 0)).toBeLessThan(mid);
    expect(widthAt(s.widthProfile, 0)).toBeGreaterThan(widthAt(s.widthProfile, 1));
  });

  it('keeps the profile small', () => {
    const s = processStroke(rawStroke(mouse));
    expect(s.widthProfile.length).toBeLessThan(mouse.length / 2);
    expect(s.widthProfile[0].u).toBe(0);
    expect(s.widthProfile[s.widthProfile.length - 1].u).toBeCloseTo(1, 9);
  });

  it('never changes thickness faster than the slope limit, even for a pressure step', () => {
    const pts = samplePath(path, { pressure: (u) => (u < 0.5 ? 0.1 : u < 0.52 ? 0.5 : 0.95), speed: 300 });
    const s = processStroke(rawStroke(pts, 'pen'), { pressureSensitivity: 1, velocitySensitivity: 0, taper: 0 });
    let worst = 0;
    for (let i = 1; i < s.widthProfile.length; i++) {
      const a = s.widthProfile[i - 1];
      const b = s.widthProfile[i];
      const ds = (b.u - a.u) * s.length;
      if (ds > 0.5) worst = Math.max(worst, Math.abs(b.w - a.w) / ds);
    }
    expect(widthAt(s.widthProfile, 0.9)).toBeGreaterThan(widthAt(s.widthProfile, 0.1) * 1.5); // the step is still followed
    expect(worst).toBeLessThanOrEqual(MAX_WIDTH_SLOPE * 1.3); // arc length of the fitted curve differs slightly from the samples'
  });

  it('limitSlope clamps jumps and leaves gentle signals alone', () => {
    const arc = [0, 1, 2, 3, 4];
    expect(limitSlope([0, 0, 10, 10, 10], arc, 1).every((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) <= 1 + 1e-9)).toBe(true);
    expect(limitSlope([1, 1.1, 1.2, 1.3, 1.4], arc, 1)).toEqual([1, 1.1, 1.2, 1.3, 1.4]);
  });

  it('widthAt interpolates and clamps', () => {
    const p = [{ u: 0, w: 0.5 }, { u: 1, w: 1.5 }];
    expect(widthAt(p, -1)).toBe(0.5);
    expect(widthAt(p, 0.5)).toBeCloseTo(1, 9);
    expect(widthAt(p, 2)).toBe(1.5);
    expect(widthAt([], 0.3)).toBe(1);
  });
});

describe('curvature-driven width', () => {
  // Straight run, one tight loop, straight run: all drawn at one constant speed, so only the bend can change width.
  const path = [
    ...polylineFromFn((t) => ({ x: 20 + 160 * t, y: 120 }), 80),
    ...polylineFromFn((t) => ({ x: 180 + 18 * Math.sin(t * Math.PI * 2), y: 120 - 18 + 18 * Math.cos(t * Math.PI * 2) }), 90),
    ...polylineFromFn((t) => ({ x: 180 + 160 * t, y: 120 }), 80),
  ];
  const pts = samplePath(path, { seed: 4, noise: 0.2, speed: 500 });
  const flat = { velocitySensitivity: 0, pressureSensitivity: 0, taper: 0 };

  it('makes bends thicker than straight runs', () => {
    const s = processStroke(rawStroke(pts), { ...flat, curvature: 1 });
    const straight = widthAt(s.widthProfile, 0.1);
    const bend = Math.max(...s.widthProfile.map((w) => w.w));
    expect(straight).toBeLessThan(1.1);
    expect(bend).toBeGreaterThan(straight * 1.3);
  });

  it('is off at curvature = 0', () => {
    const s = processStroke(rawStroke(pts), { ...flat, curvature: 0 });
    expect(s.widthProfile.every((w) => Math.abs(w.w - 1) < 1e-9)).toBe(true);
  });

  it('scales with the setting', () => {
    const peak = (curvature: number) => Math.max(...processStroke(rawStroke(pts), { ...flat, curvature }).widthProfile.map((w) => w.w));
    expect(peak(0.3)).toBeLessThan(peak(0.6));
    expect(peak(0.6)).toBeLessThan(peak(1));
  });

  it('does not depend on how fast the pen moves', () => {
    const at = (speed: number) => {
      const s = processStroke(rawStroke(samplePath(path, { seed: 4, noise: 0.2, speed })), { ...flat, curvature: 1 });
      return Math.max(...s.widthProfile.map((w) => w.w));
    };
    expect(Math.abs(at(300) - at(900))).toBeLessThan(0.2);
  });

  it('leaves a perfectly straight stroke alone', () => {
    const straight = samplePath(polylineFromFn((t) => ({ x: 20 + 300 * t, y: 60 }), 100), { seed: 1, noise: 0.2, speed: 500 });
    const s = processStroke(rawStroke(straight), { ...flat, curvature: 1 });
    expect(Math.max(...s.widthProfile.map((w) => w.w))).toBeLessThan(1.1);
  });
});

describe('strokeToOutline', () => {
  const straight = rawStroke(
    Array.from({ length: 60 }, (_, i) => ({ x: 20 + i * 4, y: 50, t: i * 8, pressure: 0.5 })),
  );
  const flat = { velocitySensitivity: 0, curvature: 0, taper: 0, smoothing: 0.3 };

  const outlineBounds = (segs: ReturnType<typeof strokeToOutline>): Bounds =>
    segs.map(bezierBounds).reduce<Bounds | null>((a, b) => unionBounds(a, b), null)!;

  it('produces a closed loop', () => {
    const o = strokeToOutline(processStroke(straight, flat), 6);
    expect(o.length).toBeGreaterThan(3);
    for (let i = 0; i < o.length - 1; i++) {
      expect(Math.hypot(o[i].p3.x - o[i + 1].p0.x, o[i].p3.y - o[i + 1].p0.y)).toBeLessThan(1e-6);
    }
    expect(Math.hypot(o[o.length - 1].p3.x - o[0].p0.x, o[o.length - 1].p3.y - o[0].p0.y)).toBeLessThan(1e-3);
  });

  it('has the requested thickness around a straight constant-width stroke, plus round caps', () => {
    const W = 8;
    const b = outlineBounds(strokeToOutline(processStroke(straight, flat), W));
    expect(b.maxY - b.minY).toBeCloseTo(W, 1);
    expect(b.minY).toBeCloseTo(50 - W / 2, 1);
    expect(b.minX).toBeCloseTo(20 - W / 2, 1); // start cap
    expect(Math.abs(b.maxX - (20 + 59 * 4 + W / 2))).toBeLessThan(1.5); // end cap (live filter ends < 1 px behind the pen)
  });

  it('scales with the base width without re-processing', () => {
    const s = processStroke(straight, flat);
    const b4 = outlineBounds(strokeToOutline(s, 4));
    const b12 = outlineBounds(strokeToOutline(s, 12));
    expect(b12.maxY - b12.minY).toBeCloseTo(3 * (b4.maxY - b4.minY), 1);
  });

  it('is thinner at a tapered end', () => {
    const s = processStroke(straight, { ...flat, taper: 1 });
    const pts = sampleSegments(strokeToOutline(s, 10), 40);
    const heightIn = (x0: number, x1: number) => {
      const ys = pts.filter((p) => p.x >= x0 && p.x <= x1).map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    const mid = heightIn(130, 150);
    const nearEnd = heightIn(246, 250); // inside the 26 px exit taper, before the round cap
    expect(mid).toBeCloseTo(10, 0);
    expect(nearEnd).toBeLessThan(mid * 0.6);
  });

  it('renders a dot as a circle of the right size', () => {
    const dot = processStroke(rawStroke([{ x: 30, y: 30, t: 0, pressure: 0.5 }]), { velocitySensitivity: 0, taper: 0 });
    const b = outlineBounds(strokeToOutline(dot, 10));
    expect(b.maxX - b.minX).toBeCloseTo(10, 6);
    expect(b.maxY - b.minY).toBeCloseTo(10, 6);
  });

  it('outlines a looping signature without non-finite numbers', () => {
    const o = strokeToOutline(processStroke(rawStroke(mouse)), 5);
    expect(o.length).toBeGreaterThan(10);
    for (const s of o) for (const p of [s.p0, s.p1, s.p2, s.p3]) expect(Number.isFinite(p.x + p.y)).toBe(true);
  });

  it('emits valid path data', () => {
    const d = strokeOutlinePath(processStroke(rawStroke(mouse)), 5);
    expect(d).toMatch(/^M-?[\d.]+ -?[\d.]+C/);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });

  it('live quality traces the same silhouette as final quality', () => {
    const s = processStroke(rawStroke(mouse));
    const fin = sampleSegments(strokeToOutline(s, 6, 'final'), 20);
    const live = sampleSegments(strokeToOutline(s, 6, 'live'), 2);
    // Final quality also bridges hairline gaps between nearby parts of the stroke (up to ~1.5 px of extra
    // thickness right at a gap); live frames skip that finishing touch.
    expect(maxDeviation(live, fin)).toBeLessThan(1.7);
    expect(maxDeviation(fin, live)).toBeLessThan(1.7);
  });

  it('returns nothing for empty strokes', () => {
    expect(strokeToOutline(processStroke(rawStroke([])), 5)).toEqual([]);
  });

  it('survives a sharp corner (beveled outer side)', () => {
    const v: Vec2[] = [...polylineFromFn((t) => ({ x: 20 + 80 * t, y: 20 + 120 * t }), 100), ...polylineFromFn((t) => ({ x: 100 + 80 * t, y: 140 - 120 * t }), 100)];
    const s = processStroke(rawStroke(samplePath(v, { seed: 2, noise: 0.3 })), { smoothing: 0.6 });
    const o = strokeToOutline(s, 8);
    for (const seg of o) for (const p of [seg.p0, seg.p1, seg.p2, seg.p3]) expect(Number.isFinite(p.x + p.y)).toBe(true);
  });
});

describe('what you draw is what you get', () => {
  const build = (smoothing: number) => {
    const b = new StrokeBuilder('a', 'mouse', { smoothing });
    for (const p of mouse) b.push(p);
    return b;
  };

  it.each([0.2, 0.5, 0.8])('the committed stroke stays within 0.25 px of the live preview (smoothing %s)', (smoothing) => {
    const b = build(smoothing);
    const live = sampleSegments(b.preview().segments, 40);
    const final = sampleSegments(processStroke(b.raw(), { smoothing }).segments, 40);
    expect(maxDeviation(final, live)).toBeLessThan(0.25);
    expect(maxDeviation(live, final)).toBeLessThan(0.25);
  });

  it('has the same width profile as the live preview, so thickness cannot change on release', () => {
    const b = build(0.5);
    expect(processStroke(b.raw(), { smoothing: 0.5 }).widthProfile).toEqual(b.preview().widthProfile);
  });

  it('starts and ends where the live ink did', () => {
    const b = build(0.5);
    const live = b.preview().segments;
    const final = processStroke(b.raw(), { smoothing: 0.5 }).segments;
    const xy = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });
    expect(xy(final[0].p0)).toEqual(xy(live[0].p0));
    expect(xy(final[final.length - 1].p3)).toEqual(xy(live[live.length - 1].p3));
  });

  it('finish() is more compact than the preview', () => {
    const b = build(0.5);
    expect(b.finish().segments.length).toBeLessThan(b.preview().segments.length);
  });

  it('short strokes are not shortened much by the filter start-up', () => {
    const b = new StrokeBuilder('a', 'mouse');
    for (let i = 0; i < 8; i++) b.push({ x: i * 5, y: 0, t: i * 8, pressure: 0.5 });
    const segs = b.preview().segments;
    expect(segs[segs.length - 1].p3.x).toBeGreaterThan(34); // pen ended at 35
  });
});

describe('StrokeBuilder (live preview)', () => {
  it('records every sample untouched', () => {
    const b = new StrokeBuilder('a', 'mouse');
    for (const p of mouse) b.push(p);
    expect(b.raw().points).toEqual(mouse);
    expect(b.pointCount).toBe(mouse.length);
  });

  it('previews smooth geometry close to the final result', () => {
    const b = new StrokeBuilder('a', 'mouse', { smoothing: 0.5 });
    for (const p of mouse) b.push(p);
    const live = b.preview();
    const final = processStroke(b.raw(), { smoothing: 0.5 });
    expect(live.segments.length).toBeGreaterThan(10);
    const dev = meanDeviation(sampleSegments(live.segments, 10), sampleSegments(final.segments, 40));
    expect(dev).toBeLessThan(1.5);
  });

  it('appending samples never changes already-drawn geometry (no wobbling tail)', () => {
    const b = new StrokeBuilder('a', 'mouse', { smoothing: 0.5 });
    for (const p of mouse.slice(0, 150)) b.push(p);
    const before = b.preview().segments;
    for (const p of mouse.slice(150, 190)) b.push(p);
    const after = b.preview().segments;
    // All but the last two segments are identical.
    for (let i = 0; i < before.length - 2; i++) expect(after[i]).toEqual(before[i]);
  });

  it('ignores non-finite samples and reports a dot for a single tap', () => {
    const b = new StrokeBuilder('a', 'touch');
    expect(b.push({ x: NaN, y: 0, t: 0, pressure: 1 })).toBe(false);
    b.push({ x: 5, y: 6, t: 10, pressure: 0.5 });
    expect(b.preview().isDot).toBe(true);
    expect(b.pointCount).toBe(1);
  });

  it('previews quickly even for long strokes', () => {
    const b = new StrokeBuilder('a', 'mouse');
    const long = samplePath(polylineFromFn(loopsCurve(15, 40, 22), 10000), { seed: 3 });
    for (const p of long) b.push(p);
    const t0 = performance.now();
    strokeOutlinePath(b.preview(), 5);
    expect(performance.now() - t0).toBeLessThan(150);
  });
});

describe('outline spikes at sharp turns (regression)', () => {
  const BASE = 4.5;
  // Widest legal half-width, plus slack for control points.
  const LIMIT = (BASE * 1.9) / 2 + 2.5;

  const maxStray = (stroke: ReturnType<typeof processStroke>, quality: 'live' | 'final') => {
    const near = nearestDistance(sampleSegments(stroke.segments, 40));
    let worst = 0;
    for (const p of sampleSegments(strokeToOutline(stroke, BASE, quality), 4)) {
      if (!Number.isFinite(p.x + p.y)) return Infinity;
      worst = Math.max(worst, near(p));
    }
    return worst;
  };

  // Seeds that produced 40-60 px spikes or NaN geometry before the fix.
  it.each([10, 14, 28, 29, 30, 34, 36])('random walk %i has no stray outline geometry', (seed) => {
    const pts = penWalk(seed);
    const b = new StrokeBuilder('a', 'mouse');
    pts.forEach((p) => b.push(p));
    for (const quality of ['live', 'final'] as const) {
      expect(maxStray(b.preview(), quality)).toBeLessThan(LIMIT);
      expect(maxStray(processStroke(rawStroke(pts)), quality)).toBeLessThan(LIMIT);
    }
  });

  // The shape in the bug report: a long stroke that turns back on itself at a pointed tip.
  it('a hairpin turn ends in a round tip, not a spike', () => {
    const out = polylineFromFn((t) => ({ x: 60 + 380 * t, y: 50 + 35 * t }), 120);
    const back = polylineFromFn((t) => ({ x: 440 - 260 * t, y: 85 + 7 * t }), 90);
    const pts = samplePath([...out, ...back], { seed: 3, noise: 0.3, speed: 700 });
    const stroke = processStroke(rawStroke(pts), { taper: 0 });
    for (const quality of ['live', 'final'] as const) {
      expect(maxStray(stroke, quality)).toBeLessThan(LIMIT);
      const xs = sampleSegments(strokeToOutline(stroke, BASE, quality), 6).map((p) => p.x);
      const tipX = Math.max(...xs);
      // The tip may extend about half a pen width past the turning point, never tens of pixels.
      expect(tipX).toBeLessThan(440 + BASE + 3);
    }
  });

  it('survives a hairpin with a near-zero turning radius', () => {
    const pts: InputPoint[] = [];
    for (let i = 0; i <= 30; i++) pts.push({ x: 100 + i * 6, y: 100, t: i * 8, pressure: 0.5 });
    pts.push({ x: 281, y: 101, t: 250, pressure: 0.5 });
    for (let i = 1; i <= 30; i++) pts.push({ x: 280 - i * 6, y: 102, t: 250 + i * 8, pressure: 0.5 });
    const stroke = processStroke(rawStroke(pts));
    expect(maxStray(stroke, 'final')).toBeLessThan(LIMIT);
    expect(maxStray(stroke, 'live')).toBeLessThan(LIMIT);
  });
});

describe('gap bridging (hairline slits between nearby parts of a stroke)', () => {
  const K = 0.5522847498307936;
  /** Out along y = 50, a half-circle U-turn, and back along y = 50 + D: two legs whose edges are `D - width` apart. */
  const uTurn = (D: number): Stroke => {
    const r = D / 2;
    const segs: CubicBezier[] = [
      lineToBezier({ x: 20, y: 50 }, { x: 220, y: 50 }),
      { p0: { x: 220, y: 50 }, p1: { x: 220 + K * r, y: 50 }, p2: { x: 220 + r, y: 50 + r - K * r }, p3: { x: 220 + r, y: 50 + r } },
      { p0: { x: 220 + r, y: 50 + r }, p1: { x: 220 + r, y: 50 + r + K * r }, p2: { x: 220 + K * r, y: 50 + D }, p3: { x: 220, y: 50 + D } },
      lineToBezier({ x: 220, y: 50 + D }, { x: 20, y: 50 + D }),
    ];
    const length = segs.reduce((a, b) => a + bezierLength(b), 0);
    return { id: 'u', pointerKind: 'mouse', segments: segs, widthProfile: [], length, isDot: false };
  };

  /** Non-zero winding number of a closed polyline around a point. */
  const winding = (pt: Vec2, poly: Vec2[]): number => {
    let w = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const cross = (b.x - a.x) * (pt.y - a.y) - (pt.x - a.x) * (b.y - a.y);
      if (a.y <= pt.y) {
        if (b.y > pt.y && cross > 0) w++;
      } else if (b.y <= pt.y && cross < 0) w--;
    }
    return w;
  };
  const insideAt = (stroke: Stroke, width: number, quality: 'live' | 'final', at: Vec2) =>
    winding(at, sampleSegments(strokeToOutline(stroke, width, quality), 10)) !== 0;

  const W = 6; // legs are 6 px thick
  it('closes a true hairline gap (0.5 px) between two legs in committed/final quality', () => {
    const D = W + 0.5;
    const between = { x: 120, y: 50 + D / 2 };
    expect(insideAt(uTurn(D), W, 'final', between)).toBe(true);
    // Without bridging (live frames) the sliver is still there: this is exactly the defect being fixed.
    expect(insideAt(uTurn(D), W, 'live', between)).toBe(false);
  });

  it('leaves anything wider than a hairline alone (1.5 px and 4 px)', () => {
    // A wider threshold fuses the legs of every V-shaped joint, so only true hairlines are bridged.
    for (const gapPx of [1.5, 4]) {
      const D = W + gapPx;
      expect(insideAt(uTurn(D), W, 'final', { x: 120, y: 50 + D / 2 })).toBe(false);
    }
  });

  it('does not change the stroke where nothing is close', () => {
    const line = rawStroke(Array.from({ length: 60 }, (_, i) => ({ x: 20 + i * 4, y: 50, t: i * 8, pressure: 0.5 })));
    const lone = processStroke(line, { velocitySensitivity: 0, curvature: 0, taper: 0, smoothing: 0.3 });
    const live = sampleSegments(strokeToOutline(lone, 6, 'live'), 4);
    const fin = sampleSegments(strokeToOutline(lone, 6, 'final'), 4);
    expect(maxDeviation(fin, live)).toBeLessThan(0.3);
  });

  it('only thickens the facing edges, by about the size of the gap', () => {
    const D = W + 0.5;
    const ys = sampleSegments(strokeToOutline(uTurn(D), W, 'final'), 10)
      .filter((p) => p.x > 60 && p.x < 180)
      .map((p) => p.y);
    // Outer faces stay put: the stroke spans 50 - 3 .. 50 + D + 3.
    expect(Math.min(...ys)).toBeGreaterThan(50 - 3 - 0.2);
    expect(Math.max(...ys)).toBeLessThan(50 + D + 3 + 0.2);
  });
});

describe('small loops and joints (regression: white lens in a tiny loop, heavier V-joints)', () => {
  /** Outline polygon area (shoelace) of a closed chain, sampled densely. */
  const area = (segs: CubicBezier[]) => {
    const poly = sampleSegments(segs, 12);
    let a2 = 0;
    for (let i = 0; i < poly.length; i++) {
      const u = poly[i];
      const v = poly[(i + 1) % poly.length];
      a2 += u.x * v.y - v.x * u.y;
    }
    return Math.abs(a2) / 2;
  };
  const winding = (pt: Vec2, poly: Vec2[]): number => {
    let w = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const cross = (b.x - a.x) * (pt.y - a.y) - (pt.x - a.x) * (b.y - a.y);
      if (a.y <= pt.y) {
        if (b.y > pt.y && cross > 0) w++;
      } else if (b.y <= pt.y && cross < 0) w--;
    }
    return w;
  };

  /** Straight down, a 270° turn of radius r (the path crosses itself: a loop), then straight on. */
  const loopStroke = (r: number) => {
    const path: Vec2[] = [];
    let x = 120;
    let y = 40;
    let th = Math.PI / 2;
    for (let i = 0; i < 90; i++) { path.push({ x, y }); x += Math.cos(th); y += Math.sin(th); }
    const centre = { x: x + r * Math.cos(th - Math.PI / 2), y: y + r * Math.sin(th - Math.PI / 2) }; // the turn bends toward +x
    const steps = Math.round(1.5 * Math.PI * r);
    for (let i = 0; i < steps; i++) { path.push({ x, y }); x += Math.cos(th); y += Math.sin(th); th -= 1 / r; }
    for (let i = 0; i < 70; i++) { path.push({ x, y }); x += Math.cos(th); y += Math.sin(th); }
    return { stroke: processStroke(rawStroke(samplePath(path, { seed: 3, noise: 0.2, speed: 500 }))), centre };
  };
  /** How many points on a grid around the loop centre are NOT covered by ink. */
  const unfilled = (stroke: Stroke, width: number, quality: 'live' | 'final', c: Vec2, radius: number) => {
    const poly = sampleSegments(strokeToOutline(stroke, width, quality), 10);
    let n = 0;
    for (let dx = -radius; dx <= radius; dx += 0.5) for (let dy = -radius; dy <= radius; dy += 0.5) if (winding({ x: c.x + dx, y: c.y + dy }, poly) === 0) n++;
    return n;
  };

  it('closes the thin white lens inside a very small loop, in committed/final quality only', () => {
    // Pen 6 on a radius-7 loop leaves a ~30 px² hole (a thin lens): real ink would fill it.
    const { stroke, centre } = loopStroke(7);
    expect(unfilled(stroke, 6, 'live', centre, 4)).toBeGreaterThan(20);
    expect(unfilled(stroke, 6, 'final', centre, 4)).toBe(0);
  });

  it('keeps a real counter open (the inside of a cursive e or l)', () => {
    for (const [r, w] of [[14, 6], [11, 9], [20, 4.5], [9, 4.5]] as const) {
      const { stroke, centre } = loopStroke(r);
      expect(unfilled(stroke, w, 'final', centre, 3)).toBeGreaterThan(20); // still white around the centre
    }
  });

  it('adds almost no weight at a V-shaped joint (legs converging to a point)', () => {
    const a = (12 / 2) * (Math.PI / 180);
    const apex = { x: 120, y: 150 };
    const down = Array.from({ length: 131 }, (_, i) => ({ x: apex.x - Math.sin(a) * (130 - i), y: apex.y - Math.cos(a) * (130 - i) }));
    const up = Array.from({ length: 131 }, (_, i) => ({ x: apex.x + Math.sin(a) * i, y: apex.y - Math.cos(a) * i }));
    const stroke = processStroke(rawStroke(samplePath([...down, ...up], { seed: 5, noise: 0.3, speed: 600 })));
    for (const w of [4.5, 8]) {
      const live = area(strokeToOutline(stroke, w, 'live'));
      const fin = area(strokeToOutline(stroke, w, 'final'));
      expect(fin / live).toBeLessThan(1.03); // distance-based bridging used to add 3-5 % here
      expect(fin / live).toBeGreaterThan(0.97);
    }
  });
});

describe('outline is always one closed, contiguous loop (regression: spike / notch from broken subpaths)', () => {
  const gap = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

  it.each([4.5, 9])('random strokes at pen width %s: no break in the chain, closed exactly', (W) => {
    for (let seed = 1; seed <= 40; seed++) {
      const pts = penWalk(seed).map((p) => ({ ...p, x: p.x * 0.5 + 10, y: p.y * 0.5 + 10 }));
      const stroke = processStroke(rawStroke(pts));
      for (const quality of ['final', 'live'] as const) {
        const o = strokeToOutline(stroke, W, quality);
        for (let i = 0; i < o.length - 1; i++) expect(gap(o[i].p3, o[i + 1].p0)).toBeLessThan(1e-6);
        expect(gap(o[o.length - 1].p3, o[0].p0)).toBeLessThan(1e-6);
      }
    }
  });

  it('path data for an outline is a single subpath', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const pts = penWalk(seed).map((p) => ({ ...p, x: p.x * 0.5 + 10, y: p.y * 0.5 + 10 }));
      const d = strokeOutlinePath(processStroke(rawStroke(pts)), 9);
      expect(d.match(/M/g)).toHaveLength(1);
      expect(d.endsWith('Z')).toBe(true);
    }
  });

  it('a break inside a closed path is bridged with a line, never a second subpath', () => {
    const a = lineToBezier({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = lineToBezier({ x: 12, y: 3 }, { x: 20, y: 3 }); // does not start where `a` ends
    const open = segmentsToPathData([a, b]);
    const closed = segmentsToPathData([a, b], 2, true);
    expect(open.match(/M/g)).toHaveLength(2);
    expect(closed.match(/M/g)).toHaveLength(1);
    expect(closed).toContain('L12 3');
  });

  it('drops zero-length pieces of a closed outline instead of starting a subpath', () => {
    const p = { x: 5, y: 5 };
    const a = lineToBezier({ x: 0, y: 0 }, p);
    const dot: CubicBezier = { p0: p, p1: p, p2: p, p3: p };
    const b = lineToBezier(p, { x: 9, y: 0 });
    expect(segmentsToPathData([a, dot, b], 2, true).match(/M/g)).toHaveLength(1);
  });
});

describe('outline pieces (the animation reveals a stroke slice by slice)', () => {
  const winding = (pt: Vec2, poly: Vec2[]): number => {
    let w = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const cross = (b.x - a.x) * (pt.y - a.y) - (pt.x - a.x) * (b.y - a.y);
      if (a.y <= pt.y) {
        if (b.y > pt.y && cross > 0) w++;
      } else if (b.y <= pt.y && cross < 0) w--;
    }
    return w;
  };

  /** Cuts the stroke into `n` overlapping index ranges and builds one closed outline per range. */
  const pieces = (stroke: Stroke, width: number, n: number) => {
    const os = outlineSamples(stroke, width, 'final')!;
    const last = os.samples.length - 1;
    return Array.from({ length: n }, (_, k) => {
      const i0 = k === 0 ? 0 : Math.round((last * k) / n) - 2;
      const i1 = k === n - 1 ? last : Math.round((last * (k + 1)) / n) + 2;
      return sampleSegments(outlinePiece(os, i0, i1, 'final', { start: k === 0 ? 'round' : 'butt', end: k === n - 1 ? 'round' : 'butt' }), 10);
    });
  };

  it.each([
    [7, 3, 4.5],
    [8, 3, 6],
    [6, 2.5, 8],
  ])('the union of the pieces is the whole outline: no deep point is lost (loops r=%s, valleys r=%s, pen %s)', (rl, rv, W) => {
    const stroke = processStroke(rawStroke(samplePath(zigzagPath(rl, rv), { seed: 4, noise: 0.25, speed: 700 })));
    const whole = sampleSegments(strokeToOutline(stroke, W), 10);
    const parts = pieces(stroke, W, 12);
    // Depth is measured against a densely sampled boundary: on a long straight edge a sparse polygon would put
    // the nearest vertex several px away and make edge points look deep inside.
    const near = nearestDistance(sampleSegments(strokeToOutline(stroke, W), 80), 8);
    let xs = whole.map((p) => p.x);
    let ys = whole.map((p) => p.y);
    let deepMiss = 0;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.5) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.5) {
        const p = { x, y };
        if (winding(p, whole) !== 0 && near(p) > 0.8 && !parts.some((poly) => winding(p, poly) !== 0)) deepMiss++;
      }
    }
    // Pieces use the very same edge points as the whole outline, so only curve-fit noise at the edges can differ.
    expect(deepMiss).toBe(0);
    xs = ys = [];
  });

  it('every piece is a single closed, contiguous loop', () => {
    const stroke = processStroke(rawStroke(samplePath(zigzagPath(7, 3), { seed: 4, noise: 0.25, speed: 700 })));
    const os = outlineSamples(stroke, 5, 'final')!;
    const last = os.samples.length - 1;
    for (let k = 0; k < 10; k++) {
      const o = outlinePiece(os, Math.round((last * k) / 10), Math.min(last, Math.round((last * (k + 1)) / 10) + 2), 'final', { start: 'butt', end: 'butt' });
      for (let i = 0; i < o.length - 1; i++) expect(Math.hypot(o[i].p3.x - o[i + 1].p0.x, o[i].p3.y - o[i + 1].p0.y)).toBeLessThan(1e-6);
      expect(Math.hypot(o[o.length - 1].p3.x - o[0].p0.x, o[o.length - 1].p3.y - o[0].p0.y)).toBeLessThan(1e-6);
    }
  });
});
