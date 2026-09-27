// Star system generation: stars, planets, moons, asteroid belts, habitable zone.
import { RNG, hash } from '../core/rng';
import { StarDef, StarClass, makeStar, rollStarClass } from './stars';
import { planetName, moonName } from '../core/names';

export type PlanetType =
  | 'barren' | 'desert' | 'arid' | 'terran' | 'ocean' | 'jungle' | 'tundra'
  | 'ice' | 'lava' | 'toxic' | 'gas' | 'icegiant' | 'crystal';

export type Atmosphere = 'none' | 'thin' | 'breathable' | 'thick' | 'toxic' | 'hydrogen';

export const PLANET_LABEL: Record<PlanetType, string> = {
  barren: 'Barren Rock', desert: 'Desert World', arid: 'Arid World', terran: 'Terran World', ocean: 'Ocean World',
  jungle: 'Jungle World', tundra: 'Tundra World', ice: 'Ice World', lava: 'Lava World', toxic: 'Toxic World',
  gas: 'Gas Giant', icegiant: 'Ice Giant', crystal: 'Crystal World',
};

export interface Resources {
  ore: number;
  ice: number;
  crystals: number;
  gas: number;
  organics: number;
}

export interface Body {
  sysId: number;
  index: number; // planet index, moons: planetIndex*10 + moon+1 ... see key
  key: string; // unique within system: 'p3' or 'p3m1'
  name: string;
  type: PlanetType;
  seed: number;
  orbit: number; // world units from parent
  au: number;
  period: number; // days
  phase: number;
  radius: number; // world units visual radius
  realRadius: number; // earth radii
  gravity: number;
  temp: number; // Kelvin
  atmosphere: Atmosphere;
  habitability: number; // 0..1
  resources: Resources;
  biosphere: number;
  ruins: boolean;
  rings: boolean;
  tilt: number;
  rotSpeed: number;
  moons: Body[];
  parent: Body | null;
  landable: boolean;
}

export interface Belt {
  orbit: number;
  width: number;
  kind: 'rock' | 'ice' | 'crystal';
  richness: number;
  count: number;
}

export interface SystemData {
  id: number;
  name: string;
  x: number;
  y: number;
  seed: number;
  stars: StarDef[];
  binarySep: number;
  planets: Body[];
  belts: Belt[];
  hzInner: number;
  hzOuter: number;
  lum: number;
  nebula: number;
  neighbors: number[];
  bestHab: number;
  special: 'none' | 'core' | 'derelict' | 'anomaly' | 'ruins';
  richness: Resources;
  catalog: boolean;
}

/** Converts astronomical units into in-system world distance. */
export function auToWorld(au: number): number {
  return 520 + 1500 * Math.pow(au, 0.65);
}

function equilibriumTemp(lum: number, au: number): number {
  return 278 * Math.pow(Math.max(lum, 1e-5), 0.25) / Math.sqrt(Math.max(au, 0.02));
}

function classify(rng: RNG, temp: number, au: number, frostAu: number, giantChance: number): PlanetType {
  if (au > frostAu && rng.chance(giantChance)) return rng.chance(0.65) ? 'gas' : 'icegiant';
  if (au <= frostAu && rng.chance(giantChance * 0.12)) return 'gas'; // hot jupiter
  if (rng.chance(0.015)) return 'crystal';
  if (temp > 750) return rng.chance(0.75) ? 'lava' : 'barren';
  if (temp > 420) return rng.pick(['toxic', 'barren', 'desert', 'lava'] as PlanetType[]);
  if (temp > 325) return rng.pick(['desert', 'desert', 'arid', 'toxic', 'barren'] as PlanetType[]);
  if (temp > 258) return rng.weighted(['terran', 'ocean', 'jungle', 'arid', 'desert', 'barren', 'toxic'] as PlanetType[], [3, 2, 2, 2, 1, 1, 0.6]);
  if (temp > 200) return rng.weighted(['tundra', 'arid', 'ice', 'barren', 'ocean'] as PlanetType[], [3, 3, 2, 1.5, 0.4]);
  if (temp > 120) return rng.pick(['ice', 'tundra', 'barren', 'ice'] as PlanetType[]);
  return rng.pick(['ice', 'barren', 'ice'] as PlanetType[]);
}

function atmosphereFor(rng: RNG, type: PlanetType, size: number): Atmosphere {
  switch (type) {
    case 'gas':
    case 'icegiant':
      return 'hydrogen';
    case 'terran':
    case 'jungle':
    case 'ocean':
      return rng.chance(0.8) ? 'breathable' : 'thick';
    case 'toxic':
      return 'toxic';
    case 'lava':
      return rng.chance(0.5) ? 'toxic' : 'thin';
    case 'barren':
      return size < 0.6 ? 'none' : rng.chance(0.5) ? 'none' : 'thin';
    case 'crystal':
      return 'thin';
    default:
      return rng.chance(0.6) ? 'thin' : rng.chance(0.4) ? 'none' : 'thick';
  }
}

function habitabilityFor(type: PlanetType, temp: number, atm: Atmosphere, gravity: number): number {
  const base: Record<PlanetType, number> = {
    terran: 0.95, jungle: 0.8, ocean: 0.7, arid: 0.5, tundra: 0.45, desert: 0.35, ice: 0.18, barren: 0.12,
    toxic: 0.06, lava: 0.02, crystal: 0.2, gas: 0, icegiant: 0,
  };
  let h = base[type];
  if (atm === 'breathable') h += 0.05;
  if (atm === 'none') h -= 0.05;
  h -= Math.abs(temp - 288) / 900;
  h -= Math.max(0, gravity - 1.5) * 0.15;
  return Math.max(0, Math.min(1, h));
}

function resourcesFor(rng: RNG, type: PlanetType): Resources {
  const r: Resources = { ore: rng.range(0.1, 0.6), ice: rng.range(0, 0.3), crystals: rng.chance(0.15) ? rng.range(0.1, 0.5) : 0, gas: 0, organics: 0 };
  switch (type) {
    case 'barren': r.ore += 0.35; break;
    case 'lava': r.ore += 0.4; r.crystals += rng.range(0, 0.2); break;
    case 'desert': case 'arid': r.ore += 0.2; break;
    case 'ice': case 'tundra': r.ice += 0.6; break;
    case 'ocean': r.ice += 0.3; r.organics += 0.5; break;
    case 'terran': case 'jungle': r.organics += 0.8; break;
    case 'gas': r.gas = 1; r.ore = 0; break;
    case 'icegiant': r.gas = 0.8; r.ice = 0.5; r.ore = 0; break;
    case 'crystal': r.crystals = rng.range(0.7, 1); break;
    case 'toxic': r.gas = 0.4; break;
  }
  for (const k of Object.keys(r) as (keyof Resources)[]) r[k] = Math.max(0, Math.min(1, r[k]));
  return r;
}

function makeBody(
  rng: RNG, sysId: number, key: string, name: string, type: PlanetType, orbit: number, au: number,
  temp: number, parent: Body | null, index: number, periodDays: number,
): Body {
  const giant = type === 'gas' || type === 'icegiant';
  const realRadius = giant ? rng.range(3.5, 12) : parent ? rng.range(0.15, 0.6) : rng.range(0.3, 1.9);
  const radius = giant ? 110 + realRadius * 12 : parent ? 18 + realRadius * 40 : 36 + realRadius * 34;
  const gravity = giant ? realRadius * 0.3 : realRadius * rng.range(0.7, 1.2);
  const atm = atmosphereFor(rng, type, realRadius);
  const hab = habitabilityFor(type, temp, atm, gravity);
  const bio = (type === 'terran' || type === 'jungle' || type === 'ocean') ? rng.range(0.4, 1) : type === 'arid' || type === 'tundra' ? rng.range(0, 0.5) : 0;
  return {
    sysId,
    index,
    key,
    name,
    type,
    seed: hash(sysId, index, 777),
    orbit,
    au,
    period: periodDays,
    phase: rng.range(0, Math.PI * 2),
    radius,
    realRadius,
    gravity,
    temp,
    atmosphere: atm,
    habitability: hab,
    resources: resourcesFor(rng, type),
    biosphere: bio,
    ruins: !giant && rng.chance(0.07),
    rings: giant ? rng.chance(0.45) : rng.chance(0.03),
    tilt: rng.range(-0.4, 0.4),
    rotSpeed: rng.range(0.02, 0.09) * (rng.chance(0.1) ? -1 : 1),
    moons: [],
    parent,
    landable: !giant,
  };
}

export function generateSystem(id: number, name: string, x: number, y: number, galaxySeed: number, nebula: number, forced?: StarClass): SystemData {
  const seed = hash(galaxySeed, id, 0x51);
  const rng = new RNG(seed);
  const cls = forced ?? rollStarClass(rng);
  const stars: StarDef[] = [makeStar(rng, cls)];
  let binarySep = 0;
  if (cls !== 'BH' && cls !== 'NS' && rng.chance(0.14)) {
    const c2 = rng.weighted(['K', 'M', 'G', 'WD', 'F'] as StarClass[], [3, 5, 2, 1, 1]);
    stars.push(makeStar(rng, c2));
    binarySep = stars[0].radius + stars[1].radius + rng.range(140, 320);
  }
  const lum = stars.reduce((s, st) => s + st.lum, 0);
  const hzInnerAu = Math.sqrt(lum) * 0.95;
  const hzOuterAu = Math.sqrt(lum) * 1.37;
  const frostAu = Math.sqrt(lum) * 2.7;

  const planets: Body[] = [];
  const belts: Belt[] = [];
  const count = cls === 'NS' ? rng.int(0, 3) : cls === 'BH' ? rng.int(1, 5) : rng.int(2, 9);
  let au = Math.max(0.2, Math.sqrt(lum) * rng.range(0.25, 0.45));
  const minOrbit = stars[0].radius * 2.2 + binarySep * 1.3 + 180;
  const giantChance = rng.range(0.3, 0.7);
  for (let i = 0; i < count; i++) {
    if (auToWorld(au) < minOrbit) au = Math.max(au, Math.pow((minOrbit - 520) / 1500, 1 / 0.65));
    const orbit = auToWorld(au);
    const temp = equilibriumTemp(lum, au) * rng.range(0.92, 1.1);
    // Occasionally place a belt instead of a planet.
    if (i > 0 && belts.length < 2 && rng.chance(0.14)) {
      belts.push({ orbit, width: rng.range(160, 420), kind: temp < 170 ? 'ice' : rng.chance(0.1) ? 'crystal' : 'rock', richness: rng.range(0.3, 1), count: rng.int(90, 200) });
    } else {
      const type = classify(rng, temp, au, frostAu, giantChance);
      const pIndex = planets.length;
      const periodDays = 365 * Math.sqrt(Math.pow(au, 3) / Math.max(0.1, stars[0].mass + (stars[1]?.mass ?? 0)));
      const p = makeBody(rng, id, `p${pIndex}`, planetName(name, pIndex, rng), type, orbit, au, temp, null, pIndex, Math.max(20, periodDays));
      const giant = type === 'gas' || type === 'icegiant';
      const moonCount = giant ? rng.int(0, 4) : p.realRadius > 0.9 ? rng.int(0, 2) : rng.chance(0.2) ? 1 : 0;
      let mOrbit = p.radius * 2.2 + 40;
      for (let m = 0; m < moonCount; m++) {
        const mTemp = temp * rng.range(0.85, 1);
        const mType: PlanetType = mTemp > 700 ? 'lava' : mTemp < 200 ? rng.pick(['ice', 'barren', 'ice'] as PlanetType[]) : rng.pick(['barren', 'barren', 'desert', 'arid', 'ice', 'toxic'] as PlanetType[]);
        const moon = makeBody(rng, id, `p${pIndex}m${m}`, moonName(p.name, m), mType, mOrbit, au, mTemp, p, pIndex * 10 + m + 1000, rng.range(4, 30));
        mOrbit += moon.radius * 2 + rng.range(40, 90);
        p.moons.push(moon);
      }
      planets.push(p);
    }
    au *= rng.range(1.4, 2.0);
  }
  if (rng.chance(0.28) && belts.length === 0) {
    belts.push({ orbit: auToWorld(au * 0.8), width: rng.range(200, 500), kind: rng.chance(0.5) ? 'ice' : 'rock', richness: rng.range(0.3, 1), count: rng.int(100, 220) });
  }

  let bestHab = 0;
  const richness: Resources = { ore: 0, ice: 0, crystals: 0, gas: 0, organics: 0 };
  const visit = (b: Body) => {
    bestHab = Math.max(bestHab, b.habitability);
    for (const k of Object.keys(richness) as (keyof Resources)[]) richness[k] = Math.max(richness[k], b.resources[k]);
    b.moons.forEach(visit);
  };
  planets.forEach(visit);
  for (const b of belts) {
    if (b.kind === 'rock') richness.ore = Math.max(richness.ore, b.richness);
    if (b.kind === 'ice') richness.ice = Math.max(richness.ice, b.richness);
    if (b.kind === 'crystal') richness.crystals = Math.max(richness.crystals, b.richness);
  }

  let special: SystemData['special'] = 'none';
  const r = rng.next();
  if (r < 0.05) special = 'derelict';
  else if (r < 0.08) special = 'anomaly';
  if (planets.some((p) => p.ruins)) special = special === 'none' ? 'ruins' : special;

  return {
    id,
    name,
    x,
    y,
    seed,
    stars,
    binarySep,
    planets,
    belts,
    hzInner: auToWorld(hzInnerAu),
    hzOuter: auToWorld(hzOuterAu),
    lum,
    nebula,
    neighbors: [],
    bestHab,
    special,
    richness,
    catalog: false,
  };
}

/** Position of a body at a given day (circular orbits around the system barycentre / parent). */
export function bodyPos(b: Body, day: number, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const a = b.phase + (day / b.period) * Math.PI * 2;
  let px = 0, py = 0;
  if (b.parent) {
    const pp = bodyPos(b.parent, day);
    px = pp.x;
    py = pp.y;
  }
  out.x = px + Math.cos(a) * b.orbit;
  out.y = py + Math.sin(a) * b.orbit;
  return out;
}

export function allBodies(sys: SystemData): Body[] {
  const out: Body[] = [];
  for (const p of sys.planets) {
    out.push(p);
    for (const m of p.moons) out.push(m);
  }
  return out;
}

export function findBody(sys: SystemData, key: string): Body | null {
  for (const p of sys.planets) {
    if (p.key === key) return p;
    for (const m of p.moons) if (m.key === key) return m;
  }
  return null;
}
