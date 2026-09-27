export const TAU = Math.PI * 2;

export interface Vec2 {
  x: number;
  y: number;
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};

/** Wraps an angle into [-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function angleTo(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}

/** Rotates current angle toward target by at most maxStep. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export function fmt(n: number, digits = 0): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return n.toFixed(digits);
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function rgbToCss(r: number, g: number, b: number, a = 1): string {
  return a >= 1
    ? `rgb(${r | 0},${g | 0},${b | 0})`
    : `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

export function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (f >= 0) return rgbToHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
  return rgbToHex(r * (1 + f), g * (1 + f), b * (1 + f));
}

export function hsl(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function hslHex(h: number, s: number, l: number): string {
  const [r, g, b] = hsl(h, s, l);
  return rgbToHex(r, g, b);
}

/** Closest point distance from point P to segment AB. */
export function pointSegDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return dist2(px, py, ax + dx * t, ay + dy * t);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
