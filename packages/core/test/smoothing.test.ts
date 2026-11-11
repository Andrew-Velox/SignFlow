import { describe, expect, it } from 'vitest';
import {
  OneEuroFilter2D,
  bezierTangent,
  detectCorners,
  fitCurve,
  resolveSmoothing,
  smoothZeroPhase,
  type InputPoint,
  type Vec2,
} from '../src';
import { distToPolyline, gaussian, mulberry32, sampleSegments } from './helpers';

describe('OneEuroFilter2D', () => {
  it('leaves a stationary signal untouched', () => {
    const f = new OneEuroFilter2D(1, 0.1);
    let p = { x: 0, y: 0 };
    for (let i = 0; i < 20; i++) p = f.filter({ x: 50, y: 70 }, 1 / 120);
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(70, 6);
  });

  it('passes the first sample through unchanged', () => {
    const f = new OneEuroFilter2D(1, 0.1);
    expect(f.filter({ x: 3, y: 4 }, 0.01)).toEqual({ x: 3, y: 4 });
  });

  it('attenuates jitter at rest', () => {
    const rnd = mulberry32(7);
    const f = new OneEuroFilter2D(1, 0.01);
    let raw = 0;
    let out = 0;
    for (let i = 0; i < 400; i++) {
      const n = { x: gaussian(rnd), y: gaussian(rnd) };
      const o = f.filter(n, 1 / 120);
      if (i > 50) {
        raw += n.x * n.x + n.y * n.y;
        out += o.x * o.x + o.y * o.y;
      }
    }
    expect(Math.sqrt(out / raw)).toBeLessThan(0.35);
  });

  it('lags less at high speed than at low speed (the point of the filter)', () => {
    const lagAt = (speed: number) => {
      const f = new OneEuroFilter2D(1, 0.05);
      let last = { x: 0, y: 0 };
      let x = 0;
      for (let i = 0; i < 300; i++) {
        x += speed / 120;
        last = f.filter({ x, y: 0 }, 1 / 120);
      }
      return (x - last.x) / speed; // lag in seconds
    };
    expect(lagAt(1500)).toBeLessThan(lagAt(30));
  });

  it('survives zero and negative time steps', () => {
    const f = new OneEuroFilter2D(1, 0.1);
    f.filter({ x: 0, y: 0 }, 0.01);
    const a = f.filter({ x: 1, y: 1 }, 0);
    const b = f.filter({ x: 2, y: 2 }, -5);
    for (const p of [a, b]) expect(Number.isFinite(p.x + p.y)).toBe(true);
  });
});

describe('smoothZeroPhase', () => {
  const line = (n: number): InputPoint[] =>
    Array.from({ length: n }, (_, i) => ({ x: i * 5, y: 0, t: i * 8, pressure: 0.5 }));

  it('pins the first and last sample', () => {
    const pts = line(30);
    pts[10].y = 3;
    const out = smoothZeroPhase(pts, 1, 0.05);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[29]).toEqual({ x: 145, y: 0 });
  });

  it('introduces no systematic lag on a straight constant-speed line', () => {
    const out = smoothZeroPhase(line(60), 1, 0.05);
    for (let i = 10; i < 50; i++) expect(Math.abs(out[i].x - i * 5)).toBeLessThan(0.05);
  });

  it('removes the phase lag a one-way filter leaves behind', () => {
    // Three laps of a circle (≈ 1.8 Hz): a causal filter makes the output trail the input angle.
    const R = 40;
    const pts: InputPoint[] = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 33) * Math.PI;
      return { x: R * Math.cos(a), y: R * Math.sin(a), t: i * 8.33, pressure: 0.5 };
    });
    const angleError = (out: Vec2[]) => {
      let sum = 0;
      for (let i = 40; i < 160; i++) {
        const want = (i / 33) * Math.PI;
        const got = Math.atan2(out[i].y, out[i].x);
        sum += Math.atan2(Math.sin(got - want), Math.cos(got - want));
      }
      return sum / 120; // signed mean: negative = trailing the pen
    };
    const causal = new OneEuroFilter2D(2, 0);
    const c = pts.map((p) => causal.filter(p, 0.00833));
    const z = smoothZeroPhase(pts, 2, 0);
    expect(angleError(c)).toBeLessThan(-0.1);
    expect(Math.abs(angleError(z))).toBeLessThan(0.01);
  });

  it('returns short inputs unchanged', () => {
    const pts = line(2);
    expect(smoothZeroPhase(pts, 1, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
  });
});

describe('resolveSmoothing', () => {
  it('is monotonic: more smoothing = steadier filter and looser fit', () => {
    const a = resolveSmoothing(0);
    const b = resolveSmoothing(0.5);
    const c = resolveSmoothing(1);
    expect(a.minCutoff).toBeGreaterThan(b.minCutoff);
    expect(b.minCutoff).toBeGreaterThan(c.minCutoff);
    expect(a.beta).toBeGreaterThan(b.beta);
    expect(b.beta).toBeGreaterThan(c.beta);
    expect(a.fitTolerance).toBeLessThan(c.fitTolerance);
  });

  it('clamps out-of-range input', () => {
    expect(resolveSmoothing(-3)).toEqual(resolveSmoothing(0));
    expect(resolveSmoothing(9)).toEqual(resolveSmoothing(1));
  });
});

describe('detectCorners', () => {
  const zigzag: Vec2[] = [];
  for (let i = 0; i <= 30; i++) zigzag.push({ x: i * 2, y: 0 }); // east
  for (let i = 1; i <= 30; i++) zigzag.push({ x: 60 + i * 0.6, y: i * 2 }); // sharp turn down (73°)
  for (let i = 1; i <= 30; i++) zigzag.push({ x: 78 + i * 2, y: 60 - i * 0.2 }); // sharp turn east (79°)

  it('finds sharp turns and nothing else', () => {
    const c = detectCorners(zigzag, 7, 60);
    expect(c).toHaveLength(2);
    expect(Math.abs(c[0] - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(c[1] - 60)).toBeLessThanOrEqual(1);
  });

  it('ignores a gently curving arc', () => {
    const arc = Array.from({ length: 120 }, (_, i) => ({ x: 80 * Math.cos(i / 40), y: 80 * Math.sin(i / 40) }));
    expect(detectCorners(arc, 7, 60)).toEqual([]);
  });

  it('is robust to ±0.7 px noise', () => {
    const rnd = mulberry32(3);
    const noisy = zigzag.map((p) => ({ x: p.x + gaussian(rnd) * 0.5, y: p.y + gaussian(rnd) * 0.5 }));
    expect(detectCorners(noisy, 7, 60)).toHaveLength(2);
  });

  it('never reports the end points', () => {
    const c = detectCorners(zigzag, 7, 20);
    expect(c.every((i) => i > 0 && i < zigzag.length - 1)).toBe(true);
  });

  it('copes with very short input', () => {
    expect(detectCorners([{ x: 0, y: 0 }, { x: 1, y: 1 }], 7, 60)).toEqual([]);
  });
});

describe('fitCurve (Schneider)', () => {
  it('never swings wildly between samples (no spikes across a sudden jump)', () => {
    // A thin edge that suddenly jumps 9 px sideways with no samples in between: the situation at a hairpin.
    const pts = [
      ...Array.from({ length: 20 }, (_, i) => ({ x: i * 1, y: 0 })),
      ...Array.from({ length: 20 }, (_, i) => ({ x: 19 - i, y: 9 })),
    ];
    const segs = fitCurve(pts, 0.12);
    const pathLen = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    for (const s of segs) {
      for (const p of [s.p0, s.p1, s.p2, s.p3]) expect(Number.isFinite(p.x + p.y)).toBe(true);
      expect(Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y)).toBeLessThanOrEqual(pathLen);
      expect(Math.hypot(s.p2.x - s.p3.x, s.p2.y - s.p3.y)).toBeLessThanOrEqual(pathLen);
    }
    const curve = sampleSegments(segs, 60);
    for (const p of curve) expect(distToPolyline(p, pts)).toBeLessThan(2);
  });

  it('fits a straight line with a single segment', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i * 3, y: i * 1.5 }));
    expect(fitCurve(pts, 0.5)).toHaveLength(1);
  });

  it('fits a circular arc compactly and within tolerance', () => {
    const R = 60;
    const pts = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 199) * 1.5 * Math.PI;
      return { x: R * Math.cos(a), y: R * Math.sin(a) };
    });
    const tol = 0.5;
    const segs = fitCurve(pts, tol);
    expect(segs.length).toBeLessThanOrEqual(6); // 270° of arc
    const curve = sampleSegments(segs, 60);
    for (const p of pts) expect(distToPolyline(p, curve)).toBeLessThan(tol + 0.05);
  });

  it('honours the error bound on noisy data', () => {
    const rnd = mulberry32(11);
    const pts = Array.from({ length: 300 }, (_, i) => {
      const x = i * 2;
      return { x, y: 40 * Math.sin(x / 35) + gaussian(rnd) * 0.4 };
    });
    for (const tol of [0.4, 1, 2.5]) {
      const segs = fitCurve(pts, tol);
      const curve = sampleSegments(segs, 60);
      let worst = 0;
      for (const p of pts) worst = Math.max(worst, distToPolyline(p, curve));
      expect(worst).toBeLessThan(tol + 0.15);
    }
  });

  it('uses fewer segments as the tolerance grows', () => {
    const rnd = mulberry32(5);
    const pts = Array.from({ length: 300 }, (_, i) => ({ x: i * 2, y: 40 * Math.sin(i / 17) + gaussian(rnd) * 0.4 }));
    expect(fitCurve(pts, 2.5).length).toBeLessThan(fitCurve(pts, 0.3).length);
  });

  it('produces a G0-continuous chain that is G1 at every split', () => {
    const pts = Array.from({ length: 160 }, (_, i) => ({ x: i * 2, y: 50 * Math.sin(i / 12) }));
    const segs = fitCurve(pts, 0.3);
    expect(segs.length).toBeGreaterThan(2);
    for (let i = 0; i < segs.length - 1; i++) {
      expect(segs[i].p3).toEqual(segs[i + 1].p0);
      const a = bezierTangent(segs[i], 1);
      const b = bezierTangent(segs[i + 1], 0);
      expect(a.x * b.x + a.y * b.y).toBeGreaterThan(0.999);
    }
  });

  it('interpolates the first and last point', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ x: i, y: Math.sin(i / 4) * 5 }));
    const segs = fitCurve(pts, 0.5);
    expect(segs[0].p0).toEqual(pts[0]);
    expect(segs[segs.length - 1].p3).toEqual(pts[29]);
  });

  it('handles two points and degenerate input', () => {
    expect(fitCurve([{ x: 0, y: 0 }, { x: 9, y: 0 }], 1)).toHaveLength(1);
    expect(fitCurve([{ x: 0, y: 0 }], 1)).toEqual([]);
    expect(fitCurve([], 1)).toEqual([]);
  });
});
