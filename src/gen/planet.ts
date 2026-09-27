// Planet surface texture generation (equirectangular maps) shared by the
// orbital sphere renderers and the landing terrain generator.
import { Noise } from '../core/noise';
import { RNG, hash } from '../core/rng';
import { clamp, hsl, lerp } from '../core/math';
import type { Body, PlanetType } from './system';

type RGB = [number, number, number];

export interface Palette {
  deep: RGB;
  shallow: RGB;
  shore: RGB;
  low: RGB;
  mid: RGB;
  high: RGB;
  peak: RGB;
  alt: RGB; // secondary land tone
  ice: RGB;
  lava: RGB;
  seaLevel: number;
  iceLat: number; // latitude (0..1) where polar ice starts
  atmo: RGB;
  atmoStrength: number;
  clouds: number; // 0..1 coverage
  cloudColor: RGB;
  liquid: boolean;
  hueShift: number;
}

const hex = (h: string): RGB => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

function shiftHue(c: RGB, deg: number, sat = 1): RGB {
  // cheap hue rotation in RGB space
  const a = (deg * Math.PI) / 180;
  const cosA = Math.cos(a), sinA = Math.sin(a);
  const k = 1 / 3, sq = Math.sqrt(k);
  const m00 = cosA + (1 - cosA) * k, m01 = k * (1 - cosA) - sq * sinA, m02 = k * (1 - cosA) + sq * sinA;
  const m10 = k * (1 - cosA) + sq * sinA, m11 = cosA + k * (1 - cosA), m12 = k * (1 - cosA) - sq * sinA;
  const m20 = k * (1 - cosA) - sq * sinA, m21 = k * (1 - cosA) + sq * sinA, m22 = cosA + k * (1 - cosA);
  let r = c[0] * m00 + c[1] * m01 + c[2] * m02;
  let g = c[0] * m10 + c[1] * m11 + c[2] * m12;
  let b = c[0] * m20 + c[1] * m21 + c[2] * m22;
  const l = (r + g + b) / 3;
  r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
}

export function makePalette(type: PlanetType, seed: number): Palette {
  const rng = new RNG(hash(seed, 0xabc));
  const hs = rng.range(-18, 18);
  const base: Palette = {
    deep: hex('#10284f'), shallow: hex('#2a64a0'), shore: hex('#c8b890'), low: hex('#4f7f3a'), mid: hex('#3d6a2e'),
    high: hex('#7a6a5a'), peak: hex('#ecedf0'), alt: hex('#8a7a4a'), ice: hex('#eef4fa'), lava: hex('#ff5a1a'),
    seaLevel: 0.0, iceLat: 0.8, atmo: hex('#6aa8ff'), atmoStrength: 0.6, clouds: 0.5, cloudColor: hex('#ffffff'), liquid: true, hueShift: hs,
  };
  switch (type) {
    case 'terran':
      base.seaLevel = rng.range(-0.05, 0.12);
      break;
    case 'ocean':
      base.seaLevel = rng.range(0.25, 0.4);
      base.clouds = 0.6;
      break;
    case 'jungle':
      Object.assign(base, { low: hex('#3a7a2a'), mid: hex('#24561c'), high: hex('#4a5a2a'), alt: hex('#5a8a2a'), seaLevel: rng.range(-0.2, -0.05), iceLat: 0.93, atmo: hex('#7ad0a0'), clouds: 0.65 });
      break;
    case 'arid':
      Object.assign(base, {
        deep: hex('#1a3a6a'), shallow: hex('#2a5a90'), shore: hex('#d8b890'), low: hex('#c8885a'), mid: hex('#a86a44'), high: hex('#8a5436'),
        peak: hex('#e8d0b8'), alt: hex('#e0bfa0'), seaLevel: -0.42, iceLat: 0.72, atmo: hex('#e0a070'), atmoStrength: 0.35, clouds: 0.08,
      });
      break;
    case 'desert':
      Object.assign(base, {
        shore: hex('#e8d0a0'), low: hex('#d8b070'), mid: hex('#c89a58'), high: hex('#a07848'), peak: hex('#e8d8b8'), alt: hex('#e8c888'),
        seaLevel: -0.6, iceLat: 0.95, atmo: hex('#f0c080'), atmoStrength: 0.35, clouds: 0.05,
      });
      break;
    case 'tundra':
      Object.assign(base, {
        low: hex('#7a8a70'), mid: hex('#5a6a5a'), high: hex('#8a8a88'), alt: hex('#a0a898'), peak: hex('#f4f6f8'), seaLevel: -0.1, iceLat: 0.55,
        atmo: hex('#a8c8e8'), clouds: 0.45, shallow: hex('#3a6a8a'),
      });
      break;
    case 'ice':
      Object.assign(base, {
        deep: hex('#5a8ab0'), shallow: hex('#8ab8d8'), shore: hex('#d0e8f4'), low: hex('#dcecf6'), mid: hex('#c0d8ea'), high: hex('#a8c0d8'),
        peak: hex('#ffffff'), alt: hex('#b8d8f0'), seaLevel: -0.3, iceLat: 0.0, atmo: hex('#c0e0ff'), atmoStrength: 0.3, clouds: 0.15, liquid: false,
      });
      break;
    case 'lava':
      Object.assign(base, {
        deep: hex('#ff4a10'), shallow: hex('#ff8a20'), shore: hex('#3a1a14'), low: hex('#2a1614'), mid: hex('#3a2220'), high: hex('#4a302a'),
        peak: hex('#5a4038'), alt: hex('#1a0e0c'), seaLevel: rng.range(-0.15, 0.05), iceLat: 2, atmo: hex('#ff6a30'), atmoStrength: 0.5, clouds: 0.1,
        cloudColor: hex('#402a20'), liquid: true,
      });
      break;
    case 'toxic':
      Object.assign(base, {
        deep: hex('#4a5a10'), shallow: hex('#7a8a20'), shore: hex('#a0a040'), low: hex('#8a8a3a'), mid: hex('#6a7030'), high: hex('#5a5030'),
        peak: hex('#b0a870'), alt: hex('#a09a3a'), seaLevel: rng.range(-0.2, 0.1), iceLat: 2, atmo: hex('#c0d040'), atmoStrength: 0.9, clouds: 0.75,
        cloudColor: hex('#d8d890'),
      });
      break;
    case 'barren':
      Object.assign(base, {
        deep: hex('#4a4644'), shallow: hex('#5a5654'), shore: hex('#6a6664'), low: hex('#8a8580'), mid: hex('#77726e'), high: hex('#9a9590'),
        peak: hex('#b0aca8'), alt: hex('#686360'), seaLevel: -2, iceLat: 2, atmo: hex('#a0a0a0'), atmoStrength: 0.05, clouds: 0, liquid: false,
      });
      break;
    case 'crystal':
      Object.assign(base, {
        deep: hex('#2a1a5a'), shallow: hex('#5a3aa0'), shore: hex('#7a5ac0'), low: hex('#4a3a6a'), mid: hex('#3a2a58'), high: hex('#6a5a9a'),
        peak: hex('#d0c0ff'), alt: hex('#40c0c0'), seaLevel: -0.25, iceLat: 2, atmo: hex('#b080ff'), atmoStrength: 0.6, clouds: 0.1, lava: hex('#c0a0ff'),
      });
      break;
    case 'gas': {
      const h = rng.range(15, 50);
      const pick = () => shiftHue(hsl(h + rng.range(-20, 20), rng.range(0.3, 0.6), rng.range(0.35, 0.75)) as RGB, rng.pick([0, 0, 0, 150, 200]));
      Object.assign(base, { deep: pick(), shallow: pick(), shore: pick(), low: pick(), mid: pick(), high: pick(), atmo: pick(), atmoStrength: 0.5, clouds: 0, seaLevel: -2 });
      break;
    }
    case 'icegiant': {
      const h = rng.range(180, 220);
      const pick = () => hsl(h + rng.range(-15, 15), rng.range(0.3, 0.6), rng.range(0.45, 0.75)) as RGB;
      Object.assign(base, { deep: pick(), shallow: pick(), shore: pick(), low: pick(), mid: pick(), high: pick(), atmo: hex('#80d0ff'), atmoStrength: 0.6, clouds: 0, seaLevel: -2 });
      break;
    }
  }
  if (type !== 'gas' && type !== 'icegiant' && type !== 'barren') {
    for (const k of ['low', 'mid', 'high', 'alt'] as const) base[k] = shiftHue(base[k], hs * 0.6);
  }
  return base;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/**
 * Shared biome colour function.
 * h: height (-1..1), m: moisture (-1..1), lat: 0 (equator)..1 (pole), detail: small noise.
 */
export function surfaceColor(type: PlanetType, pal: Palette, h: number, m: number, lat: number, detail: number, out: RGB): { water: boolean; ice: boolean; lava: boolean } {
  const sea = pal.seaLevel;
  let water = false, ice = false, lava = false;
  if (h < sea) {
    const t = clamp((sea - h) / 0.5, 0, 1);
    const c = mix(pal.shallow, pal.deep, t);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    water = pal.liquid;
    lava = type === 'lava';
  } else {
    const t = (h - sea) / (1 - sea);
    let c: RGB;
    if (t < 0.03 && pal.liquid && type !== 'lava') c = pal.shore;
    else if (t < 0.35) c = mix(pal.low, pal.alt, clamp(m * 0.8 + 0.5 + detail * 0.3, 0, 1));
    else if (t < 0.6) c = mix(pal.mid, pal.alt, clamp(m * 0.5 + 0.3 + detail * 0.3, 0, 1) * 0.6);
    else if (t < 0.82) c = mix(pal.mid, pal.high, (t - 0.6) / 0.22);
    else c = mix(pal.high, pal.peak, clamp((t - 0.82) / 0.18, 0, 1));
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  }
  const iceEdge = pal.iceLat - (h > sea ? (h - sea) * 0.25 : 0) + detail * 0.06;
  if (lat > iceEdge) {
    const t = clamp((lat - iceEdge) / 0.06, 0, 1);
    out[0] = lerp(out[0], pal.ice[0], t); out[1] = lerp(out[1], pal.ice[1], t); out[2] = lerp(out[2], pal.ice[2], t);
    if (t > 0.5) { ice = true; water = false; }
  }
  return { water, ice, lava };
}

export interface PlanetTexture {
  w: number;
  h: number;
  color: Uint8ClampedArray; // RGBA, relief-shaded
  emissive: Uint8ClampedArray | null; // RGBA glow (lava / cities / crystals)
  clouds: Uint8ClampedArray | null; // RGBA, alpha = coverage
  pal: Palette;
}

interface Crater { x: number; y: number; z: number; r: number; depth: number }

/** Planet height at a unit-sphere point; shared by texture + terrain generators. */
export class PlanetField {
  noise: Noise;
  noise2: Noise;
  craters: Crater[] = [];
  type: PlanetType;
  pal: Palette;
  freq: number;
  mountain: number;

  constructor(body: { seed: number; type: PlanetType }) {
    this.type = body.type;
    this.noise = new Noise(body.seed);
    this.noise2 = new Noise(hash(body.seed, 99));
    this.pal = makePalette(body.type, body.seed);
    const rng = new RNG(hash(body.seed, 0xc4a7));
    this.freq = rng.range(1.2, 2.2);
    this.mountain = rng.range(0.2, 0.55);
    const craterCount = body.type === 'barren' ? rng.int(40, 80) : body.type === 'ice' || body.type === 'desert' || body.type === 'arid' ? rng.int(5, 20) : body.type === 'lava' ? rng.int(4, 10) : 0;
    for (let i = 0; i < craterCount; i++) {
      const u = rng.range(-1, 1), a = rng.range(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
      this.craters.push({ x: s * Math.cos(a), y: u, z: s * Math.sin(a), r: Math.pow(rng.next(), 2.5) * 0.35 + 0.02, depth: rng.range(0.1, 0.35) });
    }
  }

  height(x: number, y: number, z: number): number {
    const n = this.noise;
    const f = this.freq;
    // domain warp for swirly continents (like the reference Mars-like world)
    const wx = n.noise3(x * 1.3 + 11, y * 1.3, z * 1.3) * 0.35;
    const wy = n.noise3(x * 1.3, y * 1.3 + 23, z * 1.3) * 0.35;
    const wz = n.noise3(x * 1.3, y * 1.3, z * 1.3 + 37) * 0.35;
    let h = n.fbm3((x + wx) * f, (y + wy) * f, (z + wz) * f, 6);
    const r = this.noise2.ridged3(x * f * 1.6, y * f * 1.6, z * f * 1.6, 5);
    h = h * 1.25 + (r - 0.35) * this.mountain * (h > -0.1 ? 1 : 0.3);
    for (const c of this.craters) {
      const d2 = (x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2;
      const r2 = c.r * c.r;
      if (d2 < r2 * 1.7) {
        const d = Math.sqrt(d2) / c.r;
        if (d < 1) h -= c.depth * (1 - d * d);
        else h += c.depth * 0.35 * Math.max(0, 1 - (d - 1) / 0.3) * (d < 1.3 ? 1 : 0);
      }
    }
    return clamp(h, -1, 1);
  }

  moisture(x: number, y: number, z: number): number {
    return this.noise2.fbm3(x * 2 + 5, y * 2, z * 2, 4);
  }
}

function gasGiantColor(field: PlanetField, x: number, y: number, z: number, lat: number, out: RGB): void {
  const n = field.noise;
  const pal = field.pal;
  const warp = n.fbm3(x * 2.2, y * 2.2, z * 2.2, 5) * 0.55 + n.noise3(x * 6, y * 6, z * 6) * 0.08;
  const band = Math.sin((y + warp * 0.35) * (field.freq * 9 + 6));
  const band2 = Math.sin((y + warp * 0.2) * 23 + 1.3);
  const t = band * 0.5 + 0.5;
  const cols = [pal.deep, pal.shallow, pal.shore, pal.low, pal.mid, pal.high];
  const idx = t * (cols.length - 1);
  const i0 = Math.floor(idx), i1 = Math.min(cols.length - 1, i0 + 1);
  const c = mix(cols[i0], cols[i1], idx - i0);
  const k = 1 + band2 * 0.06;
  out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
  void lat;
}

export function generatePlanetTexture(body: Body, w: number, inhabited = 0): PlanetTexture {
  const h = w >> 1;
  const field = new PlanetField(body);
  const pal = field.pal;
  const type = body.type;
  const giant = type === 'gas' || type === 'icegiant';
  const color = new Uint8ClampedArray(w * h * 4);
  const heights = new Float32Array(w * h);
  const flags = new Uint8Array(w * h); // 1 water, 2 ice, 4 lava
  const emissiveNeeded = type === 'lava' || type === 'crystal' || inhabited > 0;
  const emissive = emissiveNeeded ? new Uint8ClampedArray(w * h * 4) : null;
  const rgb: RGB = [0, 0, 0];
  const detailNoise = field.noise2;

  for (let j = 0; j < h; j++) {
    const lat = (j + 0.5) / h * Math.PI - Math.PI / 2;
    const cy = Math.sin(lat), cr = Math.cos(lat);
    const alat = Math.abs(lat) / (Math.PI / 2);
    for (let i = 0; i < w; i++) {
      const lon = (i + 0.5) / w * Math.PI * 2;
      const x = cr * Math.cos(lon), z = cr * Math.sin(lon), y = cy;
      const idx = j * w + i;
      if (giant) {
        gasGiantColor(field, x, y, z, alat, rgb);
        heights[idx] = 0;
      } else {
        const hv = field.height(x, y, z);
        heights[idx] = hv;
        const m = field.moisture(x, y, z);
        const d = detailNoise.noise3(x * 18, y * 18, z * 18);
        const f = surfaceColor(type, pal, hv, m, alat, d, rgb);
        flags[idx] = (f.water ? 1 : 0) | (f.ice ? 2 : 0) | (f.lava ? 4 : 0);
      }
      const o = idx * 4;
      color[o] = rgb[0]; color[o + 1] = rgb[1]; color[o + 2] = rgb[2]; color[o + 3] = 255;
    }
  }

  if (!giant) {
    // Rivers: trace steepest descent from highland springs.
    if (pal.liquid && type !== 'lava' && type !== 'toxic' && (type === 'terran' || type === 'arid' || type === 'jungle' || type === 'tundra' || type === 'desert')) {
      const rng = new RNG(hash(body.seed, 0x51a7));
      const riverCount = type === 'desert' ? 3 : type === 'arid' ? rng.int(4, 8) : rng.int(8, 16);
      for (let r = 0; r < riverCount; r++) {
        let ci = rng.int(0, w - 1), cj = rng.int(Math.floor(h * 0.15), Math.floor(h * 0.85));
        if (heights[cj * w + ci] < pal.seaLevel + 0.15) continue;
        for (let step = 0; step < w; step++) {
          const idx = cj * w + ci;
          if (flags[idx] & 1) break;
          const o = idx * 4;
          color[o] = lerp(color[o], pal.shallow[0], 0.85);
          color[o + 1] = lerp(color[o + 1], pal.shallow[1], 0.85);
          color[o + 2] = lerp(color[o + 2], pal.shallow[2], 0.85);
          flags[idx] |= 8;
          let best = heights[idx], bi = ci, bj = cj;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              if (!di && !dj) continue;
              const ni = (ci + di + w) % w, nj = clamp(cj + dj, 0, h - 1);
              const hv = heights[nj * w + ni] + rng.next() * 0.004;
              if (hv < best) { best = hv; bi = ni; bj = nj; }
            }
          if (bi === ci && bj === cj) {
            // Local minimum: form a small lake.
            for (let dj = -1; dj <= 1; dj++)
              for (let di = -1; di <= 1; di++) {
                const ni = (ci + di + w) % w, nj = clamp(cj + dj, 0, h - 1);
                const oo = (nj * w + ni) * 4;
                color[oo] = pal.deep[0] * 0.6 + pal.shallow[0] * 0.4;
                color[oo + 1] = pal.deep[1] * 0.6 + pal.shallow[1] * 0.4;
                color[oo + 2] = pal.deep[2] * 0.6 + pal.shallow[2] * 0.4;
                flags[nj * w + ni] |= 1;
              }
            break;
          }
          ci = bi; cj = bj;
        }
      }
    }
    // Relief shading (hillshade) baked into the colour map.
    const relief = type === 'barren' || type === 'ice' ? 1.7 : 1.3;
    const shadeArr = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      const jm = Math.max(0, j - 1), jp = Math.min(h - 1, j + 1);
      for (let i = 0; i < w; i++) {
        const idx = j * w + i;
        if (flags[idx] & 1 && !(flags[idx] & 8)) { shadeArr[idx] = 1; continue; }
        const im = (i - 1 + w) % w, ip = (i + 1) % w;
        const dx = heights[j * w + ip] - heights[j * w + im];
        const dy = heights[jp * w + i] - heights[jm * w + i];
        shadeArr[idx] = clamp(1 - (dx + dy) * relief * (w / 256), 0.68, 1.28);
      }
    }
    for (let idx = 0; idx < w * h; idx++) {
      const s = shadeArr[idx];
      const o = idx * 4;
      color[o] *= s; color[o + 1] *= s; color[o + 2] *= s;
      if (emissive) {
        if (flags[idx] & 4) {
          const glow = clamp((pal.seaLevel - heights[idx]) * 4 + 0.5, 0.3, 1);
          emissive[o] = 255 * glow; emissive[o + 1] = 110 * glow; emissive[o + 2] = 30 * glow; emissive[o + 3] = 255 * glow;
        }
      }
    }
    if (emissive && type === 'crystal') {
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const lat = (j + 0.5) / h * Math.PI - Math.PI / 2;
          const lon = (i + 0.5) / w * Math.PI * 2;
          const x = Math.cos(lat) * Math.cos(lon), z = Math.cos(lat) * Math.sin(lon), y = Math.sin(lat);
          const v = field.noise2.ridged3(x * 4, y * 4, z * 4, 3);
          if (v > 0.42) {
            const o = (j * w + i) * 4;
            const g = clamp((v - 0.42) * 6, 0, 1);
            emissive[o] = 160 * g; emissive[o + 1] = 230 * g; emissive[o + 2] = 255 * g; emissive[o + 3] = 255 * g;
          }
        }
    }
    if (emissive && inhabited > 0) {
      const rng = new RNG(hash(body.seed, 0xc17));
      const cn = new Noise(hash(body.seed, 0xc18));
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const idx = j * w + i;
          if (flags[idx] & 3) continue;
          const lat = (j + 0.5) / h * Math.PI - Math.PI / 2;
          const lon = (i + 0.5) / w * Math.PI * 2;
          const x = Math.cos(lat) * Math.cos(lon), z = Math.cos(lat) * Math.sin(lon), y = Math.sin(lat);
          const v = cn.fbm3(x * 5, y * 5, z * 5, 3) + inhabited * 0.25 - 0.35;
          if (v > 0 && rng.next() < v * 1.6) {
            const o = idx * 4;
            const g = clamp(v * 2.5, 0.25, 1);
            emissive[o] = 255 * g; emissive[o + 1] = 210 * g; emissive[o + 2] = 130 * g; emissive[o + 3] = 255 * g;
          }
        }
    }
  }

  let clouds: Uint8ClampedArray | null = null;
  if (pal.clouds > 0.02) {
    clouds = new Uint8ClampedArray(w * h * 4);
    const cn = new Noise(hash(body.seed, 0xc10d));
    const cov = pal.clouds;
    for (let j = 0; j < h; j++) {
      const lat = (j + 0.5) / h * Math.PI - Math.PI / 2;
      for (let i = 0; i < w; i++) {
        const lon = (i + 0.5) / w * Math.PI * 2;
        const x = Math.cos(lat) * Math.cos(lon), z = Math.cos(lat) * Math.sin(lon), y = Math.sin(lat);
        const wx = cn.noise3(x * 2, y * 2 + 3, z * 2) * 0.5;
        const v = cn.fbm3(x * 2.5 + wx, y * 5, z * 2.5 - wx, 5);
        const a = clamp((v + cov - 0.5) * 2.2, 0, 1);
        const o = (j * w + i) * 4;
        clouds[o] = pal.cloudColor[0]; clouds[o + 1] = pal.cloudColor[1]; clouds[o + 2] = pal.cloudColor[2]; clouds[o + 3] = a * 235;
      }
    }
  }

  return { w, h, color, emissive, clouds, pal };
}
