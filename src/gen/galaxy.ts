// Galaxy generation: spiral arms, nebulae, star placement and jump graph.
import { RNG, hash } from '../core/rng';
import { starName, catalogName } from '../core/names';
import { SystemData, generateSystem } from './system';
import type { StarClass } from './stars';

export interface Nebula {
  x: number;
  y: number;
  r: number;
  color: [number, number, number];
  name: string;
}

export interface Galaxy {
  seed: number;
  radius: number;
  systems: SystemData[];
  nebulae: Nebula[];
  grid: Map<string, number[]>;
  gridSize: number;
}

export const GALAXY_RADIUS = 300;
export const MAX_LINK = 38;

const NEBULA_COLORS: [number, number, number][] = [
  [150, 60, 200], [90, 60, 220], [200, 60, 120], [60, 130, 200], [60, 180, 150], [200, 100, 60],
];

export function generateGalaxy(seed: number, starCount = 1300): Galaxy {
  const rng = new RNG(hash(seed, 0x9a1));
  const arms = rng.int(3, 5);
  const twist = rng.range(2.2, 3.4);
  const armOffset = rng.range(0, Math.PI * 2);
  const R = GALAXY_RADIUS;
  const minSep = 5.2;
  const gridSize = 20;
  const grid = new Map<string, number[]>();
  const pts: { x: number; y: number }[] = [];

  const key = (gx: number, gy: number) => gx + ',' + gy;
  const tooClose = (x: number, y: number) => {
    const gx = Math.floor(x / gridSize), gy = Math.floor(y / gridSize);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(key(gx + dx, gy + dy));
        if (!cell) continue;
        for (const i of cell) {
          const p = pts[i];
          if ((p.x - x) ** 2 + (p.y - y) ** 2 < minSep * minSep) return true;
        }
      }
    return false;
  };
  const add = (x: number, y: number) => {
    const i = pts.length;
    pts.push({ x, y });
    const k = key(Math.floor(x / gridSize), Math.floor(y / gridSize));
    let cell = grid.get(k);
    if (!cell) grid.set(k, (cell = []));
    cell.push(i);
  };

  // Galactic core black hole first so it is always system 0.
  add(0, 0);
  let attempts = 0;
  while (pts.length < starCount && attempts < starCount * 40) {
    attempts++;
    let x: number, y: number;
    const mode = rng.next();
    if (mode < 0.62) {
      // spiral arm star
      const arm = rng.int(0, arms - 1);
      const r = 30 + Math.pow(rng.next(), 0.8) * (R - 30);
      const theta = armOffset + (arm / arms) * Math.PI * 2 + Math.log(r / 30) * twist * 0.5;
      const spread = 8 + r * 0.14;
      x = Math.cos(theta) * r + rng.normal(0, spread);
      y = Math.sin(theta) * r + rng.normal(0, spread);
    } else if (mode < 0.8) {
      // bulge
      const r = Math.abs(rng.normal(0, 55)) + 14;
      const a = rng.range(0, Math.PI * 2);
      x = Math.cos(a) * r;
      y = Math.sin(a) * r * 0.8;
    } else {
      // disc field stars
      const r = Math.sqrt(rng.next()) * R;
      const a = rng.range(0, Math.PI * 2);
      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
    }
    if (x * x + y * y > R * R * 1.05) continue;
    if (x * x + y * y < 12 * 12) continue;
    if (tooClose(x, y)) continue;
    add(x, y);
  }

  const nebulae: Nebula[] = [];
  const nebCount = rng.int(9, 14);
  for (let i = 0; i < nebCount; i++) {
    const r = rng.range(60, R * 0.95);
    const a = rng.range(0, Math.PI * 2);
    nebulae.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      r: rng.range(18, 45),
      color: rng.pick(NEBULA_COLORS),
      name: starName(rng) + ' Nebula',
    });
  }

  const usedNames = new Set<string>();
  const systems: SystemData[] = pts.map((p, i) => {
    const srng = new RNG(hash(seed, i, 0x77));
    let nebula = -1;
    for (let n = 0; n < nebulae.length; n++) {
      const nb = nebulae[n];
      if ((p.x - nb.x) ** 2 + (p.y - nb.y) ** 2 < nb.r * nb.r) nebula = n;
    }
    let forced: StarClass | undefined = i === 0 ? 'BH' : undefined;
    // Nebulae are stellar nurseries: more young hot stars.
    if (!forced && nebula >= 0 && srng.chance(0.3)) forced = srng.pick(['O', 'B', 'A'] as StarClass[]);
    const tmp = new RNG(hash(seed, i, 0x78));
    let name = i === 0 ? 'Core Abyss' : starName(srng);
    while (usedNames.has(name)) name = starName(srng);
    usedNames.add(name);
    const sys = generateSystem(i, name, p.x, p.y, seed, nebula, forced);
    const cls = sys.stars[0].cls;
    if (i !== 0 && (cls === 'BH' || cls === 'NS' || (cls === 'WD' && tmp.chance(0.5)))) {
      sys.name = catalogName(tmp, cls === 'BH' ? 'VX' : cls === 'NS' ? 'PSR' : undefined);
      sys.catalog = true;
    }
    if (i === 0) sys.special = 'core';
    return sys;
  });

  // Jump graph: neighbours within MAX_LINK light years.
  for (const s of systems) {
    const gx = Math.floor(s.x / gridSize), gy = Math.floor(s.y / gridSize);
    const reach = Math.ceil(MAX_LINK / gridSize);
    for (let dx = -reach; dx <= reach; dx++)
      for (let dy = -reach; dy <= reach; dy++) {
        const cell = grid.get(key(gx + dx, gy + dy));
        if (!cell) continue;
        for (const j of cell) {
          if (j === s.id) continue;
          const o = systems[j];
          if ((o.x - s.x) ** 2 + (o.y - s.y) ** 2 <= MAX_LINK * MAX_LINK) s.neighbors.push(j);
        }
      }
    s.neighbors.sort((a, b) => sysDist(s, systems[a]) - sysDist(s, systems[b]));
  }

  return { seed, radius: R, systems, nebulae, grid, gridSize };
}

export function sysDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A* route across the jump graph limited by a maximum hop length. */
export function findRoute(g: Galaxy, from: number, to: number, maxJump: number, avoid?: (id: number) => number): number[] | null {
  if (from === to) return [from];
  const systems = g.systems;
  const goal = systems[to];
  const open: number[] = [from];
  const came = new Map<number, number>();
  const gScore = new Map<number, number>([[from, 0]]);
  const fScore = new Map<number, number>([[from, sysDist(systems[from], goal)]]);
  const closed = new Set<number>();
  let iter = 0;
  while (open.length && iter++ < 6000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if ((fScore.get(open[i]) ?? 1e9) < (fScore.get(open[bi]) ?? 1e9)) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === to) {
      const path = [cur];
      let c = cur;
      while (came.has(c)) {
        c = came.get(c)!;
        path.unshift(c);
      }
      return path;
    }
    closed.add(cur);
    const cs = systems[cur];
    for (const n of cs.neighbors) {
      const d = sysDist(cs, systems[n]);
      if (d > maxJump) break; // neighbours sorted by distance
      if (closed.has(n)) continue;
      const tentative = (gScore.get(cur) ?? 0) + d + 2 + (avoid ? avoid(n) : 0);
      if (tentative < (gScore.get(n) ?? Infinity)) {
        came.set(n, cur);
        gScore.set(n, tentative);
        fScore.set(n, tentative + sysDist(systems[n], goal));
        if (!open.includes(n)) open.push(n);
      }
    }
  }
  return null;
}

export function systemsNear(g: Galaxy, x: number, y: number, radius: number): number[] {
  const out: number[] = [];
  const gs = g.gridSize;
  const gx = Math.floor(x / gs), gy = Math.floor(y / gs);
  const reach = Math.ceil(radius / gs);
  for (let dx = -reach; dx <= reach; dx++)
    for (let dy = -reach; dy <= reach; dy++) {
      const cell = g.grid.get(gx + dx + ',' + (gy + dy));
      if (!cell) continue;
      for (const i of cell) {
        const s = g.systems[i];
        if ((s.x - x) ** 2 + (s.y - y) ** 2 <= radius * radius) out.push(i);
      }
    }
  return out;
}
