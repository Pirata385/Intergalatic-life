// The World: galaxy (static, regenerated from seed) + dynamic simulation state.
import { RNG, hash } from '../core/rng';
import { Galaxy, generateGalaxy, sysDist, findRoute } from '../gen/galaxy';
import type { SystemData } from '../gen/system';
import { COMMODITIES, NUM_COMMODITIES, ECONOMY_PROFILE, EconomyType, C } from '../data/commodities';
import { GOVERNMENTS, FACTION_COLORS, ALIENS, PIRATE_NAMES, SUBFACTION_TEMPLATES, SubfactionRole, HOSTILE_REP } from '../data/factions';
import { hslHex, shade, clamp } from '../core/math';
import { starName, alienName, personName, cap } from '../core/names';
import type { SystemState, Faction, Fleet, NewsItem, PlayerState, WorldSave, Mission, NewsKind, FleetShip, FleetRole } from './types';
import type { ColonyState } from './colony';
import type { ShipDesign, ShipClass, ShipStats } from '../ship/design';
import { computeStats } from '../ship/design';
import { generateDesign, ShipStyle, HullShape, CLASS_LABEL } from '../ship/shipgen';
import { createPlayer } from '../player/player';
import { bus } from '../core/events';

export const SAVE_VERSION = 3;

export class World {
  seed: number;
  galaxy: Galaxy;
  day = 0;
  systems: SystemState[] = [];
  factions: Faction[] = [];
  fleets: Fleet[] = [];
  nextFleetId = 1;
  news: NewsItem[] = [];
  colonies: ColonyState[] = [];
  player!: PlayerState;
  rng: RNG;
  boards: Record<number, { week: number; missions: Mission[] }> = {};
  stats = { wars: 0, captures: 0, colonies: 0 };
  realTime = Date.now();
  private designCache = new Map<string, ShipDesign>();
  private statsCache = new Map<string, ShipStats>();
  fleetsBySys = new Map<number, Fleet[]>();

  constructor(seed: number, galaxy?: Galaxy) {
    this.seed = seed;
    this.galaxy = galaxy ?? generateGalaxy(seed);
    this.rng = new RNG(hash(seed, 0x5eed));
  }

  get sysData(): SystemData[] {
    return this.galaxy.systems;
  }

  // ------------------------------------------------------------------ creation
  static create(seed: number, playerName: string, startFaction: number, difficulty = 1): World {
    const w = new World(seed);
    w.initFactions();
    w.initTerritory();
    w.initRelations();
    w.initFleets();
    w.player = createPlayer(w, playerName, startFaction);
    w.reindexFleets();
    w.addNews(`A new captain, ${playerName}, registers a ship license.`, 'player', w.player.sys);
    void difficulty;
    return w;
  }

  private makeStyle(seed: number, species: ShipStyle['species'], shape: HullShape, colors: [string, string, string], tier: number, family: ShipStyle['family']): ShipStyle {
    return { seed, species, shape, colors, tier, family };
  }

  private initFactions(): void {
    const rng = new RNG(hash(this.seed, 0xfac));
    const systems = this.sysData;
    const taken: number[] = [];
    const farFrom = (id: number, min: number) => taken.every((t) => sysDist(systems[t], systems[id]) >= min);
    const pickCapital = (pred: (s: SystemData) => boolean, min: number): number => {
      const cands = systems.filter((s) => s.id !== 0 && pred(s)).map((s) => s.id);
      rng.shuffle(cands);
      for (let m = min; m > 10; m *= 0.8) for (const c of cands) if (farFrom(c, m)) { taken.push(c); return c; }
      const c = cands[0] ?? rng.int(1, systems.length - 1);
      taken.push(c);
      return c;
    };
    const baseFaction = (id: number, name: string, short: string, kind: Faction['kind'], species: Faction['species'], gov: string, color: string, capital: number, style: ShipStyle, desc: string): Faction => ({
      id, name, short, kind, species, gov, color, capital, style, desc,
      traits: { aggression: 0.5, expansion: 0.5, trade: 0.5, xenophobia: 0.5, honor: 0.5 },
      treasury: 20000, tech: 1, alive: true, relations: [], war: [], allies: [], exhaustion: {}, subs: [], parent: -1, founded: 0,
      illegal: [], jump: 24, kills: 0, losses: 0, systemsCount: 0, strength: 0,
    });

    // Player faction (index 0): owns colonies the player founds.
    this.factions.push(baseFaction(0, 'Independent Captain', 'You', 'player', 'human', 'Captain', '#ffffff', -1,
      this.makeStyle(1, 'human', 'wedge', ['#c8782a', '#3a3a44', '#60d0ff'], 1, 'mixed'), 'Your personal holdings.'));

    // Human powers
    const humanCount = 5;
    const shapes: HullShape[] = ['wedge', 'block', 'needle', 'hammer', 'wedge'];
    const families: ShipStyle['family'][] = ['energy', 'kinetic', 'mixed', 'energy', 'kinetic'];
    const govs = rng.shuffle([...GOVERNMENTS]);
    for (let i = 0; i < humanCount; i++) {
      const gov = govs[i % govs.length];
      const cap = pickCapital((s) => s.bestHab > 0.5 && Math.hypot(s.x, s.y) > 70 && Math.hypot(s.x, s.y) < 230 && s.neighbors.filter((n) => sysDist(s, systems[n]) < 20).length >= 5, 120);
      const root = starName(rng);
      const title = rng.pick(gov.titles);
      const name = rng.chance(0.5) ? `${root} ${title}` : `${title} of ${root}`;
      const color = FACTION_COLORS[i];
      const hull = shade(hslHex(rng.range(0, 360), rng.range(0.1, 0.35), rng.range(0.45, 0.6)), 0);
      const f = baseFaction(this.factions.length, name, root, 'human', 'human', gov.name, color, cap,
        this.makeStyle(hash(this.seed, i, 0x5717), 'human', shapes[i], [hull, shade(hull, -0.6), color], 1, families[i]),
        `${gov.name} government centred on ${systems[cap].name}.`);
      f.traits = {
        aggression: clamp(gov.aggression + rng.range(-0.15, 0.15), 0, 1), expansion: clamp(gov.expansion + rng.range(-0.15, 0.15), 0, 1),
        trade: clamp(gov.trade + rng.range(-0.15, 0.15), 0, 1), xenophobia: clamp(gov.xenophobia + rng.range(-0.15, 0.15), 0, 1),
        honor: clamp(gov.honor + rng.range(-0.15, 0.15), 0, 1),
      };
      f.tech = rng.int(2, 3);
      f.style.tier = f.tech;
      f.treasury = 60000 + rng.int(0, 40000);
      f.jump = 24;
      f.illegal = COMMODITIES.filter((c) => c.contrabandIn?.includes(gov.name)).map((c) => c.id);
      const roles: SubfactionRole[] = ['military', 'merchant', 'science'];
      roles.push(rng.pick(['intelligence', 'religious', 'separatist'] as SubfactionRole[]));
      if (gov.name === 'Theocracy' && !roles.includes('religious')) roles[3] = 'religious';
      f.subs = roles.map((role) => ({ role, name: rng.pick(SUBFACTION_TEMPLATES[role].names), loyalty: rng.range(55, 85), influence: rng.range(20, 60) }));
      this.factions.push(f);
    }

    // Aliens
    for (const arch of ALIENS) {
      const cap = pickCapital((s) => Math.hypot(s.x, s.y) > 170 && s.bestHab > 0.15, 150);
      const nm = alienName(rng, arch.species as 'hive' | 'synod' | 'automata');
      const title = arch.species === 'hive' ? 'Hive' : arch.species === 'synod' ? 'Synod' : 'Collective';
      const f = baseFaction(this.factions.length, `${nm} ${title}`, nm, 'alien', arch.species, arch.label, arch.color, cap,
        this.makeStyle(hash(this.seed, arch.species.length, 0xa1e), arch.species, arch.species === 'hive' ? 'organic' : arch.species === 'synod' ? 'crystal' : 'machine',
          [arch.hull, shade(arch.hull, -0.5), arch.accent], 3, arch.species as ShipStyle['family']), arch.desc);
      f.traits = { aggression: arch.aggression, expansion: arch.expansion, trade: arch.trade, xenophobia: arch.xenophobia, honor: arch.honor };
      f.tech = arch.species === 'synod' ? 4 : 3;
      f.treasury = 80000;
      f.jump = 30;
      this.factions.push(f);
    }

    // Pirate clans
    const pnames = rng.shuffle([...PIRATE_NAMES]);
    for (let i = 0; i < 4; i++) {
      const cap = pickCapital((s) => s.bestHab < 0.5 && Math.hypot(s.x, s.y) > 40, 70);
      const hull = rng.pick(['#7a4a30', '#5a5a5a', '#6a3a3a', '#4a4a3a']);
      const accent = rng.pick(['#ff4a2a', '#ffb02a', '#ff2a6a', '#c0ff2a']);
      const f = baseFaction(this.factions.length, `${pnames[i]} Clan`, pnames[i], 'pirate', 'human', 'Pirate Clan', accent, cap,
        this.makeStyle(hash(this.seed, i, 0x9a7), 'human', 'pirate', [hull, '#2a2420', accent], 2, 'pirate'),
        'Raiders and smugglers preying on trade lanes. They respect only strength and coin.');
      f.traits = { aggression: 0.9, expansion: 0.2, trade: 0.3, xenophobia: 0.2, honor: 0.1 };
      f.tech = 2;
      f.treasury = 15000;
      f.jump = 24;
      this.factions.push(f);
    }
    for (const f of this.factions) f.relations = this.factions.map(() => 0);
  }

  private initTerritory(): void {
    const rng = new RNG(hash(this.seed, 0x7e2));
    const systems = this.sysData;
    this.systems = systems.map((s) => ({
      owner: -1, pop: 0, econ: 'frontier', tech: 1, security: 0.1, defense: 0, maxDefense: 0, station: false, shipyard: false, military: false,
      stock: null, target: null, siege: null, unrest: 0, visited: false, scanned: [], lastBattle: -99, colony: -1, sub: -1,
    }));
    const budget: Record<number, number> = {};
    const frontier: Record<number, number[]> = {};
    for (const f of this.factions) {
      if (f.kind === 'player') continue;
      budget[f.id] = f.kind === 'human' ? rng.int(55, 90) : f.kind === 'alien' ? rng.int(35, 60) : rng.int(2, 4);
      this.systems[f.capital].owner = f.id;
      frontier[f.id] = [f.capital];
    }
    let progress = true;
    let round = 0;
    while (progress && round++ < 200) {
      progress = false;
      for (const f of this.factions) {
        if (f.kind === 'player' || budget[f.id] <= 1) continue;
        // pick the unclaimed neighbour closest to the capital among owned systems' neighbours
        let best = -1, bestScore = 1e9;
        const owned = frontier[f.id];
        for (let k = 0; k < Math.min(owned.length, 60); k++) {
          const sid = owned[owned.length - 1 - k];
          for (const n of systems[sid].neighbors) {
            const d = sysDist(systems[sid], systems[n]);
            if (d > (owned.length < 8 ? 30 : 22)) break;
            if (this.systems[n].owner !== -1 || n === 0) continue;
            const score = sysDist(systems[f.capital], systems[n]) - systems[n].bestHab * 20 + rng.next() * 10;
            if (score < bestScore) { bestScore = score; best = n; }
          }
        }
        if (best >= 0) {
          this.systems[best].owner = f.id;
          owned.push(best);
          budget[f.id]--;
          progress = true;
        } else budget[f.id] = 0;
      }
    }

    // Populate
    for (const s of systems) {
      const st = this.systems[s.id];
      const f = st.owner >= 0 ? this.factions[st.owner] : null;
      if (f) {
        const d = sysDist(s, systems[f.capital]);
        const isCap = f.capital === s.id;
        const core = Math.max(0.05, 1 - d / 120);
        st.pop = isCap ? rng.range(4000, 9000) : Math.max(0.5, Math.pow(core, 2) * s.bestHab * rng.range(300, 2500) + rng.range(0, 40));
        if (f.kind === 'pirate') st.pop = rng.range(2, 30);
        st.tech = clamp(f.tech + (isCap ? 1 : 0) - (core < 0.3 ? 1 : 0), 1, 5);
        st.econ = this.pickEconomy(s, f, rng, isCap);
        st.station = true;
        st.shipyard = isCap || (st.pop > 600 && rng.chance(0.6)) || (f.kind === 'pirate');
        st.military = isCap || rng.chance(f.traits.aggression * 0.12);
        st.security = f.kind === 'pirate' ? 0.05 : clamp(0.25 + core * 0.7, 0.1, 0.95);
        st.sub = f.subs.length ? rng.int(0, f.subs.length - 1) : -1;
      } else if (s.id !== 0 && rng.chance(0.13) && s.bestHab > 0.1) {
        st.pop = rng.range(0.5, 60);
        st.econ = s.richness.ore > 0.6 ? 'mining' : 'frontier';
        st.station = true;
        st.security = 0.1;
        st.tech = 1;
      }
      if (st.station) {
        st.maxDefense = this.baseDefense(st);
        st.defense = st.maxDefense;
        this.initMarket(s.id);
      }
    }
    for (const f of this.factions) this.recount(f);
  }

  baseDefense(st: SystemState): number {
    if (!st.station) return 0;
    return Math.round(20 + Math.pow(st.pop, 0.4) * 12 * st.tech + (st.military ? 250 : 0) + (st.shipyard ? 80 : 0));
  }

  private pickEconomy(s: SystemData, f: Faction, rng: RNG, isCap: boolean): EconomyType {
    if (f.kind === 'alien') return this.factions[f.id].species === 'hive' ? 'hive' : f.species === 'synod' ? 'crystal' : 'forge';
    if (f.kind === 'pirate') return 'pirate';
    if (isCap) return rng.pick(['hightech', 'industrial'] as EconomyType[]);
    const opts: EconomyType[] = [];
    const wts: number[] = [];
    const add = (e: EconomyType, w: number) => { opts.push(e); wts.push(w); };
    add('agricultural', s.richness.organics * 3 + s.bestHab * 2);
    add('mining', s.richness.ore * 3 + s.richness.crystals * 2);
    add('refinery', s.richness.ice * 1.5 + s.richness.gas * 2);
    add('industrial', 1.2);
    add('hightech', 0.6 + (f.tech - 1) * 0.3);
    add('military', f.traits.aggression * 1.2);
    add('research', s.special !== 'none' ? 2 : 0.4);
    add('tourism', s.bestHab > 0.8 ? 1 : 0.2);
    return rng.weighted(opts, wts);
  }

  initMarket(id: number): void {
    const st = this.systems[id];
    const prof = ECONOMY_PROFILE[st.econ];
    const rng = new RNG(hash(this.seed, id, 0x3a7));
    st.target = [];
    st.stock = [];
    for (const c of COMMODITIES) {
      const p = prof[c.key] ?? 0;
      const tgt = Math.round(120 + Math.sqrt(st.pop) * 6 + Math.abs(p) * 20);
      st.target.push(tgt);
      const f = p > 0 ? rng.range(1.3, 2.2) : p < 0 ? rng.range(0.25, 0.7) : rng.range(0.6, 1.1);
      st.stock.push(Math.round(tgt * f));
    }
  }

  private initRelations(): void {
    const rng = new RNG(hash(this.seed, 0x4e1));
    const fs = this.factions;
    for (const a of fs)
      for (const b of fs) {
        if (a.id >= b.id) continue;
        let r: number;
        if (a.kind === 'player' || b.kind === 'player') r = 0;
        else if (a.kind === 'pirate' || b.kind === 'pirate') r = a.kind === b.kind ? -10 : -70;
        else if (a.species === 'hive' || b.species === 'hive') r = -95;
        else if (a.species === 'automata' || b.species === 'automata') r = -55 + rng.range(-10, 10);
        else if (a.kind === 'alien' || b.kind === 'alien') r = rng.range(-25, 15) - (a.traits.xenophobia + b.traits.xenophobia) * 15;
        else r = rng.range(-35, 45) - (a.traits.aggression + b.traits.aggression - 1) * 20;
        a.relations[b.id] = r;
        b.relations[a.id] = r;
      }
    // Initial wars
    const humans = fs.filter((f) => f.kind === 'human');
    const pairs: [Faction, Faction][] = [];
    for (const a of humans) for (const b of humans) if (a.id < b.id) pairs.push([a, b]);
    pairs.sort((x, y) => x[0].relations[x[1].id] - y[0].relations[y[1].id]);
    for (const [a, b] of pairs.slice(0, 1)) this.declareWar(a, b, true);
    for (const f of fs) {
      if (f.species === 'hive' || f.species === 'automata') {
        for (const o of fs) if (o.id !== f.id && o.kind !== 'player' && o.kind !== 'pirate' && o.species !== f.species && this.bordering(f, o)) this.declareWar(f, o, true);
      }
    }
    // Some friendly pairs become allies
    for (const [a, b] of pairs.slice(-1)) if (a.relations[b.id] > 20) this.makeAlliance(a, b, true);
  }

  private initFleets(): void {
    for (const f of this.factions) {
      if (f.kind === 'player') continue;
      const owned = this.ownedSystems(f.id);
      const n = f.kind === 'pirate' ? 4 : Math.min(14, 3 + Math.floor(owned.length / 6));
      for (let i = 0; i < n; i++) {
        const sys = this.rng.pick(owned.length ? owned : [f.capital]);
        const role: FleetRole = f.kind === 'pirate' ? 'pirate' : i % 3 === 0 ? 'patrol' : i % 3 === 1 && f.traits.trade > 0.2 ? 'trade' : 'patrol';
        this.spawnFleet(f.id, role, sys);
      }
      if (f.war.length) for (let i = 0; i < 2; i++) this.spawnFleet(f.id, 'war', f.capital);
    }
  }

  // ------------------------------------------------------------------ helpers
  faction(id: number): Faction {
    return this.factions[id];
  }

  ownedSystems(fid: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.systems.length; i++) if (this.systems[i].owner === fid) out.push(i);
    return out;
  }

  recount(f: Faction): void {
    let n = 0;
    for (const s of this.systems) if (s.owner === f.id) n++;
    f.systemsCount = n;
    f.strength = this.fleets.filter((fl) => fl.faction === f.id).reduce((a, fl) => a + fl.strength, 0);
  }

  private borderDay = -1;
  private borderSet = new Set<number>();

  /** Whether two factions share a border (cached once per day). */
  bordering(a: Faction, b: Faction): boolean {
    const day = Math.floor(this.day);
    if (day !== this.borderDay) {
      this.borderDay = day;
      this.borderSet.clear();
      for (let i = 0; i < this.systems.length; i++) {
        const o = this.systems[i].owner;
        if (o < 0) continue;
        for (const n of this.sysData[i].neighbors) {
          if (sysDist(this.sysData[i], this.sysData[n]) > 30) break;
          const o2 = this.systems[n].owner;
          if (o2 >= 0 && o2 !== o) this.borderSet.add(o * 1000 + o2);
        }
      }
    }
    return this.borderSet.has(a.id * 1000 + b.id) || this.borderSet.has(b.id * 1000 + a.id);
  }

  /** Whether two factions will shoot at each other. Faction 0 is the player. */
  hostile(a: number, b: number): boolean {
    if (a === b || a < 0 || b < 0) return false;
    if (a === 0 || b === 0) {
      const o = a === 0 ? b : a;
      return this.player.rep[o] <= HOSTILE_REP;
    }
    const fa = this.factions[a], fb = this.factions[b];
    if (fa.kind === 'pirate' && fb.kind === 'pirate') return false;
    if (fa.kind === 'pirate' || fb.kind === 'pirate') return true;
    return fa.war.includes(b);
  }

  declareWar(a: Faction, b: Faction, silent = false): void {
    if (a.war.includes(b.id) || a.id === b.id) return;
    a.war.push(b.id);
    b.war.push(a.id);
    a.allies = a.allies.filter((x) => x !== b.id);
    b.allies = b.allies.filter((x) => x !== a.id);
    a.exhaustion[b.id] = 0;
    b.exhaustion[a.id] = 0;
    a.relations[b.id] = Math.min(a.relations[b.id], -60);
    b.relations[a.id] = a.relations[b.id];
    this.stats.wars++;
    if (!silent) {
      this.addNews(`WAR! ${a.name} has declared war on ${b.name}.`, 'war', a.capital);
      // allies join
      for (const al of b.allies) {
        const af = this.factions[al];
        if (af.alive && !af.war.includes(a.id) && af.id !== a.id) this.declareWar(af, a, true), this.addNews(`${af.name} honours its alliance and joins the war against ${a.name}.`, 'war', af.capital);
      }
    }
  }

  makePeace(a: Faction, b: Faction): void {
    a.war = a.war.filter((x) => x !== b.id);
    b.war = b.war.filter((x) => x !== a.id);
    a.relations[b.id] = Math.max(a.relations[b.id], -20);
    b.relations[a.id] = a.relations[b.id];
    for (const s of this.systems) if (s.siege && ((s.owner === a.id && s.siege.by === b.id) || (s.owner === b.id && s.siege.by === a.id))) s.siege = null;
    this.addNews(`PEACE: ${a.name} and ${b.name} sign an armistice.`, 'peace', a.capital);
  }

  makeAlliance(a: Faction, b: Faction, silent = false): void {
    if (a.allies.includes(b.id)) return;
    a.allies.push(b.id);
    b.allies.push(a.id);
    if (!silent) this.addNews(`ALLIANCE: ${a.name} and ${b.name} form a defensive pact.`, 'alliance', a.capital);
  }

  addNews(text: string, kind: NewsKind, sys = -1): void {
    this.news.unshift({ day: this.day, text, kind, sys });
    if (this.news.length > 200) this.news.length = 200;
    bus.emit('news', this.news[0]);
  }

  // ------------------------------------------------------------------ ships
  design(fid: number, cls: ShipClass, v = 0): ShipDesign {
    const f = this.factions[fid] ?? this.factions[0];
    const key = `${fid}:${cls}:${v % 2}:${f.style.tier}`;
    let d = this.designCache.get(key);
    if (!d) {
      const nm = `${f.short} ${CLASS_LABEL[cls]}${v % 2 ? ' II' : ''}`;
      d = generateDesign(f.style, cls, v % 2, key, nm);
      this.designCache.set(key, d);
    }
    return d;
  }

  designStats(fid: number, cls: ShipClass, v = 0): ShipStats {
    const d = this.design(fid, cls, v);
    let s = this.statsCache.get(d.key);
    if (!s) {
      s = computeStats(d);
      this.statsCache.set(d.key, s);
    }
    return s;
  }

  shipStrength(fid: number, sh: FleetShip): number {
    return this.designStats(fid, sh.cls, sh.v).strength * sh.hp;
  }

  fleetStrength(fl: Fleet): number {
    let s = 0;
    for (const sh of fl.ships) s += this.shipStrength(fl.faction, sh);
    return s;
  }

  composition(f: Faction, role: FleetRole, budget = 1): FleetShip[] {
    const r = this.rng;
    const t = f.tech;
    const ships: FleetShip[] = [];
    const add = (cls: ShipClass, n = 1) => { for (let i = 0; i < n; i++) ships.push({ cls, v: r.int(0, 1), hp: 1 }); };
    switch (role) {
      case 'patrol':
        add(r.pick(['corvette', 'frigate'] as ShipClass[]));
        add('fighter', r.int(1, 2));
        if (r.chance(0.3)) add('corvette');
        break;
      case 'war':
      case 'defense': {
        const big = Math.max(1, Math.round(budget * r.range(1, 3)));
        add('frigate', r.int(1, 2));
        add('destroyer', Math.min(3, big));
        if (t >= 3 || budget > 1.5) add('cruiser', r.int(0, t >= 3 ? 2 : 1));
        if (t >= 4 && r.chance(0.4)) add('battleship');
        add('corvette', r.int(0, 2));
        add('fighter', r.int(1, 3));
        break;
      }
      case 'trade':
      case 'convoy':
        add('freighter', r.int(1, 2));
        if (r.chance(0.6)) add(r.pick(['corvette', 'fighter'] as ShipClass[]));
        break;
      case 'colony':
        add('colony');
        add('corvette');
        break;
      case 'pirate':
        add(r.pick(['corvette', 'frigate', 'corvette'] as ShipClass[]));
        add('fighter', r.int(1, 3));
        if (r.chance(0.35)) add('frigate');
        if (r.chance(0.12)) add('destroyer');
        break;
      case 'explore':
        add('scout');
        break;
      case 'mining':
        add('miner', r.int(1, 2));
        break;
      case 'bounty':
        add(r.pick(['frigate', 'destroyer'] as ShipClass[]));
        add('corvette', r.int(0, 2));
        add('fighter', r.int(1, 2));
        break;
    }
    return ships;
  }

  fleetCost(fid: number, ships: FleetShip[]): number {
    let c = 0;
    for (const s of ships) c += Math.round(this.designStats(fid, s.cls, s.v).cost * 0.6);
    return c;
  }

  spawnFleet(fid: number, role: FleetRole, sys: number, ships?: FleetShip[]): Fleet {
    const f = this.factions[fid];
    const sh = ships ?? this.composition(f, role);
    const fl: Fleet = {
      id: this.nextFleetId++, faction: fid, role, name: this.fleetName(f, role), ships: sh, sys, dest: -1, route: [], progress: 0, hopDays: 0,
      target: -1, wait: this.rng.int(0, 3), cargo: null, captain: personName(this.rng), mission: '', strength: 0, morale: 1,
    };
    fl.strength = this.fleetStrength(fl);
    this.fleets.push(fl);
    this.addToIndex(fl);
    return fl;
  }

  fleetName(f: Faction, role: FleetRole): string {
    const r = this.rng;
    switch (role) {
      case 'war': return `${f.short} ${r.int(1, 19)}${['st', 'nd', 'rd', 'th'][Math.min(3, r.int(0, 3))]} Battle Group`;
      case 'defense': return `${f.short} Home Guard`;
      case 'patrol': return `${f.short} Patrol ${String.fromCharCode(65 + r.int(0, 25))}-${r.int(1, 99)}`;
      case 'trade': case 'convoy': return `${cap(starName(r))} Freight`;
      case 'colony': return `${f.short} Colony Expedition`;
      case 'pirate': return `${f.short} Raiders`;
      case 'explore': return `${f.short} Survey Team`;
      case 'mining': return `${f.short} Mining Co.`;
      case 'bounty': return `${f.short} Marauders`;
    }
  }

  removeFleet(fl: Fleet): void {
    this.fleets = this.fleets.filter((x) => x !== fl);
    this.removeFromIndex(fl);
  }

  reindexFleets(): void {
    this.fleetsBySys.clear();
    for (const fl of this.fleets) this.addToIndex(fl);
  }

  addToIndex(fl: Fleet): void {
    if (fl.dest >= 0) return;
    let arr = this.fleetsBySys.get(fl.sys);
    if (!arr) this.fleetsBySys.set(fl.sys, (arr = []));
    arr.push(fl);
  }

  removeFromIndex(fl: Fleet): void {
    const arr = this.fleetsBySys.get(fl.sys);
    if (!arr) return;
    const i = arr.indexOf(fl);
    if (i >= 0) arr.splice(i, 1);
  }

  fleetsAt(sys: number): Fleet[] {
    return this.fleetsBySys.get(sys) ?? [];
  }

  route(from: number, to: number, jump: number, fid = -1): number[] | null {
    return findRoute(this.galaxy, from, to, jump, fid >= 0 ? (n) => {
      const o = this.systems[n].owner;
      return o >= 0 && this.hostile(fid, o) ? 30 : 0;
    } : undefined);
  }

  // ------------------------------------------------------------------ market
  price(sys: number, c: number): number {
    const st = this.systems[sys];
    if (!st.stock || !st.target) return COMMODITIES[c].base;
    const ratio = st.target[c] / Math.max(1, st.stock[c] + st.target[c] * 0.08);
    let p = COMMODITIES[c].base * clamp(Math.pow(ratio, 0.55), 0.32, 3.2);
    const owner = st.owner >= 0 ? this.factions[st.owner] : null;
    if (owner?.illegal.includes(c)) p *= 1.8;
    if (st.siege) p *= 1.25;
    return Math.max(1, Math.round(p));
  }

  buyPrice(sys: number, c: number): number {
    const tradeSkill = this.player?.skills.trading ?? 0;
    return Math.max(1, Math.round(this.price(sys, c) * (1.05 - tradeSkill * 0.008)));
  }

  sellPrice(sys: number, c: number): number {
    const tradeSkill = this.player?.skills.trading ?? 0;
    return Math.max(1, Math.round(this.price(sys, c) * (0.95 + tradeSkill * 0.008)));
  }

  isIllegal(sys: number, c: number): boolean {
    const o = this.systems[sys].owner;
    return o > 0 && this.factions[o].illegal.includes(c);
  }

  // ------------------------------------------------------------------ persistence
  toSave(): WorldSave {
    return {
      version: SAVE_VERSION, seed: this.seed, day: this.day, systems: this.systems, factions: this.factions, fleets: this.fleets, nextFleetId: this.nextFleetId,
      news: this.news, colonies: this.colonies, player: this.player, rng: this.rng.getState(), boards: this.boards, stats: this.stats, realTime: Date.now(),
    };
  }

  static fromSave(s: WorldSave, galaxy?: Galaxy): World {
    const w = new World(s.seed, galaxy);
    w.day = s.day;
    w.systems = s.systems;
    w.factions = s.factions;
    w.fleets = s.fleets;
    w.nextFleetId = s.nextFleetId;
    w.news = s.news;
    w.colonies = s.colonies ?? [];
    w.player = s.player;
    w.rng.setState(s.rng);
    w.boards = s.boards ?? {};
    w.stats = s.stats ?? { wars: 0, captures: 0, colonies: 0 };
    w.realTime = s.realTime ?? Date.now();
    w.reindexFleets();
    return w;
  }
}

export function commodityIndex(key: string): number {
  return C[key];
}

export { NUM_COMMODITIES };
