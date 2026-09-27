// Colony simulation shared by campaign colonies and the standalone Colony Mode.
import { BUILDING_MAP, BuildingDef, ColonyRes, COLONY_RES, TECH_MAP, TileType, TILE_INFO } from '../data/buildings';
import { RNG, hash } from '../core/rng';
import { clamp } from '../core/math';
import type { Body, PlanetType } from '../gen/system';
import { generateColonyMap } from '../gen/terrain';

export interface ColonyBuilding {
  id: string;
  x: number;
  y: number;
  hp: number;
  progress: number; // construction 0..1
  enabled: boolean;
  staff: number; // last computed staffing ratio
}

export interface ColonyLog {
  day: number;
  text: string;
  kind: 'good' | 'bad' | 'info';
}

export interface ColonyState {
  id: number;
  name: string;
  mode: 'campaign' | 'standalone';
  owner: number;
  sys: number;
  body: string;
  lat: number;
  lon: number;
  planetType: PlanetType;
  planetSeed: number;
  planetName: string;
  habitability: number;
  starLum: number;
  size: number;
  tiles: TileType[];
  heights: number[];
  buildings: ColonyBuilding[];
  pop: number;
  happiness: number;
  health: number;
  res: Record<ColonyRes, number>;
  techs: string[];
  researching: string | null;
  credits: number;
  day: number;
  founded: number;
  log: ColonyLog[];
  effects: { id: string; until: number }[];
  terraform: number;
  won: boolean;
  lost: boolean;
  exportAbove: Partial<Record<ColonyRes, number>>;
  rngState: number;
  difficulty: number;
  report: ColonyReport;
  raidPressure: number;
}

export interface ColonyReport {
  power: number;
  powerDemand: number;
  housing: number;
  workers: number;
  jobs: number;
  storage: number;
  defense: number;
  income: number;
  net: Record<ColonyRes, number>;
  foodNeed: number;
  waterNeed: number;
}

export interface Wallet {
  get(): number;
  add(n: number): void;
}

export interface MarketLink {
  sell(res: ColonyRes, qty: number): number; // returns credits earned
}

export function colonyWallet(c: ColonyState): Wallet {
  return { get: () => c.credits, add: (n) => (c.credits += n) };
}

function emptyRes(): Record<ColonyRes, number> {
  return { food: 0, water: 0, ore: 0, metals: 0, alloys: 0, crystals: 0, med: 0, research: 0 };
}

export function createColony(
  id: number, name: string, mode: 'campaign' | 'standalone', owner: number, body: Body, lat: number, lon: number, starLum: number, difficulty = 1,
): ColonyState {
  const size = 20;
  const { tiles, heights } = generateColonyMap(body, lat, lon, size);
  const c: ColonyState = {
    id, name, mode, owner, sys: body.sysId, body: body.key, lat, lon, planetType: body.type, planetSeed: body.seed, planetName: body.name,
    habitability: body.habitability, starLum, size, tiles, heights, buildings: [], pop: mode === 'standalone' ? 40 : 50,
    happiness: 65, health: 80, res: emptyRes(), techs: [], researching: null, credits: mode === 'standalone' ? Math.round(9000 / difficulty) : 0,
    day: 0, founded: 0, log: [], effects: [], terraform: 0, won: false, lost: false, exportAbove: { food: 200, water: 200, ore: 150, metals: 150, alloys: 100, crystals: 30, med: 60 },
    rngState: hash(body.seed, id, 0xc0), difficulty, report: null as any, raidPressure: 0,
  };
  c.res.food = 120;
  c.res.water = 120;
  c.res.metals = 80;
  c.res.alloys = 10;
  const mid = Math.floor(size / 2);
  c.buildings.push({ id: 'hq', x: mid, y: mid, hp: 1, progress: 1, enabled: true, staff: 1 });
  c.report = computeReport(c);
  addLog(c, `${name} founded on ${body.name}. Welcome, Governor.`, 'good');
  return c;
}

export function addLog(c: ColonyState, text: string, kind: ColonyLog['kind'] = 'info'): void {
  c.log.unshift({ day: c.day, text, kind });
  if (c.log.length > 60) c.log.length = 60;
}

export function tileAt(c: ColonyState, x: number, y: number): TileType | null {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return null;
  return c.tiles[y * c.size + x];
}

export function buildingAt(c: ColonyState, x: number, y: number): ColonyBuilding | undefined {
  return c.buildings.find((b) => b.x === x && b.y === y);
}

export function techAvailable(c: ColonyState, id: string): boolean {
  const t = TECH_MAP[id];
  if (!t || c.techs.includes(id)) return false;
  return (t.requires ?? []).every((r) => c.techs.includes(r));
}

/** Validates construction; returns an error string or null. */
export function canBuild(c: ColonyState, wallet: Wallet, id: string, x: number, y: number): string | null {
  const def = BUILDING_MAP[id];
  if (!def) return 'Unknown building';
  const tile = tileAt(c, x, y);
  if (!tile) return 'Out of bounds';
  if (!TILE_INFO[tile].buildable) return `Cannot build on ${TILE_INFO[tile].name}`;
  if (buildingAt(c, x, y)) return 'Tile occupied';
  if (def.research && !c.techs.includes(def.research)) return `Requires research: ${TECH_MAP[def.research].name}`;
  if (def.requiresTile && !def.requiresTile.includes(tile)) return `Must be built on ${def.requiresTile.map((t) => TILE_INFO[t].name).join(' / ')}`;
  if (def.unique && c.buildings.some((b) => b.id === id)) return 'Only one allowed';
  if (!withinRange(c, x, y)) return 'Too far from existing structures';
  if (wallet.get() < def.cost.credits) return 'Not enough credits';
  if ((def.cost.metals ?? 0) > c.res.metals) return 'Not enough metals';
  if ((def.cost.alloys ?? 0) > c.res.alloys) return 'Not enough alloys';
  if ((def.cost.crystals ?? 0) > c.res.crystals) return 'Not enough crystals';
  return null;
}

function withinRange(c: ColonyState, x: number, y: number): boolean {
  return c.buildings.some((b) => Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) <= 3);
}

export function build(c: ColonyState, wallet: Wallet, id: string, x: number, y: number): string | null {
  const err = canBuild(c, wallet, id, x, y);
  if (err) return err;
  const def = BUILDING_MAP[id];
  wallet.add(-def.cost.credits);
  c.res.metals -= def.cost.metals ?? 0;
  c.res.alloys -= def.cost.alloys ?? 0;
  c.res.crystals -= def.cost.crystals ?? 0;
  c.buildings.push({ id, x, y, hp: 1, progress: 0, enabled: true, staff: 0 });
  addLog(c, `Construction started: ${def.name}.`);
  c.report = computeReport(c);
  return null;
}

export function demolish(c: ColonyState, wallet: Wallet, x: number, y: number): string | null {
  const b = buildingAt(c, x, y);
  if (!b) return 'Nothing here';
  if (b.id === 'hq') return 'Cannot demolish the HQ';
  const def = BUILDING_MAP[b.id];
  c.buildings = c.buildings.filter((o) => o !== b);
  const refund = b.progress >= 1 ? 0.35 : 0.8;
  wallet.add(Math.round(def.cost.credits * refund));
  c.res.metals += Math.round((def.cost.metals ?? 0) * refund);
  c.res.alloys += Math.round((def.cost.alloys ?? 0) * refund);
  addLog(c, `${def.name} demolished.`);
  c.report = computeReport(c);
  return null;
}

function buildDays(def: BuildingDef): number {
  return 1 + Math.ceil((def.cost.credits + (def.cost.metals ?? 0) * 20 + (def.cost.alloys ?? 0) * 40) / 1200);
}

function effectActive(c: ColonyState, id: string): boolean {
  return c.effects.some((e) => e.id === id && e.until > c.day);
}

export function computeReport(c: ColonyState): ColonyReport {
  let power = 0, demand = 0, housing = 0, jobs = 0, storage = 0, defense = 0, income = 0;
  const solarF = clamp(Math.pow(c.starLum, 0.25), 0.35, 1.6) * (effectActive(c, 'dust') ? 0.4 : 1);
  const automation = c.techs.includes('automation') ? 0.75 : 1;
  for (const b of c.buildings) {
    if (b.progress < 1 || !b.enabled) continue;
    const def = BUILDING_MAP[b.id];
    if (def.power > 0) power += def.power * (b.id === 'solar' ? solarF : 1) * (def.workers ? Math.max(0.3, b.staff) : 1);
    else demand += -def.power;
    housing += def.housing ?? 0;
    jobs += Math.round(def.workers * automation);
    storage += def.storage ?? 0;
    defense += (def.defense ?? 0) * Math.max(0.3, b.staff);
    income += (def.income ?? 0) * (def.workers ? b.staff : 1);
  }
  return {
    power, powerDemand: demand, housing, workers: Math.floor(c.pop * 0.6), jobs, storage, defense, income,
    net: emptyRes(), foodNeed: c.pop * 0.02, waterNeed: c.pop * 0.016,
  };
}

const PRIORITY: Record<string, number> = { farm: 0, water: 1, hospital: 2, geothermal: 3, fusion: 3, solar: 3, medlab: 4, mine: 5, refinery: 6, spaceport: 6, lab: 7, foundry: 7, crystal_mine: 7 };

/** Advances the colony by one day. */
export function tickColony(c: ColonyState, wallet: Wallet, market?: MarketLink, raidThreat = 0): void {
  if (c.lost) return;
  c.day++;
  const rng = new RNG(hash(c.rngState, c.day));
  const automation = c.techs.includes('automation') ? 0.75 : 1;

  // Construction
  for (const b of c.buildings) {
    if (b.progress < 1) {
      b.progress = Math.min(1, b.progress + 1 / buildDays(BUILDING_MAP[b.id]));
      if (b.progress >= 1) addLog(c, `${BUILDING_MAP[b.id].name} completed.`, 'good');
    }
  }

  // Workforce allocation in priority order
  let workforce = Math.floor(c.pop * 0.6);
  const active = c.buildings.filter((b) => b.progress >= 1 && b.enabled);
  active.sort((a, b) => (PRIORITY[a.id] ?? 8) - (PRIORITY[b.id] ?? 8));
  for (const b of active) {
    const need = Math.round(BUILDING_MAP[b.id].workers * automation);
    if (need <= 0) { b.staff = 1; continue; }
    const got = Math.min(need, workforce);
    workforce -= got;
    b.staff = got / need;
  }
  for (const b of c.buildings) if (b.progress < 1 || !b.enabled) b.staff = 0;

  const rep = computeReport(c);
  const powerRatio = rep.powerDemand > 0 ? clamp(rep.power / rep.powerDemand, 0, 1) : 1;
  const net = emptyRes();
  const happyF = 0.6 + c.happiness / 125;
  const genetics = c.techs.includes('genetics') ? 1.3 : 1;
  const deep = c.techs.includes('deepcore') ? 1.5 : 1;

  for (const b of active) {
    const def = BUILDING_MAP[b.id];
    let eff = b.staff * happyF * (def.power < 0 ? powerRatio : 1) * b.hp;
    if (eff <= 0) continue;
    // inputs
    if (def.consumes) {
      let ratio = 1;
      for (const [k, v] of Object.entries(def.consumes) as [ColonyRes, number][]) {
        const need = v * eff;
        if (need > 0) ratio = Math.min(ratio, c.res[k] / need);
      }
      ratio = clamp(ratio, 0, 1);
      eff *= ratio;
      for (const [k, v] of Object.entries(def.consumes) as [ColonyRes, number][]) {
        c.res[k] -= v * eff;
        net[k] -= v * eff;
      }
    }
    if (def.produces) {
      const tile = tileAt(c, b.x, b.y)!;
      let mult = def.bonusTile && def.bonusTile.tile === tile ? def.bonusTile.mult : 1;
      if (b.id === 'farm') mult *= genetics * (0.5 + c.habitability);
      if (b.id === 'mine' || b.id === 'crystal_mine') mult *= deep;
      if (b.id === 'mine' && tile === 'rock') mult *= 1.3;
      for (const [k, v] of Object.entries(def.produces) as [ColonyRes, number][]) {
        const amt = v * eff * mult;
        c.res[k] += amt;
        net[k] += amt;
      }
    }
  }

  // Population needs
  const foodNeed = c.pop * 0.02, waterNeed = c.pop * 0.016;
  const foodOk = c.res.food >= foodNeed, waterOk = c.res.water >= waterNeed;
  c.res.food = Math.max(0, c.res.food - foodNeed);
  c.res.water = Math.max(0, c.res.water - waterNeed);
  net.food -= foodNeed;
  net.water -= waterNeed;

  // Storage caps
  const cap = 400 + rep.storage;
  for (const k of COLONY_RES) if (k !== 'research') c.res[k] = Math.min(c.res[k], cap);

  // Happiness & health
  let happyT = 55;
  let healthT = 70;
  for (const b of active) {
    const def = BUILDING_MAP[b.id];
    happyT += (def.happiness ?? 0) * b.staff * Math.min(1, 300 / Math.max(100, c.pop)) * 2.2;
    healthT += (def.health ?? 0) * b.staff * (c.techs.includes('medicine') ? 1.5 : 1) * Math.min(1, 400 / Math.max(100, c.pop)) * 2;
  }
  const crowd = rep.housing > 0 ? c.pop / rep.housing : 2;
  if (crowd > 1) happyT -= (crowd - 1) * 60;
  const unemployed = Math.max(0, Math.floor(c.pop * 0.6) - rep.jobs);
  happyT -= Math.min(20, (unemployed / Math.max(1, c.pop)) * 50);
  if (!foodOk) { happyT -= 25; healthT -= 30; }
  if (!waterOk) { happyT -= 25; healthT -= 35; }
  if (powerRatio < 1) happyT -= (1 - powerRatio) * 25;
  happyT -= (1 - c.habitability) * 18;
  if (c.res.med > 5) healthT += 6;
  if (effectActive(c, 'plague')) healthT -= 35;
  if (effectActive(c, 'festival')) happyT += 15;
  c.happiness = clamp(c.happiness + (clamp(happyT, 0, 100) - c.happiness) * 0.15, 0, 100);
  c.health = clamp(c.health + (clamp(healthT, 0, 100) - c.health) * 0.15, 0, 100);

  // Population change
  let growth = 0;
  if (foodOk && waterOk && crowd < 1 && c.happiness > 35) {
    growth = c.pop * 0.012 * (0.4 + c.habitability) * (c.happiness / 70) * (c.health / 80);
    growth = Math.min(growth, rep.housing - c.pop);
    if (c.buildings.some((b) => b.id === 'spaceport' && b.progress >= 1)) growth += 0.8 * (c.happiness / 60);
  }
  if (!foodOk || !waterOk) growth -= c.pop * 0.03;
  if (c.health < 30) growth -= c.pop * 0.015;
  if (crowd > 1.15) growth -= c.pop * 0.01;
  c.pop = Math.max(0, c.pop + growth);

  // Research
  if (c.researching) {
    const t = TECH_MAP[c.researching];
    if (c.res.research >= t.cost) {
      c.res.research -= t.cost;
      c.techs.push(t.id);
      addLog(c, `Research complete: ${t.name}. ${t.desc}`, 'good');
      c.researching = null;
    }
  }

  // Income
  const taxes = c.pop * 0.35 * (c.happiness / 70);
  const income = rep.income + taxes;
  wallet.add(income);

  // Exports via spaceport
  let exportEarn = 0;
  const port = c.buildings.find((b) => b.id === 'spaceport' && b.progress >= 1);
  if (port && port.staff > 0.2) {
    for (const k of COLONY_RES) {
      if (k === 'research') continue;
      const keep = c.exportAbove[k] ?? 9999;
      if (c.res[k] > keep) {
        const qty = Math.floor((c.res[k] - keep) * 0.5 * port.staff);
        if (qty <= 0) continue;
        c.res[k] -= qty;
        const earned = market ? market.sell(k, qty) : qty * STANDALONE_PRICE[k];
        wallet.add(earned);
        exportEarn += earned;
      }
    }
  }

  // Terraforming
  const terra = active.filter((b) => b.id === 'atmo').reduce((s, b) => s + b.staff * powerRatio, 0);
  if (terra > 0 && c.habitability < 0.92) {
    c.terraform += terra;
    if (c.terraform >= 30) {
      c.terraform = 0;
      c.habitability = Math.min(0.92, c.habitability + 0.04);
      addLog(c, `Terraforming progress: habitability now ${(c.habitability * 100).toFixed(0)}%.`, 'good');
    }
  }

  // Random events
  colonyEvents(c, rng, rep, wallet, raidThreat);

  c.report = computeReport(c);
  c.report.net = net;
  c.report.income = income + exportEarn;

  if (c.pop < 1) {
    c.lost = true;
    addLog(c, 'The colony has been abandoned. All colonists are gone.', 'bad');
  }
  if (c.mode === 'standalone' && !c.won && c.pop >= 3000 && c.buildings.some((b) => b.id === 'elevator' && b.progress >= 1)) {
    c.won = true;
    addLog(c, 'VICTORY! The Space Elevator is operational and the colony thrives. You have tamed this world.', 'good');
  }
}

export const STANDALONE_PRICE: Record<ColonyRes, number> = { food: 18, water: 12, ore: 15, metals: 40, alloys: 85, crystals: 280, med: 95, research: 0 };

function colonyEvents(c: ColonyState, rng: RNG, rep: ColonyReport, wallet: Wallet, raidThreat: number): void {
  const d = c.difficulty;
  const shield = c.buildings.some((b) => b.id === 'shield' && b.progress >= 1 && b.staff > 0.3);
  const damage = (count: number) => {
    const targets = c.buildings.filter((b) => b.id !== 'hq' && b.progress >= 1);
    for (let i = 0; i < count && targets.length; i++) {
      const b = targets[rng.int(0, targets.length - 1)];
      b.hp = Math.max(0.1, b.hp - rng.range(0.3, 0.7));
    }
  };
  // Repairs over time
  for (const b of c.buildings) if (b.hp < 1) b.hp = Math.min(1, b.hp + 0.04);

  if (c.day > 10 && rng.chance(0.012 * d)) {
    if (shield) addLog(c, 'A meteor shower was deflected by the planetary shield.', 'good');
    else {
      damage(rng.int(1, 3));
      addLog(c, 'Meteor strike! Several structures were damaged.', 'bad');
    }
  }
  const raidChance = (0.006 + raidThreat * 0.02 + c.raidPressure * 0.002) * d * (c.day > 25 ? 1 : 0);
  c.raidPressure = Math.min(30, c.raidPressure + (c.pop > 400 ? 0.2 : 0.05));
  if (rng.chance(raidChance)) {
    const power = rng.range(10, 30) + c.pop * 0.02 * d + c.raidPressure;
    c.raidPressure = 0;
    if (rep.defense >= power) addLog(c, `Pirate raid repelled by colony defenses (${rep.defense.toFixed(0)} vs ${power.toFixed(0)}).`, 'good');
    else {
      const loss = clamp((power - rep.defense) / power, 0.1, 0.6);
      for (const k of ['food', 'metals', 'alloys', 'crystals', 'med'] as ColonyRes[]) c.res[k] *= 1 - loss;
      const stolen = Math.min(wallet.get(), Math.round(500 * loss * d));
      wallet.add(-stolen);
      damage(rng.int(1, 2));
      c.pop *= 1 - loss * 0.1;
      addLog(c, `Pirates raided the colony! Lost ${(loss * 100).toFixed(0)}% of stockpiles and ${stolen} credits. Build defenses!`, 'bad');
    }
  }
  if (rng.chance(0.008) && !effectActive(c, 'dust') && c.planetType !== 'ocean') {
    c.effects.push({ id: 'dust', until: c.day + rng.int(4, 9) });
    addLog(c, 'A dust storm is reducing solar output.', 'bad');
  }
  if (c.health < 50 && rng.chance(0.02 * (c.techs.includes('medicine') ? 0.4 : 1))) {
    c.effects.push({ id: 'plague', until: c.day + rng.int(5, 12) });
    addLog(c, 'A plague outbreak! Hospitals and medical supplies are needed.', 'bad');
  }
  if (rng.chance(0.01)) {
    const pts = rng.int(20, 60);
    c.res.research += pts;
    addLog(c, `Surveyors discovered strange formations: +${pts} research.`, 'good');
  }
  if (c.happiness > 70 && rng.chance(0.012)) {
    const n = rng.int(10, 40);
    c.pop += n;
    addLog(c, `${n} immigrants arrived, drawn by the colony's reputation.`, 'good');
  }
  if (c.happiness > 60 && rng.chance(0.006)) {
    c.effects.push({ id: 'festival', until: c.day + 5 });
    addLog(c, 'The colonists are celebrating Founders\' Festival!', 'good');
  }
  if (rng.chance(0.006)) {
    const k = rng.pick(['metals', 'alloys', 'crystals'] as ColonyRes[]);
    const n = k === 'crystals' ? rng.int(3, 10) : rng.int(20, 60);
    c.res[k] += n;
    addLog(c, `A passing freighter traded surplus goods: +${n} ${k}.`, 'good');
  }
  c.effects = c.effects.filter((e) => e.until > c.day);
}

export function colonyScore(c: ColonyState): number {
  return Math.round(c.pop * 2 + c.buildings.length * 50 + c.techs.length * 200 + c.happiness * 10);
}

/** Prefabricated structures delivered by a Colony Pod in the campaign. */
export function addStarterKit(c: ColonyState, ids: string[] = ['solar', 'farm', 'water', 'habitat']): void {
  const mid = Math.floor(c.size / 2);
  for (const id of ids) {
    const def = BUILDING_MAP[id];
    let best: [number, number] | null = null, bd = 1e9;
    for (let y = mid - 3; y <= mid + 3; y++)
      for (let x = mid - 3; x <= mid + 3; x++) {
        const t = tileAt(c, x, y);
        if (!t || !TILE_INFO[t].buildable || buildingAt(c, x, y)) continue;
        if (def.requiresTile && !def.requiresTile.includes(t)) continue;
        let d = Math.abs(x - mid) + Math.abs(y - mid);
        if (def.bonusTile && def.bonusTile.tile === t) d -= 2;
        if (d < bd) { bd = d; best = [x, y]; }
      }
    if (best) c.buildings.push({ id, x: best[0], y: best[1], hp: 1, progress: 1, enabled: true, staff: 1 });
  }
  c.report = computeReport(c);
}
