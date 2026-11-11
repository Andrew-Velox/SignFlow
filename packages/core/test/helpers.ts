import type { CubicBezier, InputPoint, RawStroke, Vec2 } from '../src';
import { bezierPoint, distance } from '../src';

/** Deterministic PRNG so tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** Cursive-style loops (prolate cycloid): `loops` loops, `advance` px per loop, loop radius `radius`. */
export function loopsCurve(loops = 5, advance = 46, radius = 22): (t: number) => Vec2 {
  return (t) => {
    const th = 2 * Math.PI * loops * t;
    return { x: 40 + (advance * th) / (2 * Math.PI) - radius * Math.sin(th), y: 160 + radius * Math.cos(th) };
  };
}

export function polylineFromFn(fn: (t: number) => Vec2, steps: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i++) out.push(fn(i / steps));
  return out;
}

/** Walks a polyline at constant speed and samples it like a pointer device would. */
export function samplePath(
  path: readonly Vec2[],
  opts: { speed?: number; hz?: number; noise?: number; quantize?: boolean; seed?: number; pressure?: (u: number) => number } = {},
): InputPoint[] {
  const { speed = 600, hz = 120, noise = 0.6, quantize = true, seed = 1, pressure } = opts;
  const rnd = mulberry32(seed);
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distance(path[i - 1], path[i]));
  const total = cum[cum.length - 1];
  const dt = 1000 / hz;
  const out: InputPoint[] = [];
  let seg = 0;
  for (let k = 0; ; k++) {
    const s = Math.min(total, ((k * dt) / 1000) * speed);
    while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
    const span = cum[seg + 1] - cum[seg];
    const f = span > 0 ? (s - cum[seg]) / span : 0;
    let x = path[seg].x + (path[seg + 1].x - path[seg].x) * f + gaussian(rnd) * noise;
    let y = path[seg].y + (path[seg + 1].y - path[seg].y) * f + gaussian(rnd) * noise;
    if (quantize) {
      x = Math.round(x);
      y = Math.round(y);
    }
    out.push({ x, y, t: 1000 + k * dt, pressure: pressure ? pressure(total > 0 ? s / total : 0) : 0.5 });
    if (s >= total) break;
  }
  return out;
}

export function rawStroke(points: InputPoint[], pointerKind: RawStroke['pointerKind'] = 'mouse', id = 's1'): RawStroke {
  return { id, pointerKind, points };
}

export function sampleSegments(segments: readonly CubicBezier[], perSegment = 24): Vec2[] {
  const out: Vec2[] = [];
  for (const s of segments) for (let i = 0; i <= perSegment; i++) out.push(bezierPoint(s, i / perSegment));
  return out;
}

/** Distance from `p` to a polyline. */
export function distToPolyline(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

export function meanDeviation(points: readonly Vec2[], truth: readonly Vec2[]): number {
  let s = 0;
  for (const p of points) s += distToPolyline(p, truth);
  return s / points.length;
}

export function maxDeviation(points: readonly Vec2[], truth: readonly Vec2[]): number {
  let m = 0;
  for (const p of points) m = Math.max(m, distToPolyline(p, truth));
  return m;
}

/** Resamples a polyline at uniform arc-length steps. */
export function resample(poly: readonly Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [poly[0]];
  let carry = 0;
  for (let i = 1; i < poly.length; i++) {
    let a = poly[i - 1];
    const b = poly[i];
    let d = distance(a, b);
    while (carry + d >= step) {
      const t = (step - carry) / d;
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(a);
      d = distance(a, b);
      carry = 0;
    }
    carry += d;
  }
  return out;
}

/** Mean absolute turning angle (rad) of a polyline resampled at `step` px: a direct roughness measure. */
export function roughness(poly: readonly Vec2[], step = 3): number {
  const r = resample(poly, step);
  let sum = 0;
  let n = 0;
  for (let i = 1; i < r.length - 1; i++) {
    const a1 = Math.atan2(r[i].y - r[i - 1].y, r[i].x - r[i - 1].x);
    const a2 = Math.atan2(r[i + 1].y - r[i].y, r[i + 1].x - r[i].x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    sum += Math.abs(d);
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Random pen-like walk: smooth runs, sharp turns, full reversals (hairpins), speed bursts, duplicate
 * timestamps. Used to hunt for geometry bugs at cusps.
 */
export function penWalk(seed: number): InputPoint[] {
  const r = mulberry32(seed);
  let x = 100 + r() * 300;
  let y = 100 + r() * 200;
  let a = r() * Math.PI * 2;
  let t = 1000;
  let speed = 2 + r() * 10;
  const pts: InputPoint[] = [];
  const n = 20 + Math.floor(r() * 140);
  for (let i = 0; i < n; i++) {
    pts.push({ x: Math.round(x), y: Math.round(y), t, pressure: 0.5 });
    const roll = r();
    if (roll < 0.06) a += Math.PI * (0.7 + r() * 0.6);
    else if (roll < 0.14) a += (r() - 0.5) * 2.2;
    else a += (r() - 0.5) * 0.35;
    if (r() < 0.1) speed = 1 + r() * 40;
    x += Math.cos(a) * speed + gaussian(r) * 0.4;
    y += Math.sin(a) * speed + gaussian(r) * 0.4;
    t += r() < 0.08 ? 0 : 4 + r() * 12;
  }
  return pts;
}

/** Nearest-sample distance through a spatial hash (8 px cells): O(1) per query instead of O(n). */
export function nearestDistance(samples: readonly Vec2[], reach = 60): (q: Vec2) => number {
  const cells = new Map<string, Vec2[]>();
  const key = (x: number, y: number) => `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
  for (const p of samples) {
    const k = key(p.x, p.y);
    const list = cells.get(k);
    if (list) list.push(p);
    else cells.set(k, [p]);
  }
  const c = Math.ceil(reach / 8) + 1;
  return (q) => {
    let best = Infinity;
    const cx = Math.floor(q.x / 8);
    const cy = Math.floor(q.y / 8);
    for (let i = -c; i <= c; i++)
      for (let j = -c; j <= c; j++)
        for (const p of cells.get(`${cx + i},${cy + j}`) ?? []) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    return best === Infinity ? reach * 10 : best;
  };
}

/** Sharp zigzag: slanted legs, a small loop at every peak, a tight turn in every valley. */
export function zigzagPath(rLoop: number, rValley: number, peaks = 3): Vec2[] {
  const path: Vec2[] = [];
  let x = 30;
  let y = 220;
  let th = (-70 * Math.PI) / 180;
  const straight = (n: number) => {
    for (let i = 0; i < n; i++) {
      path.push({ x, y });
      x += Math.cos(th);
      y += Math.sin(th);
    }
  };
  const turn = (deg: number, r: number) => {
    const steps = Math.round(((Math.abs(deg) * Math.PI) / 180) * r);
    const d = Math.sign(deg);
    for (let i = 0; i < steps; i++) {
      path.push({ x, y });
      x += Math.cos(th);
      y += Math.sin(th);
      th += d / r;
    }
  };
  for (let p = 0; p < peaks; p++) {
    straight(95);
    turn(500, rLoop);
    straight(95);
    turn(-140, rValley);
  }
  straight(80);
  return path;
}
