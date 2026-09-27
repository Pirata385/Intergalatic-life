// Voxel ship designs: grid placement, derived stats and validation.
import { MODULE_MAP, ModuleDef, AmmoType, Species, FRAME_MAP } from '../data/modules';

export interface PlacedModule {
  id: string;
  x: number;
  y: number;
  r: number; // rotation 0..3
  p?: number; // paint override: 0 primary, 1 secondary, 2 accent
}

export type ShipClass = 'fighter' | 'corvette' | 'frigate' | 'destroyer' | 'cruiser' | 'battleship' | 'freighter' | 'miner' | 'scout' | 'colony' | 'station' | 'custom';

export interface ShipDesign {
  key: string;
  name: string;
  frame: string;
  w: number;
  h: number;
  modules: PlacedModule[];
  colors: [string, string, string];
  species: Species;
  cls: ShipClass;
}

export const CELL = 4; // world units per grid cell

export function footprint(def: ModuleDef, r: number): [number, number] {
  return r % 2 === 0 ? [def.w, def.h] : [def.h, def.w];
}

/** Rotation after mirroring across the horizontal axis. */
export function mirrorRotation(def: ModuleDef, r: number): number {
  if (def.shape === 'slope') return [1, 0, 3, 2][r];
  return [0, 3, 2, 1][r];
}

export function buildGrid(d: { w: number; h: number; modules: PlacedModule[] }): Int16Array {
  const g = new Int16Array(d.w * d.h).fill(-1);
  d.modules.forEach((m, i) => {
    const def = MODULE_MAP[m.id];
    if (!def) return;
    const [fw, fh] = footprint(def, m.r);
    for (let y = m.y; y < m.y + fh; y++)
      for (let x = m.x; x < m.x + fw; x++) if (x >= 0 && y >= 0 && x < d.w && y < d.h) g[y * d.w + x] = i;
  });
  return g;
}

export function canPlace(d: ShipDesign, grid: Int16Array, def: ModuleDef, x: number, y: number, r: number): boolean {
  const [fw, fh] = footprint(def, r);
  if (x < 0 || y < 0 || x + fw > d.w || y + fh > d.h) return false;
  for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) if (grid[yy * d.w + xx] !== -1) return false;
  return true;
}

export interface WeaponMount {
  index: number; // module index
  def: ModuleDef;
  cx: number; // centre in cells
  cy: number;
  facing: number; // radians relative to ship
}

export interface ShipStats {
  mass: number;
  hp: number;
  armor: number;
  cost: number;
  powerGen: number;
  powerUse: number;
  enginePower: number;
  battery: number;
  thrust: number;
  reverse: number;
  lateral: number;
  turnSum: number;
  accel: number;
  maxSpeed: number;
  turnRate: number;
  shieldCap: number;
  shieldRegen: number;
  cargo: number;
  fuel: number;
  jump: number;
  sensor: number;
  crewReq: number;
  crewCap: number;
  crewEff: number;
  dps: number;
  range: number;
  ammoCap: Record<AmmoType, number>;
  repair: number;
  regen: number;
  tractor: number;
  mining: number;
  scan: number;
  cloak: boolean;
  colony: number;
  drones: number;
  leadership: number;
  weapons: WeaponMount[];
  blocks: number;
  errors: string[];
  warnings: string[];
  valid: boolean;
  cx: number; // centre of mass (cells)
  cy: number;
  radius: number; // bounding radius world units
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  strength: number;
}

export function computeStats(d: ShipDesign, alive?: boolean[]): ShipStats {
  const s: ShipStats = {
    mass: 0, hp: 0, armor: 0, cost: 0, powerGen: 0, powerUse: 0, enginePower: 0, battery: 60, thrust: 0, reverse: 0, lateral: 0, turnSum: 0,
    accel: 0, maxSpeed: 0, turnRate: 0, shieldCap: 0, shieldRegen: 0, cargo: 0, fuel: 20, jump: 0, sensor: 800, crewReq: 0, crewCap: 0, crewEff: 1,
    dps: 0, range: 0, ammoCap: { shells: 0, slugs: 0, missiles: 0, torpedoes: 0 }, repair: 0, regen: 0, tractor: 60, mining: 0, scan: 0, cloak: false,
    colony: 0, drones: 0, leadership: 0, weapons: [], blocks: 0, errors: [], warnings: [], valid: true, cx: d.w / 2, cy: d.h / 2, radius: 10,
    minX: d.w, maxX: 0, minY: d.h, maxY: 0, strength: 0,
  };
  let mx = 0, my = 0, armorSum = 0, magazines = 0;
  let commands = 0;
  let sensorMax = 0;
  let jumpMax = 0;
  d.modules.forEach((m, i) => {
    if (alive && !alive[i]) return;
    const def = MODULE_MAP[m.id];
    if (!def) return;
    const [fw, fh] = footprint(def, m.r);
    const cells = fw * fh;
    s.blocks += cells;
    s.mass += def.mass;
    s.hp += def.hp;
    s.cost += def.cost;
    armorSum += def.armor * cells;
    if (def.power > 0) s.powerGen += def.power;
    else if (def.cat === 'thruster') s.enginePower += -def.power;
    else s.powerUse += -def.power;
    s.battery += def.battery ?? 0;
    if (def.thrust) {
      if (m.r === 0) s.thrust += def.thrust;
      else if (m.r === 2) s.reverse += def.thrust;
      else s.lateral += def.thrust;
    }
    s.turnSum += def.turn ?? 0;
    s.shieldCap += def.shieldCap ?? 0;
    s.shieldRegen += def.shieldRegen ?? 0;
    s.cargo += def.cargo ?? 0;
    s.fuel += def.fuel ?? 0;
    jumpMax = Math.max(jumpMax, def.jump ?? 0);
    sensorMax = Math.max(sensorMax, def.sensor ?? 0);
    if (def.sensor && !def.command) s.sensor += def.sensor * 0.5;
    s.crewReq += def.crew;
    s.crewCap += def.crewCap ?? 0;
    s.repair += def.repair ?? 0;
    s.regen += (def.regen ?? 0);
    if (def.tractor) s.tractor = Math.max(s.tractor, def.tractor);
    s.mining += def.mining ?? 0;
    s.scan += def.scan ?? 0;
    if (def.cloak) s.cloak = true;
    s.colony += def.colony ?? 0;
    s.drones += def.drones ?? 0;
    s.leadership += def.leadership ?? 0;
    if (def.command) commands++;
    if (def.id === 'magazine') magazines++;
    if (def.ammoCap && def.weapon?.ammo) s.ammoCap[def.weapon.ammo] += def.ammoCap;
    if (def.weapon) {
      const w = def.weapon;
      const facing = w.arc >= Math.PI * 1.9 ? 0 : [0, Math.PI / 2, Math.PI, -Math.PI / 2][m.r];
      s.weapons.push({ index: i, def, cx: m.x + fw / 2, cy: m.y + fh / 2, facing });
      if (w.kind !== 'pd' && w.kind !== 'mining') {
        const per = w.kind === 'beam' ? w.damage : w.damage * w.rof * (w.count ?? 1);
        s.dps += w.kind === 'drone' ? 20 * (def.drones ?? 1) : per;
        s.range = Math.max(s.range, w.range);
      }
    }
    mx += (m.x + fw / 2) * def.mass;
    my += (m.y + fh / 2) * def.mass;
    s.minX = Math.min(s.minX, m.x);
    s.minY = Math.min(s.minY, m.y);
    s.maxX = Math.max(s.maxX, m.x + fw);
    s.maxY = Math.max(s.maxY, m.y + fh);
  });
  for (const k of Object.keys(s.ammoCap) as AmmoType[]) s.ammoCap[k] = Math.round(s.ammoCap[k] * (1 + magazines * 0.5));
  s.sensor += sensorMax;
  s.jump = jumpMax;
  if (s.mass > 0) {
    s.cx = mx / s.mass;
    s.cy = my / s.mass;
  }
  s.armor = s.blocks ? armorSum / s.blocks : 0;
  s.crewCap += 0;
  // NPC hulls are fully crewed by their faction; only custom (player) designs need quarters.
  s.crewEff = d.cls !== 'custom' ? 1 : s.crewReq > 0 ? Math.min(1, Math.max(0.35, s.crewCap / s.crewReq)) : 1;
  const tm = s.thrust / Math.max(1, s.mass);
  s.accel = 32 * tm;
  s.maxSpeed = Math.min(420, 70 + 55 * Math.sqrt(tm));
  s.turnRate = Math.max(0.35, Math.min(4.5, 0.3 + 2.4 * Math.sqrt((s.turnSum + s.lateral * 0.3) / Math.max(1, s.mass))));
  const halfW = (s.maxX - s.minX) / 2, halfH = (s.maxY - s.minY) / 2;
  s.radius = Math.hypot(halfW, halfH) * CELL + 4;
  s.strength = Math.round((s.dps * 1.4 + 5) * Math.sqrt(s.hp + s.shieldCap * 1.2 + s.armor * 80) / 10);

  if (commands === 0) s.errors.push('No command module (Cockpit, Bridge or Command Center).');
  if (s.thrust <= 0) s.errors.push('No rear-facing thrusters: the ship cannot move.');
  if (s.powerGen < s.powerUse) s.errors.push(`Power deficit: ${s.powerGen.toFixed(0)} generated vs ${s.powerUse.toFixed(0)} used.`);
  if (s.powerGen < s.powerUse + s.enginePower) s.warnings.push('Engines drain more power than spare generation.');
  if (s.jump <= 0) s.warnings.push('No jump drive: cannot travel between star systems.');
  if (s.crewEff < 1 && d.cls === 'custom') s.warnings.push(`Insufficient crew quarters (${s.crewCap}/${s.crewReq}). Efficiency ${(s.crewEff * 100).toFixed(0)}%.`);
  if (!alive && d.modules.length) {
    const disc = disconnected(d);
    if (disc.length) s.errors.push(`${disc.length} module(s) are not connected to the command module.`);
  }
  s.valid = s.errors.length === 0;
  return s;
}

/** Returns indices of modules not connected (4-neighbourhood) to any command module. */
export function disconnected(d: ShipDesign, alive?: boolean[]): number[] {
  const grid = buildGrid(d);
  const visited = new Uint8Array(d.w * d.h);
  const q: number[] = [];
  d.modules.forEach((m, i) => {
    if (alive && !alive[i]) return;
    const def = MODULE_MAP[m.id];
    if (def?.command) {
      const [fw, fh] = footprint(def, m.r);
      for (let y = m.y; y < m.y + fh; y++) for (let x = m.x; x < m.x + fw; x++) {
        const c = y * d.w + x;
        if (!visited[c]) { visited[c] = 1; q.push(c); }
      }
    }
  });
  while (q.length) {
    const c = q.pop()!;
    const x = c % d.w, y = (c / d.w) | 0;
    const nb = [x > 0 ? c - 1 : -1, x < d.w - 1 ? c + 1 : -1, y > 0 ? c - d.w : -1, y < d.h - 1 ? c + d.w : -1];
    for (const n of nb) {
      if (n < 0 || visited[n]) continue;
      const mi = grid[n];
      if (mi < 0 || (alive && !alive[mi])) continue;
      visited[n] = 1;
      q.push(n);
    }
  }
  const out: number[] = [];
  d.modules.forEach((m, i) => {
    if (alive && !alive[i]) return;
    const c = m.y * d.w + m.x;
    if (!visited[c]) out.push(i);
  });
  return out;
}

export function emptyDesign(frameId: string, name = 'New Ship'): ShipDesign {
  const f = FRAME_MAP[frameId] ?? FRAME_MAP.scout;
  return { key: 'custom_' + Math.random().toString(36).slice(2, 8), name, frame: f.id, w: f.w, h: f.h, modules: [], colors: ['#c8782a', '#3a3a40', '#60d0ff'], species: 'human', cls: 'custom' };
}

export function cloneDesign(d: ShipDesign): ShipDesign {
  return { ...d, colors: [...d.colors] as [string, string, string], modules: d.modules.map((m) => ({ ...m })) };
}

/** Moves modules so the design is centred in its grid (used when changing frames). */
export function recenter(d: ShipDesign, newW: number, newH: number): ShipDesign {
  const out = cloneDesign(d);
  if (!d.modules.length) {
    out.w = newW;
    out.h = newH;
    return out;
  }
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const m of d.modules) {
    const def = MODULE_MAP[m.id];
    const [fw, fh] = footprint(def, m.r);
    minX = Math.min(minX, m.x); minY = Math.min(minY, m.y);
    maxX = Math.max(maxX, m.x + fw); maxY = Math.max(maxY, m.y + fh);
  }
  const ox = Math.floor((newW - (maxX - minX)) / 2) - minX;
  const oy = Math.floor((newH - (maxY - minY)) / 2) - minY;
  out.w = newW;
  out.h = newH;
  out.modules = d.modules.map((m) => ({ ...m, x: m.x + ox, y: m.y + oy })).filter((m) => {
    const def = MODULE_MAP[m.id];
    const [fw, fh] = footprint(def, m.r);
    return m.x >= 0 && m.y >= 0 && m.x + fw <= newW && m.y + fh <= newH;
  });
  return out;
}

export function designValue(d: ShipDesign): number {
  let v = FRAME_MAP[d.frame]?.cost ?? 0;
  for (const m of d.modules) v += MODULE_MAP[m.id]?.cost ?? 0;
  return v;
}
