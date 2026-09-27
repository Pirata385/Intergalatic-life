// Layered parallax starfield with soft coloured glows (matches the reference
// look: dense small stars, some with warm/cool halos).
import { RNG } from '../core/rng';

const TILE = 1024;

function makeLayer(seed: number, count: number, glowChance: number, sizeMul: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  const rng = new RNG(seed);
  const colors = ['#ffffff', '#dfe8ff', '#b8ccff', '#ffe8c8', '#ffd0a0', '#ffc090', '#c8d8ff'];
  for (let i = 0; i < count; i++) {
    const x = rng.next() * TILE, y = rng.next() * TILE;
    const col = rng.pick(colors);
    const s = (rng.next() ** 3 * 1.6 + 0.4) * sizeMul;
    if (rng.chance(glowChance)) {
      const r = s * rng.range(5, 10);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, col);
      grd.addColorStop(0.15, col + 'aa');
      grd.addColorStop(0.4, col + '22');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.globalAlpha = rng.range(0.35, 0.8);
      for (const [ox, oy] of [[0, 0], [TILE, 0], [-TILE, 0], [0, TILE], [0, -TILE]]) g.fillRect(x - r + ox, y - r + oy, r * 2, r * 2);
      g.globalAlpha = 1;
    }
    g.fillStyle = col;
    g.globalAlpha = rng.range(0.5, 1);
    g.beginPath();
    g.arc(x, y, s, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return c;
}

export class Starfield {
  layers: { c: HTMLCanvasElement; parallax: number; pattern: CanvasPattern | null }[] = [];
  nebula: HTMLCanvasElement | null = null;

  constructor(seed = 1, quality = 1) {
    this.layers = [
      { c: makeLayer(seed + 1, Math.round(1400 * quality), 0.0, 0.6), parallax: 0.02, pattern: null },
      { c: makeLayer(seed + 2, Math.round(420 * quality), 0.08, 0.9), parallax: 0.05, pattern: null },
      { c: makeLayer(seed + 3, Math.round(90 * quality), 0.35, 1.3), parallax: 0.1, pattern: null },
    ];
  }

  /** Draws the background. camX/camY are world coords, scale is zoom-ish factor for parallax. */
  draw(g: CanvasRenderingContext2D, w: number, h: number, camX: number, camY: number, tint?: string, tintAlpha = 0): void {
    g.fillStyle = '#05060b';
    g.fillRect(0, 0, w, h);
    if (tint && tintAlpha > 0) {
      const grd = g.createRadialGradient(w * 0.6, h * 0.4, 0, w * 0.6, h * 0.4, Math.max(w, h) * 0.9);
      grd.addColorStop(0, tint);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = tintAlpha;
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
    }
    for (const L of this.layers) {
      if (!L.pattern) L.pattern = g.createPattern(L.c, 'repeat');
      if (!L.pattern) continue;
      const ox = -((camX * L.parallax) % TILE), oy = -((camY * L.parallax) % TILE);
      g.save();
      g.translate(ox, oy);
      g.fillStyle = L.pattern;
      g.fillRect(-ox - 1, -oy - 1, w + 2, h + 2);
      g.restore();
    }
  }
}
