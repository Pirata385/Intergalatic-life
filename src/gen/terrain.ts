// Planetary surface terrain for landings and colonies. Large-scale features come
// from the same PlanetField used for the orbital texture so the ground matches
// what the player saw from orbit; local detail is layered on top.
import { Noise } from '../core/noise';
import { RNG, hash } from '../core/rng';
import { clamp } from '../core/math';
import { PlanetField, surfaceColor } from './planet';
import type { Body } from './system';
import type { TileType } from '../data/buildings';

export const CHUNK = 48;
export const REGION_TILES = 900; // exploration region is REGION_TILES x REGION_TILES
const ANGLE_PER_TILE = 0.00055;

export type SurfaceKind = 'water' | 'deepwater' | 'lava' | 'ice' | 'sand' | 'rock' | 'grass' | 'forest' | 'mountain' | 'crystal' | 'toxic';

export interface SurfaceEntity {
  id: string;
  kind: 'ore' | 'crystal' | 'ice' | 'organics' | 'ruin' | 'wreck' | 'creature' | 'sentinel' | 'artifact' | 'cache';
  x: number; // tile coords (float)
  y: number;
  amount: number;
  hp: number;
  data?: any;
}

export interface ChunkData {
  cx: number;
  cy: number;
  heights: Float32Array; // (CHUNK+2)^2 with 1 tile margin
  kinds: Uint8Array; // CHUNK^2
  rgb: Uint8ClampedArray; // CHUNK^2 * 3 base colours
  entities: SurfaceEntity[];
  canvas?: HTMLCanvasElement;
}

export const KIND_LIST: SurfaceKind[] = ['water', 'deepwater', 'lava', 'ice', 'sand', 'rock', 'grass', 'forest', 'mountain', 'crystal', 'toxic'];
const KIND_INDEX: Record<SurfaceKind, number> = Object.fromEntries(KIND_LIST.map((k, i) => [k, i])) as Record<SurfaceKind, number>;

export function kindPassable(k: SurfaceKind): boolean {
  return k !== 'deepwater' && k !== 'mountain';
}

export function kindSpeed(k: SurfaceKind): number {
  switch (k) {
    case 'water': return 0.45;
    case 'forest': return 0.65;
    case 'sand': return 0.85;
    case 'ice': return 1.1;
    case 'lava': return 0.5;
    case 'toxic': return 0.7;
    default: return 1;
  }
}

export class SurfaceGen {
  body: Body;
  field: PlanetField;
  local: Noise;
  site: [number, number, number];
  e1: [number, number, number];
  e2: [number, number, number];
  seed: number;

  constructor(body: Body, lat: number, lon: number) {
    this.body = body;
    this.field = new PlanetField(body);
    this.seed = hash(body.seed, Math.round(lat * 1000), Math.round(lon * 1000));
    this.local = new Noise(this.seed);
    const cy = Math.sin(lat), cr = Math.cos(lat);
    this.site = [cr * Math.cos(lon), cy, cr * Math.sin(lon)];
    // Tangent basis
    this.e1 = [-Math.sin(lon), 0, Math.cos(lon)];
    this.e2 = [-cy * Math.cos(lon), cr, -cy * Math.sin(lon)];
  }

  private spherePoint(u: number, v: number): [number, number, number, number] {
    const a = u * ANGLE_PER_TILE, b = v * ANGLE_PER_TILE;
    const x = this.site[0] + this.e1[0] * a - this.e2[0] * b;
    const y = this.site[1] + this.e1[1] * a - this.e2[1] * b;
    const z = this.site[2] + this.e1[2] * a - this.e2[2] * b;
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l, Math.abs(Math.asin(y / l)) / (Math.PI / 2)];
  }

  /** Coarse planetary height + moisture at a tile coordinate. */
  macro(u: number, v: number): [number, number, number] {
    const [x, y, z, lat] = this.spherePoint(u, v);
    return [this.field.height(x, y, z), this.field.moisture(x, y, z), lat];
  }

  generateChunk(cx: number, cy: number): ChunkData {
    const S = CHUNK;
    const M = S + 2;
    const heights = new Float32Array(M * M);
    const moist = new Float32Array(M * M);
    const lats = new Float32Array(M * M);
    // Sample macro field on a coarse lattice and interpolate.
    const step = 8;
    const L = Math.ceil(M / step) + 1;
    const mh = new Float32Array(L * L), mm = new Float32Array(L * L), ml = new Float32Array(L * L);
    const u0 = cx * S - 1, v0 = cy * S - 1;
    for (let j = 0; j < L; j++)
      for (let i = 0; i < L; i++) {
        const [h, m, lat] = this.macro(u0 + i * step, v0 + j * step);
        mh[j * L + i] = h; mm[j * L + i] = m; ml[j * L + i] = lat;
      }
    const n = this.local;
    const rough = this.body.type === 'barren' || this.body.type === 'lava' ? 0.28 : 0.2;
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++) {
        const fx = i / step, fy = j / step;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const bil = (arr: Float32Array) =>
          (arr[iy * L + ix] * (1 - tx) + arr[iy * L + ix + 1] * tx) * (1 - ty) +
          (arr[(iy + 1) * L + ix] * (1 - tx) + arr[(iy + 1) * L + ix + 1] * tx) * ty;
        const u = u0 + i, v = v0 + j;
        const detail = n.fbm2(u * 0.035, v * 0.035, 4) * rough + n.ridged2(u * 0.012, v * 0.012, 3) * rough * 0.9 - rough * 0.2;
        heights[j * M + i] = clamp(bil(mh) * 0.85 + detail, -1, 1);
        moist[j * M + i] = bil(mm) + n.noise2(u * 0.05 + 100, v * 0.05) * 0.3;
        lats[j * M + i] = bil(ml);
      }

    const kinds = new Uint8Array(S * S);
    const rgb = new Uint8ClampedArray(S * S * 3);
    const col: [number, number, number] = [0, 0, 0];
    const pal = this.field.pal;
    const type = this.body.type;
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const hi = (j + 1) * M + (i + 1);
        const h = heights[hi];
        const m = moist[hi];
        const lat = lats[hi];
        const d = n.noise2((cx * S + i) * 0.3, (cy * S + j) * 0.3);
        const f = surfaceColor(type, pal, h, m, lat, d * 0.4, col);
        const slope = Math.abs(heights[hi + 1] - heights[hi - 1]) + Math.abs(heights[hi + M] - heights[hi - M]);
        let kind: SurfaceKind;
        if (f.lava) kind = h < pal.seaLevel - 0.08 ? 'lava' : 'lava';
        else if (f.water) kind = h < pal.seaLevel - 0.06 ? 'deepwater' : 'water';
        else if (f.ice) kind = 'ice';
        else if (slope > 0.11) kind = 'mountain';
        else if (type === 'crystal' && n.ridged2((cx * S + i) * 0.05, (cy * S + j) * 0.05, 3) > 0.45) kind = 'crystal';
        else if (type === 'toxic' && h < pal.seaLevel + 0.03) kind = 'toxic';
        else if ((type === 'terran' || type === 'jungle') && m > (type === 'jungle' ? -0.2 : 0.05) && h < 0.55) kind = 'forest';
        else if ((type === 'terran' || type === 'jungle' || type === 'ocean' || type === 'tundra') && h < 0.6) kind = 'grass';
        else if (type === 'desert' || (type === 'arid' && m < -0.1)) kind = 'sand';
        else if (type === 'ice') kind = 'ice';
        else kind = 'rock';
        if (kind === 'mountain' && slope < 0.16 && (type === 'desert' || type === 'arid')) kind = 'rock';
        kinds[j * S + i] = KIND_INDEX[kind];
        const o = (j * S + i) * 3;
        rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
      }

    const entities = this.spawnEntities(cx, cy, kinds);
    return { cx, cy, heights, kinds, rgb, entities };
  }

  private spawnEntities(cx: number, cy: number, kinds: Uint8Array): SurfaceEntity[] {
    const rng = new RNG(hash(this.seed, cx, cy, 0xe7));
    const out: SurfaceEntity[] = [];
    const S = CHUNK;
    const res = this.body.resources;
    const place = (kind: SurfaceEntity['kind'], amount: number, hp = 1, data?: any) => {
      for (let t = 0; t < 8; t++) {
        const x = rng.range(1, S - 1), y = rng.range(1, S - 1);
        const k = KIND_LIST[kinds[Math.floor(y) * S + Math.floor(x)]];
        if (!kindPassable(k) || k === 'lava') continue;
        out.push({ id: `${cx}_${cy}_${out.length}`, kind, x: cx * S + x, y: cy * S + y, amount, hp, data });
        return;
      }
    };
    const n = (v: number) => Math.floor(v) + (rng.next() < v - Math.floor(v) ? 1 : 0);
    for (let i = 0; i < n(res.ore * 3.5 + 0.4); i++) place('ore', rng.int(8, 30));
    for (let i = 0; i < n(res.crystals * 1.8); i++) place('crystal', rng.int(3, 10));
    for (let i = 0; i < n(res.ice * 2.2); i++) place('ice', rng.int(8, 24));
    for (let i = 0; i < n(res.organics * 2); i++) place('organics', rng.int(5, 15));
    if (this.body.ruins && rng.chance(0.3)) {
      place('ruin', 1);
      if (rng.chance(0.6)) place('sentinel', 1, 60, { cd: 0 });
      if (rng.chance(0.5)) place('artifact', rng.int(1, 3));
    }
    if (rng.chance(0.06)) place('wreck', 1);
    if (rng.chance(0.08)) place('cache', 1);
    if (this.body.biosphere > 0.1) {
      const cnt = n(this.body.biosphere * 2.2);
      for (let i = 0; i < cnt; i++) {
        const predator = rng.chance(0.3);
        place('creature', 1, predator ? 45 : 25, { predator, hue: rng.range(0, 360), size: rng.range(0.6, 1.4), dir: rng.range(0, 6.28), cd: 0 });
      }
    }
    return out;
  }
}

/** Generates a colony tile map around a landing site. */
export function generateColonyMap(body: Body, lat: number, lon: number, size: number): { tiles: TileType[]; heights: number[] } {
  const gen = new SurfaceGen(body, lat, lon);
  const rng = new RNG(hash(body.seed, 0xc01, Math.round(lat * 100), Math.round(lon * 100)));
  const tiles: TileType[] = [];
  const heights: number[] = [];
  const n = gen.local;
  const pal = gen.field.pal;
  const type = body.type;
  const scale = 6; // each colony tile spans several surface tiles
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const u = (i - size / 2) * scale, v = (j - size / 2) * scale;
      const [hMacro, m, latv] = gen.macro(u, v);
      const h = clamp(hMacro * 0.7 + n.fbm2(u * 0.02, v * 0.02, 3) * 0.3, -1, 1);
      heights.push(h);
      const col: [number, number, number] = [0, 0, 0];
      const f = surfaceColor(type, pal, h, m, latv, 0, col);
      let t: TileType;
      if (f.lava) t = 'lava';
      else if (f.water) t = 'water';
      else if (f.ice) t = 'ice';
      else if (h > 0.62) t = 'mountain';
      else if ((type === 'terran' || type === 'jungle' || type === 'ocean') && m > -0.1) t = 'fertile';
      else if (type === 'ice' || type === 'tundra') t = rng.chance(0.4) ? 'ice' : 'plain';
      else t = rng.chance(0.3) ? 'rock' : 'plain';
      tiles.push(t);
    }
  // The centre must always be buildable (landing zone).
  const c = Math.floor(size / 2) * size + Math.floor(size / 2);
  for (const d of [0, 1, -1, size, -size, size + 1, size - 1, -size + 1, -size - 1]) {
    if (tiles[c + d] === 'water' || tiles[c + d] === 'lava' || tiles[c + d] === 'mountain') tiles[c + d] = 'plain';
  }
  // Resource deposits
  const deposit = (t: TileType, count: number) => {
    for (let k = 0; k < count; k++) {
      for (let tries = 0; tries < 30; tries++) {
        const idx = rng.int(0, tiles.length - 1);
        if (idx === c) continue;
        if (tiles[idx] === 'plain' || tiles[idx] === 'rock' || tiles[idx] === 'fertile') {
          tiles[idx] = t;
          break;
        }
      }
    }
  };
  const r = body.resources;
  deposit('ore', 2 + Math.round(r.ore * 8));
  deposit('crystal', Math.round(r.crystals * 4) + (rng.chance(0.4) ? 1 : 0));
  deposit('ice', Math.round(r.ice * 5));
  deposit('vent', type === 'lava' ? 5 : 1 + rng.int(0, 2));
  return { tiles, heights };
}

/** Picks a lat/lon on dry land with plenty of buildable ground around it. */
export function findLandSite(body: Body): { lat: number; lon: number } {
  const field = new PlanetField(body);
  const sea = field.pal.seaLevel;
  const rng = new RNG(hash(body.seed, 0x51e));
  let best = { lat: 0.2, lon: 1.3 }, bestScore = -1e9;
  for (let k = 0; k < 90; k++) {
    const lat = rng.range(-0.9, 0.9), lon = rng.range(0, Math.PI * 2);
    let score = 0;
    for (let s = 0; s < 9; s++) {
      const dlat = lat + ((s % 3) - 1) * 0.03, dlon = lon + (Math.floor(s / 3) - 1) * 0.03;
      const x = Math.cos(dlat) * Math.cos(dlon), y = Math.sin(dlat), z = Math.cos(dlat) * Math.sin(dlon);
      const hgt = field.height(x, y, z);
      if (hgt > sea + 0.02 && hgt < 0.6) score += 1;
      else if (hgt >= 0.6) score += 0.3;
    }
    score -= Math.abs(lat) * 2; // avoid polar ice
    if (score > bestScore) {
      bestScore = score;
      best = { lat, lon };
    }
  }
  return best;
}
