import type { Vec2 } from '../types';
import { cumulativeLength } from '../geometry/math';

/**
 * Finds sharp direction changes (pen reversals, cusps, the corner of a "k").
 *
 * For every interior sample the turning angle between the incoming chord
 * (to the sample `windowPx` of arc length behind) and the outgoing chord
 * (to the sample `windowPx` ahead) is measured. A fixed arc-length lever arm
 * makes the test independent of sampling density and tolerant of ±1 px
 * jitter (≈ 8° of noise at windowPx = 7). Candidates above `angleDeg` are
 * reduced to local maxima with non-maximum suppression.
 *
 * Splitting at corners lets each side be smoothed and fitted on its own, so
 * the smoother never rounds a deliberately sharp turn.
 *
 * @returns sorted interior indices (never 0 or points.length - 1)
 */
export function detectCorners(points: readonly Vec2[], windowPx: number, angleDeg: number): number[] {
  const n = points.length;
  if (n < 5) return [];
  const s = cumulativeLength(points);
  const total = s[n - 1];
  const minArm = windowPx * 0.6;
  if (total < 2 * minArm) return [];
  const threshold = (angleDeg * Math.PI) / 180;

  const candidates: { i: number; angle: number }[] = [];
  let a = 0; // index ~windowPx behind
  let b = 0; // index ~windowPx ahead
  for (let i = 1; i < n - 1; i++) {
    while (a < i - 1 && s[i] - s[a + 1] >= windowPx) a++;
    if (b < i) b = i;
    while (b < n - 1 && s[b] - s[i] < windowPx) b++;
    if (s[i] - s[a] < minArm || s[b] - s[i] < minArm) continue;
    const ux = points[i].x - points[a].x;
    const uy = points[i].y - points[a].y;
    const vx = points[b].x - points[i].x;
    const vy = points[b].y - points[i].y;
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (lu < 1e-9 || lv < 1e-9) continue;
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
    const angle = Math.acos(cos);
    if (angle >= threshold) candidates.push({ i, angle });
  }

  candidates.sort((p, q) => q.angle - p.angle);
  const accepted: number[] = [];
  for (const c of candidates) {
    if (accepted.every((j) => Math.abs(s[j] - s[c.i]) >= windowPx)) accepted.push(c.i);
  }
  return accepted.sort((p, q) => p - q);
}
