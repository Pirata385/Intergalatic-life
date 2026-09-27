// Autonomous faction and fleet behaviour for the background simulation.
import type { World } from './world';
import type { Fleet, Faction, FleetRole } from './types';
import { sysDist, systemsNear } from '../gen/galaxy';
import { COMMODITIES, ECONOMY_PROFILE } from '../data/commodities';
import { clamp } from '../core/math';
import { SUBFACTION_TEMPLATES, FACTION_COLORS } from '../data/factions';
import { starName } from '../core/names';

export const LY_PER_DAY = 9;

export function startRoute(w: World, fl: Fleet, target: number): boolean {
  if (target === fl.sys) return false;
  const f = w.factions[fl.faction];
  const r = w.route(fl.sys, target, f.jump, fl.faction);
  if (!r || r.length < 2) return false;
  fl.route = r.slice(1);
  fl.target = target;
  startHop(w, fl);
  return true;
}

function startHop(w: World, fl: Fleet): void {
  const next = fl.route[0];
  w.removeFromIndex(fl);
  fl.dest = next;
  fl.progress = 0;
  fl.hopDays = Math.max(0.6, sysDist(w.sysData[fl.sys], w.sysData[next]) / LY_PER_DAY);
}

export function moveFleets(w: World, days: number, onArrive: (fl: Fleet) => void): void {
  for (const fl of [...w.fleets]) {
    if (fl.dest < 0) continue;
    fl.progress += days / fl.hopDays;
    if (fl.progress >= 1) {
      fl.sys = fl.dest;
      fl.dest = -1;
      fl.progress = 0;
      fl.route.shift();
      w.addToIndex(fl);
      if (fl.route.length) startHop(w, fl);
      else onArrive(fl);
    }
  }
}

/** Where on the galaxy map a fleet currently is. */
export function fleetPos(w: World, fl: Fleet): { x: number; y: number } {
  const a = w.sysData[fl.sys];
  if (fl.dest < 0) return { x: a.x, y: a.y };
  const b = w.sysData[fl.dest];
  return { x: a.x + (b.x - a.x) * fl.progress, y: a.y + (b.y - a.y) * fl.progress };
}

// ------------------------------------------------------------------ fleet decisions
export function decideFleet(w: World, fl: Fleet): void {
  const f = w.factions[fl.faction];
  if (!f.alive) return;
  const rng = w.rng;
  switch (fl.role) {
    case 'patrol': {
      const threat = findThreat(w, f, fl.sys, 45);
      if (threat >= 0 && threat !== fl.sys) { startRoute(w, fl, threat); fl.wait = 2; return; }
      const near = systemsNear(w.galaxy, w.sysData[fl.sys].x, w.sysData[fl.sys].y, 50).filter((s) => w.systems[s].owner === f.id);
      if (near.length) startRoute(w, fl, rng.pick(near));
      fl.wait = rng.int(2, 5);
      return;
    }
    case 'war': {
      if (!f.war.length) {
        if (fl.sys !== f.capital && w.systems[f.capital].owner === f.id) startRoute(w, fl, f.capital);
        else fl.role = 'patrol';
        fl.wait = 3;
        return;
      }
      const tgt = pickWarTarget(w, f, fl);
      if (tgt >= 0 && tgt !== fl.sys) startRoute(w, fl, tgt);
      fl.wait = rng.int(3, 6);
      return;
    }
    case 'trade':
    case 'convoy':
      tradeDecision(w, fl);
      return;
    case 'colony': {
      const tgt = pickColonyTarget(w, f, fl.sys);
      if (tgt < 0) { fl.role = 'patrol'; return; }
      startRoute(w, fl, tgt);
      fl.wait = 1;
      return;
    }
    case 'pirate': {
      const base = f.capital;
      if (fl.cargo && fl.sys !== base) { startRoute(w, fl, base); return; }
      if (fl.cargo && fl.sys === base) {
        const st = w.systems[base];
        if (st.stock) st.stock[fl.cargo.c] += fl.cargo.q;
        f.treasury += fl.cargo.q * COMMODITIES[fl.cargo.c].base * 0.5;
        fl.cargo = null;
      }
      const near = systemsNear(w.galaxy, w.sysData[base].x, w.sysData[base].y, 70).filter((s) => w.systems[s].station && w.systems[s].owner !== fl.faction);
      near.sort((a, b) => w.systems[a].security - w.systems[b].security);
      const pick = near.slice(0, 12);
      if (pick.length) startRoute(w, fl, rng.pick(pick));
      fl.wait = rng.int(3, 8);
      return;
    }
    case 'explore': {
      const s = w.sysData[fl.sys];
      const near = systemsNear(w.galaxy, s.x, s.y, 80).filter((id) => w.systems[id].owner === -1);
      if (near.length) startRoute(w, fl, rng.pick(near));
      fl.wait = rng.int(2, 5);
      if (rng.chance(0.03)) {
        f.tech = Math.min(5, f.tech + (rng.chance(0.3) ? 1 : 0));
        w.addNews(`${f.name} explorers report ancient ruins near ${s.name}.`, 'discovery', s.id);
      }
      return;
    }
    case 'mining': {
      const owned = w.ownedSystems(f.id).filter((id) => w.sysData[id].richness.ore > 0.5 || w.sysData[id].richness.ice > 0.5);
      if (owned.length) {
        const t = rng.pick(owned);
        if (t !== fl.sys) startRoute(w, fl, t);
        else {
          const st = w.systems[t];
          if (st.stock) { st.stock[2] += 25; st.stock[3] += 12; }
        }
      }
      fl.wait = rng.int(3, 7);
      return;
    }
    case 'defense':
    case 'bounty':
      fl.wait = 10;
      return;
  }
}

function findThreat(w: World, f: Faction, from: number, radius: number): number {
  const s = w.sysData[from];
  let best = -1, bd = 1e9;
  for (const id of systemsNear(w.galaxy, s.x, s.y, radius)) {
    if (w.systems[id].owner !== f.id) continue;
    for (const o of w.fleetsAt(id)) {
      if (w.hostile(f.id, o.faction) && o.faction !== 0) {
        const d = sysDist(s, w.sysData[id]);
        if (d < bd) { bd = d; best = id; }
      }
    }
  }
  return best;
}

function pickWarTarget(w: World, f: Faction, fl: Fleet): number {
  // Defend first: sieged own systems
  let best = -1, bestScore = -1e9;
  const here = w.sysData[fl.sys];
  for (let id = 0; id < w.systems.length; id++) {
    const st = w.systems[id];
    if (st.owner === f.id && st.siege && f.war.includes(st.siege.by)) {
      const sc = 1000 - sysDist(here, w.sysData[id]);
      if (sc > bestScore) { bestScore = sc; best = id; }
    }
  }
  if (best >= 0) return best;
  // Attack enemy systems near our border
  for (const enemyId of f.war) {
    const e = w.factions[enemyId];
    if (!e.alive) continue;
    for (let id = 0; id < w.systems.length; id++) {
      if (w.systems[id].owner !== enemyId) continue;
      const d = sysDist(here, w.sysData[id]);
      if (d > 140) continue;
      const st = w.systems[id];
      const sc = -d - st.defense * 0.05 + (st.siege?.by === f.id ? 200 : 0) + (id === e.capital ? -40 : 0) + w.rng.next() * 25;
      if (sc > bestScore) { bestScore = sc; best = id; }
    }
  }
  return best;
}

function pickColonyTarget(w: World, f: Faction, from: number): number {
  const s = w.sysData[from];
  let best = -1, bs = -1e9;
  for (const id of systemsNear(w.galaxy, s.x, s.y, 70)) {
    const st = w.systems[id];
    if (st.owner !== -1 || id === 0 || st.colony >= 0) continue;
    const d = w.sysData[id];
    // Must border our territory
    const borders = d.neighbors.some((n) => w.systems[n].owner === f.id && sysDist(d, w.sysData[n]) < 26);
    if (!borders) continue;
    const sc = d.bestHab * 60 + d.richness.ore * 15 - sysDist(s, d) * 0.3 + (st.pop > 0 ? -30 : 0);
    if (sc > bs) { bs = sc; best = id; }
  }
  return best;
}

function tradeDecision(w: World, fl: Fleet): void {
  const f = w.factions[fl.faction];
  const cap = fl.ships.reduce((a, s) => a + (s.cls === 'freighter' ? 120 : 10), 0);
  if (fl.cargo) {
    // Arrived with goods? sell if at target
    if (fl.sys === fl.target) {
      const st = w.systems[fl.sys];
      if (st.stock) {
        st.stock[fl.cargo.c] += fl.cargo.q;
        const earned = w.price(fl.sys, fl.cargo.c) * fl.cargo.q;
        f.treasury += (earned - fl.cargo.buy) * 0.6 + earned * 0.05;
      }
      fl.cargo = null;
      fl.wait = w.rng.int(1, 3);
      return;
    }
    if (!startRoute(w, fl, fl.target)) fl.cargo = null;
    return;
  }
  const src = fl.sys;
  const sst = w.systems[src];
  if (!sst.stock) {
    const home = w.ownedSystems(f.id);
    if (home.length) startRoute(w, fl, w.rng.pick(home));
    fl.wait = 2;
    return;
  }
  const s = w.sysData[src];
  let best: { dst: number; c: number; q: number; profit: number } | null = null;
  for (const dst of systemsNear(w.galaxy, s.x, s.y, 75)) {
    if (dst === src) continue;
    const dst_ = w.systems[dst];
    if (!dst_.stock) continue;
    if (dst_.owner >= 0 && w.hostile(f.id, dst_.owner)) continue;
    const dist = sysDist(s, w.sysData[dst]);
    for (let c = 0; c < COMMODITIES.length - 1; c++) {
      if (f.illegal.includes(c)) continue;
      const q = Math.min(cap, Math.floor(sst.stock[c] * 0.35));
      if (q < 10) continue;
      const margin = w.price(dst, c) - w.price(src, c);
      const profit = margin * q - dist * 4;
      if (!best || profit > best.profit) best = { dst, c, q, profit };
    }
  }
  if (best && best.profit > 200) {
    sst.stock[best.c] -= best.q;
    fl.cargo = { c: best.c, q: best.q, buy: w.price(src, best.c) * best.q };
    startRoute(w, fl, best.dst);
  } else {
    // wander to another friendly market
    const near = systemsNear(w.galaxy, s.x, s.y, 50).filter((id) => w.systems[id].stock && !(w.systems[id].owner >= 0 && w.hostile(f.id, w.systems[id].owner)));
    if (near.length) startRoute(w, fl, w.rng.pick(near));
    fl.wait = w.rng.int(1, 4);
  }
}

// ------------------------------------------------------------------ arrivals
export function onFleetArrive(w: World, fl: Fleet): void {
  const st = w.systems[fl.sys];
  const f = w.factions[fl.faction];
  fl.wait = Math.max(fl.wait, 1);
  if (fl.role === 'colony' && st.owner === -1 && fl.sys !== 0) {
    st.owner = f.id;
    st.pop = Math.max(st.pop, w.rng.range(0.4, 3));
    st.econ = f.kind === 'alien' ? (f.species === 'hive' ? 'hive' : f.species === 'synod' ? 'crystal' : 'forge') : 'frontier';
    st.station = true;
    st.tech = Math.max(1, f.tech - 1);
    st.security = 0.2;
    st.maxDefense = w.baseDefense(st);
    st.defense = st.maxDefense;
    if (!st.stock) w.initMarket(fl.sys);
    w.stats.colonies++;
    w.addNews(`${f.name} establishes a new colony at ${w.sysData[fl.sys].name}.`, 'colony', fl.sys);
    // colony ship consumed; escorts become a patrol
    fl.ships = fl.ships.filter((s) => s.cls !== 'colony');
    fl.role = 'patrol';
    fl.strength = w.fleetStrength(fl);
    if (!fl.ships.length) w.removeFleet(fl);
    w.recount(f);
  }
}

// ------------------------------------------------------------------ battles & sieges
export function resolveBattles(w: World, skipSys: number): void {
  for (const [sys, fleets] of w.fleetsBySys) {
    if (sys === skipSys || fleets.length === 0) continue;
    const st = w.systems[sys];
    // group fleets by faction
    const byFaction = new Map<number, Fleet[]>();
    for (const fl of fleets) {
      if (!byFaction.has(fl.faction)) byFaction.set(fl.faction, []);
      byFaction.get(fl.faction)!.push(fl);
    }
    const factions = [...byFaction.keys()];
    const fought = new Set<string>();
    for (const a of factions) {
      for (const b of factions) {
        if (a >= b || !w.hostile(a, b)) continue;
        const key = a + ':' + b;
        if (fought.has(key)) continue;
        fought.add(key);
        battle(w, sys, byFaction.get(a)!, byFaction.get(b)!, st.owner === a ? st.defense : st.owner === b ? 0 : 0, st.owner === b ? st.defense : 0);
      }
    }
    // Sieges: hostile war/pirate fleets vs system owner
    if (st.owner >= 0 && st.station) {
      const attackers = w.fleetsAt(sys).filter((fl) => w.hostile(fl.faction, st.owner) && fl.faction !== 0 && (fl.role === 'war' || fl.role === 'pirate' || fl.role === 'bounty'));
      const defenders = w.fleetsAt(sys).filter((fl) => fl.faction === st.owner || w.factions[st.owner]?.allies.includes(fl.faction));
      if (attackers.length) {
        const atk = attackers.reduce((s, f) => s + f.strength, 0);
        if (!defenders.length) {
          // bombard the station defenses
          const dmg = atk * w.rng.range(0.08, 0.16);
          const ret = st.defense * w.rng.range(0.03, 0.07);
          st.defense = Math.max(0, st.defense - dmg);
          damageFleets(w, attackers, ret);
          const leader = attackers[0];
          const lf = w.factions[leader.faction];
          if (lf.kind === 'pirate') {
            // pirates raid rather than conquer
            if (st.stock) for (let c = 0; c < st.stock.length; c++) st.stock[c] *= 0.97;
            st.unrest = Math.min(100, st.unrest + 3);
            if (!leader.cargo) leader.cargo = { c: w.rng.int(0, 13), q: w.rng.int(20, 80), buy: 0 };
            leader.wait = 1;
          } else if (st.defense <= 0) {
            if (!st.siege || st.siege.by !== leader.faction) st.siege = { by: leader.faction, progress: 0 };
            st.siege.progress += 4 + Math.min(10, atk / 250);
            if (st.siege.progress >= 100) captureSystem(w, sys, leader.faction);
          }
        }
      } else if (st.siege) {
        st.siege.progress -= 10;
        if (st.siege.progress <= 0) st.siege = null;
      }
    }
  }
  w.fleets = w.fleets.filter((fl) => fl.ships.length > 0);
  w.reindexFleets();
}

function damageFleets(w: World, fleets: Fleet[], dmg: number): number {
  let destroyed = 0;
  let remaining = dmg;
  for (const fl of fleets) {
    for (const sh of fl.ships) {
      if (remaining <= 0) break;
      const s = w.designStats(fl.faction, sh.cls, sh.v).strength;
      const take = Math.min(sh.hp * s, remaining * w.rng.range(0.3, 0.8));
      sh.hp -= take / Math.max(1, s);
      remaining -= take;
    }
    const before = fl.ships.length;
    fl.ships = fl.ships.filter((sh) => sh.hp > 0.08);
    destroyed += before - fl.ships.length;
    w.factions[fl.faction].losses += before - fl.ships.length;
    fl.strength = w.fleetStrength(fl);
  }
  return destroyed;
}

function battle(w: World, sys: number, A: Fleet[], B: Fleet[], defA: number, defB: number): void {
  const sa0 = A.reduce((s, f) => s + f.strength, 0) + defA * 0.5;
  const sb0 = B.reduce((s, f) => s + f.strength, 0) + defB * 0.5;
  if (sa0 <= 0 || sb0 <= 0) return;
  let sa = sa0, sb = sb0;
  let lostA = 0, lostB = 0;
  for (let round = 0; round < 3; round++) {
    const da = sa * w.rng.range(0.12, 0.26);
    const db = sb * w.rng.range(0.12, 0.26);
    lostB += damageFleets(w, B, da);
    lostA += damageFleets(w, A, db);
    sa = A.reduce((s, f) => s + f.strength, 0) + defA * 0.5;
    sb = B.reduce((s, f) => s + f.strength, 0) + defB * 0.5;
    if (sa < sa0 * 0.35 || sb < sb0 * 0.35) break;
  }
  const fa = w.factions[A[0].faction], fb = w.factions[B[0].faction];
  fa.kills += lostB;
  fb.kills += lostA;
  if (fa.war.includes(fb.id)) {
    fa.exhaustion[fb.id] = (fa.exhaustion[fb.id] ?? 0) + lostA * 3;
    fb.exhaustion[fa.id] = (fb.exhaustion[fa.id] ?? 0) + lostB * 3;
  }
  w.systems[sys].lastBattle = w.day;
  const loser = sa < sb ? A : B;
  // Loser retreats
  for (const fl of loser) {
    if (!fl.ships.length) continue;
    const home = w.factions[fl.faction].capital;
    if (home >= 0 && home !== sys) startRoute(w, fl, home);
  }
  // Pirates robbing traders
  const pirates = [...A, ...B].filter((f) => w.factions[f.faction].kind === 'pirate' && f.ships.length);
  for (const pf of pirates) {
    for (const tf of [...A, ...B]) {
      if (tf.cargo && (tf.role === 'trade' || tf.role === 'convoy') && w.factions[tf.faction].kind !== 'pirate') {
        pf.cargo = { ...tf.cargo };
        tf.cargo = null;
        w.addNews(`${w.factions[pf.faction].name} raiders plundered a ${w.factions[tf.faction].short} convoy near ${w.sysData[sys].name}.`, 'pirate', sys);
      }
    }
  }
  if (lostA + lostB >= 4) {
    const winner = loser === A ? fb : fa;
    const lf = loser === A ? fa : fb;
    w.addNews(`Battle of ${w.sysData[sys].name}: ${winner.name} defeats ${lf.name} (${lostA + lostB} ships lost).`, 'battle', sys);
  }
}

export function captureSystem(w: World, sys: number, by: number): void {
  const st = w.systems[sys];
  const old = st.owner >= 0 ? w.factions[st.owner] : null;
  const nf = w.factions[by];
  const name = w.sysData[sys].name;
  st.owner = by;
  st.siege = null;
  st.unrest = 70;
  st.defense = st.maxDefense * 0.3;
  st.sub = nf.subs.length ? w.rng.int(0, nf.subs.length - 1) : -1;
  if (nf.species === 'hive') {
    st.pop *= 0.3;
    st.econ = 'hive';
    w.initMarket(sys);
    w.addNews(`HORROR: The ${nf.name} has overrun ${name}. The population is being consumed.`, 'alien', sys);
  } else if (nf.species === 'automata') {
    st.pop *= 0.5;
    st.econ = 'forge';
    w.initMarket(sys);
    w.addNews(`${nf.name} machines assimilate ${name} into a forge world.`, 'alien', sys);
  } else {
    st.pop *= 0.8;
    w.addNews(`${nf.name} captures ${name}${old ? ' from ' + old.name : ''}.`, 'capture', sys);
  }
  w.stats.captures++;
  if (old) {
    old.exhaustion[by] = (old.exhaustion[by] ?? 0) + 15;
    if (old.capital === sys) {
      const rest = w.ownedSystems(old.id);
      if (rest.length) {
        rest.sort((a, b) => w.systems[b].pop - w.systems[a].pop);
        old.capital = rest[0];
        w.addNews(`${old.name} relocates its capital to ${w.sysData[rest[0]].name}.`, 'capture', rest[0]);
      }
    }
    w.recount(old);
    if (old.systemsCount === 0 && old.kind !== 'player') destroyFaction(w, old, nf);
  }
  if (st.colony >= 0) {
    const col = w.colonies.find((c) => c.id === st.colony);
    if (col && col.owner === 0) {
      col.owner = by;
      w.addNews(`Your colony ${col.name} has been captured by ${nf.name}!`, 'player', sys);
    }
  }
  w.recount(nf);
}

function destroyFaction(w: World, f: Faction, by: Faction): void {
  f.alive = false;
  for (const o of w.factions) {
    o.war = o.war.filter((x) => x !== f.id);
    o.allies = o.allies.filter((x) => x !== f.id);
  }
  f.war = [];
  for (const fl of w.fleets) if (fl.faction === f.id) fl.ships = [];
  w.addNews(`The ${f.name} has fallen. ${by.name} stands victorious.`, 'war', by.capital);
}

// ------------------------------------------------------------------ faction strategy
export function factionDaily(w: World, f: Faction): void {
  if (!f.alive || f.kind === 'player') return;
  const owned = w.ownedSystems(f.id);
  f.systemsCount = owned.length;
  // Income
  let income = 0;
  for (const id of owned) {
    const st = w.systems[id];
    income += Math.sqrt(st.pop) * 1.6 * (0.8 + st.tech * 0.15) * (st.siege ? 0.4 : 1) * (1 - st.unrest / 200);
    if (st.defense < st.maxDefense) st.defense = Math.min(st.maxDefense, st.defense + st.maxDefense * 0.04);
    st.unrest = Math.max(0, st.unrest - 0.5);
  }
  if (f.kind === 'pirate') income += 80;
  const myFleets = w.fleets.filter((fl) => fl.faction === f.id);
  const upkeep = myFleets.reduce((a, fl) => a + fl.ships.length * 4, 0);
  f.treasury += income - upkeep;
  f.strength = myFleets.reduce((a, fl) => a + fl.strength, 0);
  // Bankrupt factions decommission fleets; rich ones fortify their worlds.
  if (f.treasury < -5000 && myFleets.length) {
    const victim = myFleets.find((fl) => fl.role !== 'war' && fl.role !== 'defense' && fl.mission === '') ?? myFleets[0];
    if (!victim.mission) w.removeFleet(victim);
    f.treasury += 2000;
  }
  if (f.treasury > 250000 && owned.length) {
    const id = w.rng.pick(owned);
    const st = w.systems[id];
    st.maxDefense = Math.round(st.maxDefense * 1.15 + 50);
    st.tech = Math.min(5, st.tech + (w.rng.chance(0.05) ? 1 : 0));
    f.treasury -= 40000;
  }

  // Rebuild/expand fleets on staggered days
  if ((Math.floor(w.day) + f.id) % 3 !== 0) return;
  const maxFleets = f.kind === 'pirate' ? 7 : Math.min(30, 5 + Math.floor(owned.length / 3));
  if (myFleets.length >= maxFleets || f.treasury < 3000) return;
  const count = (r: FleetRole) => myFleets.filter((fl) => fl.role === r).length;
  let role: FleetRole | null = null;
  if (f.kind === 'pirate') role = 'pirate';
  else if (f.war.length && count('war') < 2 + Math.floor(owned.length / 10) * (0.5 + f.traits.aggression)) role = 'war';
  else if (count('patrol') < 1 + Math.floor(owned.length / 12)) role = 'patrol';
  else if (f.traits.trade > 0.2 && count('trade') < Math.floor(owned.length / 7 * f.traits.trade) + 1) role = 'trade';
  else if (f.traits.expansion > w.rng.next() * 1.4 && count('colony') < 1 && f.treasury > 15000) role = 'colony';
  else if (count('mining') < 1 && f.kind !== 'alien') role = 'mining';
  else if (count('explore') < 1 && w.rng.chance(0.3)) role = 'explore';
  if (!role) return;
  const ships = w.composition(f, role, clamp(f.treasury / 60000, 0.5, 2.5));
  const cost = w.fleetCost(f.id, ships);
  if (cost > f.treasury) return;
  const yards = owned.filter((id) => w.systems[id].shipyard);
  const at = yards.length ? w.rng.pick(yards) : f.capital >= 0 ? f.capital : owned[0];
  if (at === undefined || at < 0) return;
  f.treasury -= cost;
  w.spawnFleet(f.id, role, at, ships);
}

export function diplomacy(w: World, f: Faction): void {
  if (!f.alive || f.kind === 'player' || f.kind === 'pirate') return;
  const rng = w.rng;
  for (const o of w.factions) {
    if (o.id === f.id || !o.alive || o.kind === 'player' || o.kind === 'pirate') continue;
    if (o.id < f.id) continue; // handle each pair once
    let base = 10 - (f.traits.aggression + o.traits.aggression) * 20;
    if (f.species !== o.species) base -= (f.traits.xenophobia + o.traits.xenophobia) * 25;
    if (f.gov === o.gov) base += 15;
    const border = w.bordering(f, o);
    if (border) base -= 12;
    const commonEnemy = f.war.some((e) => o.war.includes(e));
    if (commonEnemy) base += 25;
    if (f.species === 'hive' || o.species === 'hive') base = -100;
    let r = f.relations[o.id];
    r += (base - r) * 0.04 + rng.range(-2, 2);
    r = clamp(r, -100, 100);
    f.relations[o.id] = r;
    o.relations[f.id] = r;

    const atWar = f.war.includes(o.id);
    if (!atWar && border && r < -45) {
      const aggressor = f.traits.aggression > o.traits.aggression ? f : o;
      const victim = aggressor === f ? o : f;
      const ratio = (aggressor.strength + 1) / (victim.strength + 1);
      if (rng.chance(0.08 * aggressor.traits.aggression) && ratio > 0.8 && aggressor.war.length < 2) w.declareWar(aggressor, victim);
    } else if (atWar) {
      const ex = Math.max(f.exhaustion[o.id] ?? 0, o.exhaustion[f.id] ?? 0);
      f.exhaustion[o.id] = (f.exhaustion[o.id] ?? 0) + 0.4;
      o.exhaustion[f.id] = (o.exhaustion[f.id] ?? 0) + 0.4;
      const peaceable = f.species !== 'hive' && o.species !== 'hive';
      if (peaceable && ex > 55 + (f.traits.aggression + o.traits.aggression) * 20 && rng.chance(0.12)) w.makePeace(f, o);
    } else if (r > 55 && commonEnemy && !f.allies.includes(o.id) && rng.chance(0.2)) {
      w.makeAlliance(f, o);
    } else if (f.allies.includes(o.id) && r < 10) {
      f.allies = f.allies.filter((x) => x !== o.id);
      o.allies = o.allies.filter((x) => x !== f.id);
      w.addNews(`The alliance between ${f.name} and ${o.name} has collapsed.`, 'alliance', f.capital);
    }
  }
  // Research
  if (rng.chance(0.006 * (1 + w.ownedSystems(f.id).filter((id) => w.systems[id].econ === 'research' || w.systems[id].econ === 'hightech').length * 0.2)) && f.tech < 5) {
    f.tech++;
    f.style.tier = f.tech;
    w.addNews(`${f.name} scientists achieve a breakthrough (Tech level ${f.tech}).`, 'discovery', f.capital);
  }
}

export function subfactionPolitics(w: World, f: Faction): void {
  if (!f.alive || f.kind !== 'human') return;
  const rng = w.rng;
  const warLoad = f.war.length;
  const avgUnrest = w.ownedSystems(f.id).reduce((a, id) => a + w.systems[id].unrest, 0) / Math.max(1, f.systemsCount);
  for (let i = 0; i < f.subs.length; i++) {
    const s = f.subs[i];
    let delta = rng.range(-2, 2) + (60 - s.loyalty) * 0.03;
    if (s.role === 'separatist') delta -= avgUnrest * 0.05 + warLoad * 0.8;
    if (s.role === 'merchant') delta -= warLoad * 0.6;
    if (s.role === 'military') delta += warLoad * 0.5;
    if (s.role === 'religious' && f.allies.some((a) => w.factions[a].kind === 'alien')) delta -= 2;
    s.loyalty = clamp(s.loyalty + delta, 0, 100);
    s.influence = clamp(s.influence + rng.range(-1.5, 1.8), 5, 95);
    const lastRebellion = f.lastRebellion ?? -999;
    if (s.loyalty < 8 && s.influence > 40 && f.systemsCount > 20 && w.day > 150 && w.day - lastRebellion > 300 && w.factions.length < 20 && rng.chance(0.05)) {
      f.lastRebellion = w.day;
      rebellion(w, f, i);
      return;
    }
  }
}

function rebellion(w: World, parent: Faction, subIndex: number): void {
  const sub = parent.subs[subIndex];
  const rng = w.rng;
  // Systems controlled by this subfaction or far from the capital secede
  const cap = w.sysData[parent.capital];
  const candidates = w.ownedSystems(parent.id).filter((id) => id !== parent.capital)
    .sort((a, b) => (w.systems[b].sub === subIndex ? 50 : 0) + sysDist(cap, w.sysData[b]) - ((w.systems[a].sub === subIndex ? 50 : 0) + sysDist(cap, w.sysData[a])));
  const take = candidates.slice(0, Math.max(3, Math.floor(candidates.length * 0.3)));
  if (!take.length) return;
  const root = starName(rng);
  const id = w.factions.length;
  const color = FACTION_COLORS[(id + 3) % FACTION_COLORS.length];
  const nf: Faction = {
    ...JSON.parse(JSON.stringify(parent)),
    id, name: `Free ${root} ${sub.role === 'separatist' ? 'Republic' : sub.role === 'military' ? 'Junta' : sub.role === 'religious' ? 'Covenant' : 'Coalition'}`,
    short: root, kind: 'rebel', color, capital: take[0], treasury: 25000, parent: parent.id, founded: w.day, war: [], allies: [], exhaustion: {},
    kills: 0, losses: 0, desc: `Breakaway state formed by the ${sub.name} of the ${parent.name}.`,
  };
  nf.style = { ...parent.style, seed: parent.style.seed + id * 77, colors: [parent.style.colors[0], parent.style.colors[1], color] };
  nf.subs = [{ role: sub.role, name: sub.name, loyalty: 90, influence: 70 }, { role: 'military', name: 'Liberation Army', loyalty: 80, influence: 50 }];
  nf.relations = w.factions.map((o) => parent.relations[o.id] ?? 0);
  nf.relations.push(0);
  for (const o of w.factions) o.relations.push(o.relations[parent.id] ?? 0);
  w.factions.push(nf);
  w.player.rep.push(Math.round(w.player.rep[parent.id] * 0.5));
  for (const sid of take) {
    w.systems[sid].owner = id;
    w.systems[sid].siege = null;
    w.systems[sid].sub = 0;
  }
  parent.subs.splice(subIndex, 1);
  w.declareWar(parent, nf, true);
  w.addNews(`REBELLION! The ${sub.name} breaks away from the ${parent.name}, forming the ${nf.name} with ${take.length} systems.`, 'rebellion', take[0]);
  w.spawnFleet(id, 'war', take[0]);
  w.spawnFleet(id, 'patrol', take[0]);
  w.recount(parent);
  w.recount(nf);
  void SUBFACTION_TEMPLATES;
}

export function economyDaily(w: World, activeSys: number): void {
  for (let id = 0; id < w.systems.length; id++) {
    const st = w.systems[id];
    if (!st.stock || !st.target) continue;
    const prof = ECONOMY_PROFILE[st.econ];
    const pf = Math.sqrt(st.pop) * 0.25 + 0.3;
    const owner = st.owner >= 0 ? w.factions[st.owner] : null;
    const atWar = owner ? owner.war.length > 0 : false;
    const prodMult = (st.siege ? 0.45 : 1) * (0.8 + st.tech * 0.1) * (1 - st.unrest / 250);
    for (let c = 0; c < COMMODITIES.length; c++) {
      let d = (prof[COMMODITIES[c].key] ?? 0) * pf;
      if (d > 0) d *= prodMult;
      else if (atWar && (c === 12 || c === 11 || c === 6)) d *= 1.8;
      const tgt = st.target[c];
      let s = st.stock[c] + d + (tgt - st.stock[c]) * 0.006;
      st.stock[c] = clamp(s, 0, tgt * 5);
    }
    // Shortages breed unrest; abundance slowly grows population
    if (st.stock[0] < st.target[0] * 0.15 || st.stock[1] < st.target[1] * 0.15) st.unrest = Math.min(100, st.unrest + 1.5);
    else if (st.pop > 0) st.pop *= 1.00015;
    void activeSys;
  }
}

/** Occasional galaxy-wide flavour events that move markets. */
export function randomEvents(w: World): void {
  const rng = w.rng;
  if (!rng.chance(0.18)) return;
  const inhabited = w.systems.map((s, i) => i).filter((i) => w.systems[i].stock);
  if (!inhabited.length) return;
  const id = rng.pick(inhabited);
  const st = w.systems[id];
  const name = w.sysData[id].name;
  const r = rng.next();
  if (r < 0.25) {
    st.stock![0] *= 0.3;
    w.addNews(`Crop blight at ${name}: food prices soar.`, 'economy', id);
  } else if (r < 0.45) {
    st.stock![11] *= 0.25;
    st.pop *= 0.97;
    w.addNews(`Epidemic at ${name}: medical supplies urgently needed.`, 'economy', id);
  } else if (r < 0.6) {
    st.stock![14] += 200;
    w.addNews(`Crystal strike at ${name}: rare crystals flood the market.`, 'economy', id);
  } else if (r < 0.75) {
    st.stock![13] *= 0.3;
    w.addNews(`Festival season at ${name}: luxury goods in high demand.`, 'economy', id);
  } else if (r < 0.9) {
    st.stock![4] *= 0.35;
    st.stock![5] *= 0.35;
    w.addNews(`Shipyard expansion at ${name}: metals and alloys wanted.`, 'economy', id);
  } else {
    st.unrest = Math.min(100, st.unrest + 30);
    w.addNews(`Riots erupt at ${name} over living conditions.`, 'economy', id);
  }
}
