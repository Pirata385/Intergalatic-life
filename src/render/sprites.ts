// Cached procedural sprites: stars with coronas, black holes, stations,
// asteroids and planet spheres.
import type { StarDef } from '../gen/stars';
import type { Body } from '../gen/system';
import { generatePlanetTexture, PlanetTexture } from '../gen/planet';
import { renderSphere } from './planetcpu';
import { RNG } from '../core/rng';
import { shade, hexToRgb } from '../core/math';

// ------------------------------------------------------------------ stars
const starCache = new Map<string, HTMLCanvasElement>();

export function starSprite(star: StarDef, size: number): HTMLCanvasElement {
  const bucket = Math.max(16, Math.min(512, Math.pow(2, Math.round(Math.log2(size)))));
  const key = star.cls + star.color + bucket;
  let c = starCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const full = bucket * 2;
  c.width = full;
  c.height = full;
  const g = c.getContext('2d')!;
  const cx = full / 2, r = bucket * 0.32;
  const rng = new RNG(bucket * 31 + star.cls.charCodeAt(0));
  const [cr, cg, cb] = hexToRgb(star.glow);
  // rays
  g.save();
  g.translate(cx, cx);
  g.globalCompositeOperation = 'lighter';
  const rays = 70;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + rng.range(-0.03, 0.03);
    const len = r * rng.range(1.25, 1.9);
    const grd = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grd.addColorStop(0, `rgba(255,255,255,0.0)`);
    grd.addColorStop(0.55, `rgba(${cr},${cg},${cb},0.35)`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.strokeStyle = grd;
    g.lineWidth = Math.max(1, bucket / 90) * rng.range(0.6, 1.6);
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.stroke();
  }
  // corona
  const cor = g.createRadialGradient(0, 0, r * 0.9, 0, 0, r * 1.5);
  cor.addColorStop(0, `rgba(${cr},${cg},${cb},0.8)`);
  cor.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = cor;
  g.beginPath();
  g.arc(0, 0, r * 1.5, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  // disc
  const disc = g.createRadialGradient(-r * 0.15, -r * 0.15, r * 0.1, 0, 0, r);
  disc.addColorStop(0, '#ffffff');
  disc.addColorStop(0.7, shade(star.color, 0.5));
  disc.addColorStop(1, star.color);
  g.fillStyle = disc;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  // granulation / sunspots near the limb
  const spots = star.cls === 'M' || star.cls === 'K' ? 16 : 10;
  for (let i = 0; i < spots; i++) {
    const a = rng.range(0, Math.PI * 2), d = r * rng.range(0.7, 0.93);
    g.fillStyle = `rgba(${Math.max(0, cr - 90)},${Math.max(0, cg - 110)},${Math.max(0, cb - 120)},${rng.range(0.25, 0.55).toFixed(2)})`;
    g.beginPath();
    g.ellipse(Math.cos(a) * d, Math.sin(a) * d, r * rng.range(0.03, 0.08), r * rng.range(0.02, 0.05), a, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  starCache.set(key, c);
  return c;
}

export function drawStar(g: CanvasRenderingContext2D, star: StarDef, x: number, y: number, radiusPx: number, t: number): void {
  if (star.cls === 'BH') {
    drawBlackHole(g, x, y, radiusPx, t, star.glow);
    return;
  }
  const [cr, cg, cb] = hexToRgb(star.glow);
  // big soft halo
  const halo = radiusPx * (star.cls === 'NS' || star.cls === 'WD' ? 9 : 5);
  const grd = g.createRadialGradient(x, y, radiusPx * 0.5, x, y, halo);
  grd.addColorStop(0, `rgba(${cr},${cg},${cb},0.35)`);
  grd.addColorStop(0.3, `rgba(${cr},${cg},${cb},0.1)`);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(x - halo, y - halo, halo * 2, halo * 2);
  const spr = starSprite(star, radiusPx * 3.2);
  const s = radiusPx / 0.32 / 2 * 2; // sprite's disc radius = 0.32 * bucket; full = 2*bucket
  const pulse = 1 + Math.sin(t * 2 + radiusPx) * 0.015;
  g.save();
  g.translate(x, y);
  g.rotate(t * 0.03);
  g.drawImage(spr, (-s * pulse), (-s * pulse), s * 2 * pulse, s * 2 * pulse);
  g.restore();
  if (star.cls === 'NS') {
    // pulsar beams
    g.save();
    g.translate(x, y);
    g.rotate(t * 3);
    g.globalCompositeOperation = 'lighter';
    for (const dir of [1, -1]) {
      const lg = g.createLinearGradient(0, 0, 0, dir * radiusPx * 14);
      lg.addColorStop(0, 'rgba(160,200,255,0.6)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(-radiusPx * 0.4, 0);
      g.lineTo(radiusPx * 0.4, 0);
      g.lineTo(radiusPx * 1.6, dir * radiusPx * 14);
      g.lineTo(-radiusPx * 1.6, dir * radiusPx * 14);
      g.fill();
    }
    g.restore();
  }
}

export function drawBlackHole(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, glow = '#ff9a40'): void {
  const [cr, cg, cb] = hexToRgb(glow);
  // diffuse glow
  const halo = r * 6;
  const grd = g.createRadialGradient(x, y, r, x, y, halo);
  grd.addColorStop(0, `rgba(${cr},${cg},${cb},0.45)`);
  grd.addColorStop(0.4, `rgba(${cr},${Math.floor(cg * 0.6)},${Math.floor(cb * 0.4)},0.12)`);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(x - halo, y - halo, halo * 2, halo * 2);
  const diskR = r * 3.8;
  const squash = 0.22;
  const band = (front: boolean) => {
    g.save();
    g.translate(x, y);
    g.rotate(-0.12);
    g.scale(1, squash);
    for (let i = 0; i < 6; i++) {
      const rr = diskR * (0.45 + i * 0.1);
      g.beginPath();
      if (front) g.arc(0, 0, rr, 0, Math.PI);
      else g.arc(0, 0, rr, Math.PI, Math.PI * 2);
      g.lineWidth = diskR * 0.09;
      g.strokeStyle = i % 2 ? `rgba(255,${200 - i * 15},${120 - i * 15},${0.75 - i * 0.08})` : `rgba(255,240,200,${0.85 - i * 0.1})`;
      g.stroke();
    }
    // orbiting hot spots
    for (let k = 0; k < 7; k++) {
      const a = t * (0.6 + k * 0.07) + k * 0.9;
      const s = Math.sin(a);
      if ((s > 0) !== front) continue;
      const rr = diskR * (0.5 + (k % 4) * 0.12);
      g.fillStyle = 'rgba(255,255,240,0.95)';
      g.beginPath();
      g.arc(Math.cos(a) * rr, s * rr, diskR * 0.035 / squash * 0.3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  };
  band(false);
  // lensed back of the disk arching over the hole
  g.save();
  g.translate(x, y);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.ellipse(0, -r * 0.1, r * (1.35 + i * 0.18), r * (1.25 + i * 0.15), 0, Math.PI * 1.05, Math.PI * 1.95);
    g.lineWidth = r * 0.14;
    g.strokeStyle = `rgba(255,${220 - i * 30},${150 - i * 30},${0.55 - i * 0.12})`;
    g.stroke();
  }
  g.restore();
  // event horizon
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,245,230,0.9)';
  g.lineWidth = Math.max(1, r * 0.06);
  g.beginPath();
  g.arc(x, y, r * 1.04, 0, Math.PI * 2);
  g.stroke();
  band(true);
}

// ------------------------------------------------------------------ stations
const stationCache = new Map<string, HTMLCanvasElement>();

export function stationSprite(type: string, color: string, size: number): HTMLCanvasElement {
  const bucket = Math.max(32, Math.min(384, Math.pow(2, Math.round(Math.log2(size)))));
  const key = type + color + bucket;
  let c = stationCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = bucket;
  c.height = bucket;
  const g = c.getContext('2d')!;
  const cx = bucket / 2, R = bucket * 0.46;
  const metal = '#8a95a8', dark = '#2a303c', light = '#c8d4e4';
  g.translate(cx, cx);
  const lights = (n: number, rr: number, col: string) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.fillStyle = col;
      g.beginPath();
      g.arc(Math.cos(a) * rr, Math.sin(a) * rr, Math.max(1, bucket / 90), 0, Math.PI * 2);
      g.fill();
    }
  };
  if (type === 'pirate') {
    // hollowed asteroid base
    const rng = new RNG(bucket);
    g.fillStyle = '#5a4a3e';
    g.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, rr = R * rng.range(0.75, 1);
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.fillStyle = '#3a2e26';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(rng.range(-R, R) * 0.5, rng.range(-R, R) * 0.5, R * rng.range(0.08, 0.18), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = dark;
    g.fillRect(-R * 0.25, -R * 0.08, R * 0.9, R * 0.16);
    lights(6, R * 0.6, color);
  } else if (type === 'shipyard') {
    g.strokeStyle = metal;
    g.lineWidth = bucket / 40;
    g.strokeRect(-R * 0.9, -R * 0.55, R * 1.8, R * 1.1);
    for (let i = -3; i <= 3; i++) {
      g.beginPath();
      g.moveTo(i * R * 0.26, -R * 0.55);
      g.lineTo(i * R * 0.26, R * 0.55);
      g.stroke();
    }
    g.fillStyle = dark;
    g.fillRect(-R * 0.35, -R * 0.2, R * 0.9, R * 0.4);
    g.fillStyle = color;
    g.fillRect(-R * 0.9, -R * 0.62, R * 1.8, R * 0.08);
    g.fillRect(-R * 0.9, R * 0.54, R * 1.8, R * 0.08);
    lights(10, R * 0.95, '#ffe080');
  } else if (type === 'military') {
    g.fillStyle = dark;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const rr = i % 2 ? R : R * 0.72;
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = bucket / 60;
    g.stroke();
    g.fillStyle = metal;
    g.beginPath();
    g.arc(0, 0, R * 0.4, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      g.fillStyle = light;
      g.beginPath();
      g.arc(Math.cos(a) * R * 0.75, Math.sin(a) * R * 0.75, R * 0.1, 0, Math.PI * 2);
      g.fill();
    }
    lights(8, R * 0.55, '#ff5050');
  } else if (type === 'colony') {
    g.fillStyle = '#4a5a50';
    g.beginPath();
    g.arc(0, 0, R * 0.9, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.fillStyle = i % 2 ? '#a0e0b0' : '#80c0ff';
      g.beginPath();
      g.arc(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, R * 0.22, 0, Math.PI * 2);
      g.fill();
    }
    lights(12, R * 0.85, color);
  } else {
    // trade ring station
    g.strokeStyle = metal;
    g.lineWidth = R * 0.18;
    g.beginPath();
    g.arc(0, 0, R * 0.78, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = dark;
    g.lineWidth = R * 0.06;
    g.beginPath();
    g.arc(0, 0, R * 0.78, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = light;
    g.lineWidth = bucket / 80;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.25, Math.sin(a) * R * 0.25);
      g.lineTo(Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7);
      g.stroke();
    }
    g.fillStyle = metal;
    g.beginPath();
    g.arc(0, 0, R * 0.28, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(0, 0, R * 0.12, 0, Math.PI * 2);
    g.fill();
    // solar panels
    g.fillStyle = '#2a4a7a';
    g.fillRect(-R * 1.0, -R * 0.08, R * 0.2, R * 0.16);
    g.fillRect(R * 0.8, -R * 0.08, R * 0.2, R * 0.16);
    lights(16, R * 0.78, '#ffe8a0');
  }
  stationCache.set(key, c);
  return c;
}

// ------------------------------------------------------------------ asteroids
const astCache = new Map<string, HTMLCanvasElement>();

export function asteroidSprite(kind: string, variant: number): HTMLCanvasElement {
  const key = kind + variant;
  let c = astCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const rng = new RNG(variant * 97 + kind.length);
  const base = kind === 'ice' ? '#a8c8dc' : kind === 'crys' ? '#7a5aa8' : rng.pick(['#7a6a5a', '#6a6460', '#806a58']);
  const pts: [number, number][] = [];
  const n = 9 + rng.int(0, 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = 22 * rng.range(0.7, 1.05);
    pts.push([32 + Math.cos(a) * r, 32 + Math.sin(a) * r]);
  }
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  const grd = g.createLinearGradient(10, 10, 54, 54);
  grd.addColorStop(0, shade(base, 0.35));
  grd.addColorStop(0.6, base);
  grd.addColorStop(1, shade(base, -0.6));
  g.fillStyle = grd;
  g.fill();
  g.save();
  g.clip();
  for (let i = 0; i < 5; i++) {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.arc(rng.range(16, 48), rng.range(16, 48), rng.range(2, 6), 0, Math.PI * 2);
    g.fill();
  }
  if (kind === 'crys') {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#e0c0ff';
      const x = rng.range(20, 44), y = rng.range(20, 44);
      g.beginPath();
      g.moveTo(x, y - 6);
      g.lineTo(x + 3, y);
      g.lineTo(x, y + 6);
      g.lineTo(x - 3, y);
      g.fill();
    }
  }
  g.restore();
  astCache.set(key, c);
  return c;
}

// ------------------------------------------------------------------ planets
interface PlanetEntry {
  tex: PlanetTexture;
  sprite: HTMLCanvasElement | null;
  size: number;
  rot: number;
  lx: number;
  ly: number;
  last: number;
}

export class PlanetSprites {
  private map = new Map<string, PlanetEntry>();
  private texRes: number;
  /** New textures generated this frame (spreads the cost across frames). */
  budget = 1;

  has(body: Body, inhabited = 0): boolean {
    return this.map.has(body.sysId + ':' + body.key + ':' + (inhabited > 0 ? 1 : 0));
  }

  constructor(texRes = 128) {
    this.texRes = texRes;
  }

  texture(body: Body, inhabited = 0): PlanetTexture {
    const key = body.sysId + ':' + body.key + ':' + (inhabited > 0 ? 1 : 0);
    let e = this.map.get(key);
    if (!e) {
      e = { tex: generatePlanetTexture(body, this.texRes, inhabited), sprite: null, size: 0, rot: -99, lx: 0, ly: 0, last: 0 };
      this.map.set(key, e);
      if (this.map.size > 60) {
        const oldest = [...this.map.entries()].sort((a, b) => a[1].last - b[1].last)[0];
        this.map.delete(oldest[0]);
      }
    }
    return e.tex;
  }

  /** Sphere sprite for a body at a pixel size, lit from (lx, ly) screen direction. */
  sprite(body: Body, sizePx: number, rot: number, lx: number, ly: number, time: number, inhabited = 0): HTMLCanvasElement | null {
    const key = body.sysId + ':' + body.key + ':' + (inhabited > 0 ? 1 : 0);
    if (!this.map.has(key)) {
      if (this.budget <= 0) return null;
      this.budget--;
    }
    this.texture(body, inhabited);
    const e = this.map.get(key)!;
    e.last = time;
    const size = Math.max(8, Math.min(320, Math.round(sizePx / 4) * 4));
    const needs = !e.sprite || Math.abs(e.size - size) > size * 0.15 || Math.abs(rot - e.rot) > 0.02 || Math.abs(lx - e.lx) + Math.abs(ly - e.ly) > 0.08;
    if (needs) {
      const lz = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly)) * 0.6;
      e.sprite = renderSphere(e.tex, size, { rotation: rot, lightX: lx, lightY: ly, lightZ: lz }, e.sprite && e.size === size ? e.sprite : undefined);
      e.size = size;
      e.rot = rot;
      e.lx = lx;
      e.ly = ly;
    }
    return e.sprite!;
  }

  clear(): void {
    this.map.clear();
  }
}
