// Procedural voxel ship designs for NPC factions. Each faction has a visual and
// technological style; designs are deterministic given the faction seed.
import { RNG, hash } from '../core/rng';
import { MODULE_MAP, Species } from '../data/modules';
import { ShipDesign, ShipClass, PlacedModule, footprint, computeStats, mirrorRotation } from './design';

export type HullShape = 'wedge' | 'block' | 'needle' | 'organic' | 'crystal' | 'machine' | 'pirate' | 'hammer';

export interface ShipStyle {
  seed: number;
  species: Species;
  shape: HullShape;
  colors: [string, string, string];
  tier: number;
  family: 'energy' | 'kinetic' | 'mixed' | 'hive' | 'synod' | 'automata' | 'pirate';
}

export const CLASS_SIZE: Record<ShipClass, [number, number]> = {
  fighter: [9, 6],
  scout: [11, 6],
  corvette: [13, 8],
  miner: [13, 8],
  frigate: [17, 9],
  freighter: [19, 11],
  colony: [19, 11],
  destroyer: [23, 13],
  cruiser: [29, 17],
  battleship: [37, 21],
  station: [20, 20],
  custom: [14, 10],
};

export const CLASS_LABEL: Record<ShipClass, string> = {
  fighter: 'Fighter', scout: 'Scout', corvette: 'Corvette', miner: 'Mining Barge', frigate: 'Frigate', freighter: 'Freighter',
  colony: 'Colony Ship', destroyer: 'Destroyer', cruiser: 'Cruiser', battleship: 'Battleship', station: 'Station', custom: 'Custom',
};

interface Kit {
  armor: string;
  armorHeavy: string;
  slope: string;
  engine: string;
  thruster: string;
  reactor: string;
  reactorBig: string;
  shield: string;
  shieldBig: string;
  small: string[];
  big: string[];
  spinal: string[];
  jump: string;
}

function kitFor(style: ShipStyle): Kit {
  const t = style.tier;
  switch (style.family) {
    case 'hive':
      return { armor: 'armor_chitin', armorHeavy: 'armor_chitin', slope: 'armor_chitin_s', engine: 'engine_bio', thruster: 'thruster', reactor: 'bio_heart', reactorBig: 'bio_heart', shield: 'membrane', shieldBig: 'membrane', small: ['acid'], big: ['spore'], spinal: [], jump: 'jump2' };
    case 'synod':
      return { armor: 'armor_crystal', armorHeavy: 'armor_crystal', slope: 'armor_crystal_s', engine: 'engine_sail', thruster: 'maneuver', reactor: 'crystal_heart', reactorBig: 'crystal_heart', shield: 'resonant', shieldBig: 'resonant', small: ['prism'], big: ['crystal_lance'], spinal: ['crystal_lance'], jump: 'jump2' };
    case 'automata':
      return { armor: 'armor_adaptive', armorHeavy: 'armor_adaptive', slope: 'armor_adaptive_s', engine: 'engine_grav', thruster: 'thruster', reactor: 'reactor', reactorBig: 'singularity', shield: 'phase', shieldBig: 'phase', small: ['flak', 'pulse'], big: ['disruptor', 'drone_bay'], spinal: ['railgun'], jump: 'jump2' };
    case 'pirate':
      return { armor: 'armor', armorHeavy: t >= 2 ? 'armor_heavy' : 'armor', slope: 'armor_slope', engine: 'engine', thruster: 'thruster', reactor: 'reactor', reactorBig: 'reactor', shield: 'shield', shieldBig: 'shield', small: ['autocannon', 'pulse', 'autocannon'], big: ['missile', 'pulse_heavy'], spinal: t >= 3 ? ['railgun'] : [], jump: 'jump' };
    default: {
      const energy = style.family === 'energy', kinetic = style.family === 'kinetic';
      const small = energy ? ['laser', 'pulse'] : kinetic ? ['autocannon', 'autocannon', 'pulse'] : ['pulse', 'autocannon', 'laser'];
      const big = t >= 2 ? (energy ? ['pulse_heavy', 'laser_heavy', 'ion'] : kinetic ? ['missile', 'pulse_heavy'] : ['pulse_heavy', 'missile', 'ion']) : ['missile'];
      const spinal = t >= 4 ? (energy ? ['plasma_lance'] : ['railgun', 'torpedo']) : t >= 3 ? (energy ? ['railgun'] : ['railgun', 'torpedo']) : [];
      return {
        armor: t >= 4 ? 'armor_heavy' : 'armor', armorHeavy: t >= 4 ? 'armor_nano' : t >= 3 ? 'armor_reactive' : t >= 2 ? 'armor_heavy' : 'armor',
        slope: t >= 2 ? 'armor_hslope' : 'armor_slope', engine: 'engine', thruster: 'thruster', reactor: 'reactor', reactorBig: t >= 3 ? 'reactor_fusion' : 'reactor',
        shield: 'shield', shieldBig: t >= 3 ? 'shield_large' : 'shield', small, big, spinal, jump: t >= 3 ? 'jump2' : 'jump',
      };
    }
  }
}

class Builder {
  W: number;
  H: number;
  filled: Uint8Array;
  occ: Int16Array;
  mods: PlacedModule[] = [];
  rng: RNG;

  constructor(W: number, H: number, rng: RNG) {
    this.W = W;
    this.H = H;
    this.filled = new Uint8Array(W * H);
    this.occ = new Int16Array(W * H).fill(-1);
    this.rng = rng;
  }

  free(x: number, y: number, fw: number, fh: number, needFilled = true): boolean {
    if (x < 0 || y < 0 || x + fw > this.W || y + fh > this.H) return false;
    for (let yy = y; yy < y + fh; yy++)
      for (let xx = x; xx < x + fw; xx++) {
        const c = yy * this.W + xx;
        if (this.occ[c] !== -1) return false;
        if (needFilled && !this.filled[c]) return false;
      }
    return true;
  }

  put(id: string, x: number, y: number, r: number): void {
    const def = MODULE_MAP[id];
    const [fw, fh] = footprint(def, r);
    const idx = this.mods.length;
    this.mods.push({ id, x, y, r });
    for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) this.occ[yy * this.W + xx] = idx;
  }

  /** Places a module (mirrored across the horizontal axis when off-centre). */
  place(id: string, x: number, y: number, r = 0, needFilled = true): boolean {
    const def = MODULE_MAP[id];
    const [fw, fh] = footprint(def, r);
    const y2 = this.H - y - fh;
    if (y2 === y) {
      if (!this.free(x, y, fw, fh, needFilled)) return false;
      this.put(id, x, y, r);
      return true;
    }
    if (y2 < y + fh && y < y2 + fh) return false; // overlapping mirror
    if (!this.free(x, y, fw, fh, needFilled) || !this.free(x, y2, fw, fh, needFilled)) return false;
    this.put(id, x, y, r);
    this.put(id, x, y2, mirrorRotation(def, r));
    return true;
  }

  /** Try positions in the x-range, preferring the vertical centre (or edges). */
  placeIn(id: string, x0: number, x1: number, prefer: 'center' | 'edge', r = 0, maxTries = 400): boolean {
    const def = MODULE_MAP[id];
    const [fw, fh] = footprint(def, r);
    const cands: [number, number, number][] = [];
    const mid = (this.H - fh) / 2;
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(this.W - fw, Math.floor(x1)); x++)
      for (let y = 0; y <= Math.floor(mid); y++) {
        const dy = Math.abs(y - mid);
        const score = prefer === 'center' ? dy + this.rng.next() * 0.5 : -dy + this.rng.next() * 0.5;
        cands.push([score, x, y]);
      }
    cands.sort((a, b) => a[0] - b[0]);
    let tries = 0;
    for (const [, x, y] of cands) {
      if (tries++ > maxTries) break;
      if (this.place(id, x, y, r)) return true;
    }
    return false;
  }

  isEdge(x: number, y: number): boolean {
    const W = this.W, H = this.H;
    const f = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < W && yy < H && this.filled[yy * W + xx] === 1;
    return !f(x - 1, y) || !f(x + 1, y) || !f(x, y - 1) || !f(x, y + 1);
  }
}

function profile(style: ShipStyle, cls: ShipClass, W: number, H: number, rng: RNG): number[] {
  const half = H / 2;
  const hh: number[] = [];
  for (let x = 0; x < W; x++) {
    const t = x / (W - 1); // 0 rear .. 1 nose
    let v: number;
    switch (style.shape) {
      case 'wedge':
        v = half * (1 - Math.pow(t, 1.6) * 0.8);
        break;
      case 'block':
        v = half * (t > 0.85 ? 0.6 : 0.92);
        break;
      case 'needle':
        v = t < 0.3 ? half * 0.95 : half * (0.55 - (t - 0.3) * 0.35);
        break;
      case 'hammer':
        v = t > 0.75 ? half * 0.95 : t < 0.2 ? half * 0.8 : half * 0.5;
        break;
      case 'organic':
        v = half * (0.45 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05))) + Math.sin(t * 14 + style.seed) * 0.8;
        break;
      case 'crystal':
        v = half * (1 - Math.abs(t - 0.45) / 0.6) + (x % 3 === 0 ? 1 : 0);
        break;
      case 'machine':
        v = half * (Math.floor(t * 5) % 2 === 0 ? 0.95 : 0.6);
        break;
      case 'pirate':
      default:
        v = half * (0.65 + 0.3 * Math.sin(t * 5 + style.seed % 7)) * (t > 0.85 ? 0.7 : 1);
        break;
    }
    if (cls === 'freighter' || cls === 'colony') v = Math.max(v, half * (t < 0.85 ? 0.9 : 0.55));
    hh.push(v);
  }
  // random notches for variety
  for (let x = 1; x < W - 1; x++) if (rng.chance(0.12)) hh[x] += rng.pick([-1, 1]);
  return hh.map((v) => Math.max(1, Math.min(half, v)));
}

const CLASS_WEAPONS: Record<ShipClass, [number, number]> = {
  // [small, big] placement calls; off-centre placements are mirrored, so most count double
  fighter: [1, 0], scout: [1, 0], corvette: [2, 0], miner: [0, 0], frigate: [2, 1], freighter: [1, 0], colony: [1, 0],
  destroyer: [3, 1], cruiser: [4, 2], battleship: [6, 3], station: [4, 2], custom: [1, 0],
};

export function generateDesign(style: ShipStyle, cls: ShipClass, variant: number, key: string, name: string): ShipDesign {
  const rng = new RNG(hash(style.seed, Object.keys(CLASS_SIZE).indexOf(cls), variant));
  const [W, H] = CLASS_SIZE[cls];
  const b = new Builder(W, H, rng);
  const kit = kitFor(style);
  const mid = H / 2;
  const hh = profile(style, cls, W, H, rng);
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) {
      const dy = Math.abs(y + 0.5 - mid);
      if (dy < hh[x]) b.filled[y * W + x] = 1;
    }
  // central spine always solid
  for (let x = 0; x < W; x++) {
    b.filled[Math.floor((H - 1) / 2) * W + x] = 1;
    b.filled[Math.ceil((H - 1) / 2) * W + x] = 1;
  }

  const odd = H % 2 === 1;
  // 1. Command module near the front third
  const cmd = cls === 'battleship' ? 'command' : odd ? 'bridge' : 'cockpit';
  const cdef = MODULE_MAP[cmd];
  const cy = Math.round((H - cdef.h) / 2);
  let placedCmd = false;
  for (let x = Math.floor(W * 0.62); x >= Math.floor(W * 0.35) && !placedCmd; x--) {
    if (b.free(x, cy, cdef.w, cdef.h, false)) {
      for (let yy = cy; yy < cy + cdef.h; yy++) for (let xx = x; xx < x + cdef.w; xx++) b.filled[yy * W + xx] = 1;
      b.put(cmd, x, cy, 0);
      placedCmd = true;
    }
  }

  // 2. Engines on the rear
  const engDef = MODULE_MAP[kit.engine];
  const engPairs = cls === 'fighter' || cls === 'scout' ? 0 : cls === 'battleship' ? 3 : cls === 'cruiser' ? 2 : 1;
  let engines = 0;
  for (let y = Math.floor(mid - engDef.h / 2); y >= 0 && engines < engPairs * 2; y--) {
    for (let yy = y; yy < y + engDef.h; yy++) for (let xx = 0; xx < engDef.w; xx++) b.filled[yy * W + xx] = 1;
    for (let yy = H - y - engDef.h; yy < H - y; yy++) for (let xx = 0; xx < engDef.w; xx++) if (yy >= 0 && yy < H) b.filled[yy * W + xx] = 1;
    if (b.place(kit.engine, 0, y, 0)) engines += (H - y - engDef.h === y ? 1 : 2);
  }
  if (cls === 'battleship' || cls === 'cruiser') {
    if (style.family !== 'hive' && style.family !== 'synod' && style.tier >= 3) b.placeIn('engine_fusion', 0, 2, 'center');
  }
  // small thrusters fill remaining rear cells
  for (let y = 0; y < H; y++) {
    if (b.filled[y * W] && b.occ[y * W] === -1 && rng.chance(0.85)) b.place(kit.thruster, 0, y, 0);
  }

  // 3. Power
  const reactorBig = (cls === 'cruiser' || cls === 'battleship') && MODULE_MAP[kit.reactorBig].w === 3;
  b.placeIn(reactorBig ? kit.reactorBig : kit.reactor, W * 0.2, W * 0.55, 'center');
  if (cls !== 'fighter' && cls !== 'scout') b.placeIn(kit.reactor, W * 0.15, W * 0.6, 'center');
  if (cls === 'battleship') b.placeIn(kit.reactorBig, W * 0.15, W * 0.6, 'center');

  // 4. Jump drive
  if (cls !== 'fighter') b.placeIn(kit.jump, W * 0.12, W * 0.5, 'center');

  // 5. Shields
  if (cls !== 'fighter' && cls !== 'miner') {
    const big = cls === 'cruiser' || cls === 'battleship';
    if (!b.placeIn(big ? kit.shieldBig : kit.shield, W * 0.2, W * 0.7, 'center')) b.placeIn(kit.shield, W * 0.1, W * 0.8, 'center');
    if (cls === 'battleship' || cls === 'destroyer') b.placeIn('shield_cap', W * 0.2, W * 0.8, 'center');
  }

  // 6. Class specific payload
  if (cls === 'freighter') {
    for (let i = 0; i < 6; i++) if (!b.placeIn('cargo_bulk', W * 0.1, W * 0.8, 'center')) b.placeIn('cargo', W * 0.1, W * 0.85, 'center');
  }
  if (cls === 'colony') {
    b.placeIn('colony_pod', W * 0.15, W * 0.7, 'center');
    b.placeIn('cargo', W * 0.1, W * 0.85, 'center');
  }
  if (cls === 'miner') {
    b.placeIn('mining_laser', W * 0.6, W - 1, 'edge');
    b.placeIn('cargo', W * 0.15, W * 0.7, 'center');
    b.placeIn('tractor', W * 0.3, W * 0.9, 'edge');
  }
  if (cls === 'scout') b.placeIn('sensor', W * 0.5, W - 1, 'edge');

  // 7. Spinal weapon on the nose
  if (kit.spinal.length && (cls === 'destroyer' || cls === 'cruiser' || cls === 'battleship' || (cls === 'frigate' && rng.chance(0.4)))) {
    const sp = rng.pick(kit.spinal);
    const sd = MODULE_MAP[sp];
    const y = Math.round((H - sd.h) / 2);
    for (let x = W - sd.w; x > W * 0.5; x--) {
      if (b.free(x, y, sd.w, sd.h, false)) {
        const yy2 = H - y - sd.h;
        if (yy2 === y) {
          for (let yy = y; yy < y + sd.h; yy++) for (let xx = x; xx < x + sd.w; xx++) b.filled[yy * W + xx] = 1;
          b.put(sp, x, y, 0);
          break;
        } else if (b.place(sp, x, Math.max(0, y - 1), 0)) break;
      }
    }
  }

  // 8. Weapons
  const [smallN, bigN] = CLASS_WEAPONS[cls];
  for (let i = 0; i < bigN; i++) b.placeIn(rng.pick(kit.big), W * 0.3, W - 2, 'edge');
  let placedSmall = 0;
  for (let i = 0; i < smallN * 2 && placedSmall < smallN; i++) {
    if (b.placeIn(rng.pick(kit.small), W * 0.25, W - 1, 'edge', 0, 200)) placedSmall++;
  }
  if (cls === 'destroyer' || cls === 'cruiser' || cls === 'battleship' || cls === 'freighter') b.placeIn('flak', W * 0.3, W - 1, 'edge');
  if (style.family !== 'hive' && style.family !== 'synod' && (cls === 'frigate' || cls === 'destroyer' || cls === 'cruiser' || cls === 'battleship')) {
    if (style.tier >= 2) b.placeIn('battery', W * 0.2, W * 0.8, 'center');
    b.placeIn('fuel', W * 0.1, W * 0.5, 'center');
  }
  if (cls === 'cruiser' || cls === 'battleship') {
    if (style.family !== 'hive') b.placeIn('repair', W * 0.2, W * 0.8, 'center');
    b.placeIn('sensor', W * 0.4, W * 0.9, 'edge');
  }
  // maneuvering jets near the nose edges for agile hulls
  if (cls !== 'freighter' && cls !== 'colony') b.placeIn('maneuver', W * 0.6, W - 1, 'edge');

  // 9. Crew check and fill
  let st = computeStats(finalize(b, style, kit, cls, false));
  let guard = 0;
  while (st.crewCap < st.crewReq && guard++ < 6) {
    if (!b.placeIn('crew', W * 0.1, W * 0.9, 'center')) break;
    st = computeStats(finalize(b, style, kit, cls, false));
  }
  guard = 0;
  while (st.powerGen < st.powerUse + st.enginePower * 0.5 && guard++ < 6) {
    if (!b.placeIn(kit.reactor, W * 0.1, W * 0.9, 'center') && !b.placeIn('reactor_micro', W * 0.1, W * 0.9, 'center')) break;
    st = computeStats(finalize(b, style, kit, cls, false));
  }

  const design = finalize(b, style, kit, cls, true);
  design.key = key;
  design.name = name;
  return design;
}

function finalize(b: Builder, style: ShipStyle, kit: Kit, cls: ShipClass, fill: boolean): ShipDesign {
  const W = b.W, H = b.H;
  const mods = b.mods.map((m) => ({ ...m }));
  if (fill) {
    const heavy = cls === 'destroyer' || cls === 'cruiser' || cls === 'battleship';
    const mid = (H - 1) / 2;
    const f = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && b.filled[y * W + x] === 1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        if (!b.filled[c] || b.occ[c] !== -1) continue;
        const top = y < mid;
        const edge = b.isEdge(x, y);
        let id: string;
        let r = 0;
        const vEmpty = top ? !f(x, y - 1) : !f(x, y + 1);
        if (edge && vEmpty && !f(x + 1, y) && y !== Math.floor(mid) && y !== Math.ceil(mid)) {
          id = kit.slope;
          r = top ? 0 : 1;
        } else if (edge && vEmpty && !f(x - 1, y) && x > 0 && y !== Math.floor(mid) && y !== Math.ceil(mid)) {
          id = kit.slope;
          r = top ? 3 : 2;
        } else if (edge) {
          id = heavy ? kit.armorHeavy : kit.armor;
        } else {
          const roll = b.rng.next();
          if (style.family === 'pirate' && roll < 0.08) id = 'vent';
          else if (style.species === 'human' && roll < 0.05) id = 'window';
          else if (roll < 0.08 && style.species === 'human') id = 'stripe';
          else id = heavy ? kit.armor : 'hull';
          if (style.species !== 'human' && id === 'hull') id = kit.armor;
        }
        mods.push({ id, x, y, r });
      }
    // navigation lights on the extreme tips
    for (const m of mods) {
      if (m.id === kit.slope && (m.x === W - 1 || m.x === 0) && b.rng.chance(0.3) && style.species === 'human') m.id = 'light';
    }
  }
  return {
    key: '',
    name: '',
    frame: 'npc',
    w: W,
    h: H,
    modules: mods,
    colors: [...style.colors] as [string, string, string],
    species: style.species,
    cls,
  };
}

/** Starter ship given to the player at the beginning of a campaign. */
export function starterDesign(): ShipDesign {
  const mods: PlacedModule[] = [];
  const add = (id: string, x: number, y: number, r = 0) => mods.push({ id, x, y, r });
  // 14 x 10 scout frame, nose to the right; symmetric about rows 4|5
  add('engine', 0, 4);
  add('thruster', 0, 3);
  add('thruster', 0, 6);
  add('jump', 2, 4);
  add('reactor', 4, 4);
  add('hull', 6, 4);
  add('hull', 6, 5);
  add('window', 7, 4);
  add('window', 7, 5);
  add('cockpit', 8, 4);
  add('maneuver', 10, 4);
  add('maneuver', 10, 5);
  add('hull', 11, 4);
  add('hull', 11, 5);
  add('mining_laser', 12, 4);
  add('tractor', 12, 5);
  add('armor_slope', 13, 4, 0);
  add('armor_slope', 13, 5, 1);
  // upper / lower wings
  add('shield', 4, 2);
  add('crew', 4, 6);
  add('cargo', 6, 2);
  add('cargo', 6, 6);
  add('fuel', 2, 2);
  add('battery', 3, 2);
  add('fuel', 2, 6);
  add('battery', 3, 6);
  add('armor_slope', 1, 2, 3);
  add('armor', 1, 3);
  add('armor', 1, 6);
  add('armor_slope', 1, 7, 2);
  add('hull', 8, 3);
  add('window', 9, 3);
  add('hull', 8, 6);
  add('window', 9, 6);
  add('pulse', 8, 2);
  add('armor', 9, 2);
  add('pulse', 8, 7);
  add('armor', 9, 7);
  add('pulse', 10, 3);
  add('pulse', 10, 6);
  add('armor_slope', 10, 2, 0);
  add('armor_slope', 10, 7, 1);
  add('armor_slope', 11, 3, 0);
  add('armor_slope', 11, 6, 1);
  add('armor_slope', 2, 1, 3);
  add('light', 3, 1);
  add('armor', 4, 1);
  add('armor', 5, 1);
  add('armor', 6, 1);
  add('stripe', 7, 1);
  add('armor_slope', 8, 1, 0);
  add('armor_slope', 2, 8, 2);
  add('light', 3, 8);
  add('armor', 4, 8);
  add('armor', 5, 8);
  add('armor', 6, 8);
  add('stripe', 7, 8);
  add('armor_slope', 8, 8, 1);
  const d: ShipDesign = { key: 'player_starter', name: 'Wayfarer', frame: 'scout', w: 14, h: 10, modules: [], colors: ['#c8782a', '#3a3a44', '#60d0ff'], species: 'human', cls: 'custom' };
  // drop anything overlapping (defensive: keeps the hand-authored layout valid)
  const occ = new Int16Array(d.w * d.h).fill(-1);
  for (const m of mods) {
    const def = MODULE_MAP[m.id];
    const [fw, fh] = footprint(def, m.r);
    let ok = m.x >= 0 && m.y >= 0 && m.x + fw <= d.w && m.y + fh <= d.h;
    for (let y = m.y; ok && y < m.y + fh; y++) for (let x = m.x; x < m.x + fw; x++) if (occ[y * d.w + x] !== -1) ok = false;
    if (!ok) continue;
    for (let y = m.y; y < m.y + fh; y++) for (let x = m.x; x < m.x + fw; x++) occ[y * d.w + x] = d.modules.length;
    d.modules.push(m);
  }
  return d;
}
