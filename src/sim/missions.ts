// Procedural missions: generation per station board, acceptance, tracking and rewards.
import type { World } from './world';
import type { Mission, MissionType } from './types';
import { RNG, hash } from '../core/rng';
import { systemsNear, sysDist } from '../gen/galaxy';
import { COMMODITIES, C } from '../data/commodities';
import { changeRep, addXp, addMerit, cargoUsed, playerStats } from '../player/player';
import { bus } from '../core/events';
import { allBodies } from '../gen/system';
import { RANKS } from '../data/factions';
import type { ShipClass } from '../ship/design';

function mk(partial: Partial<Mission> & Pick<Mission, 'id' | 'type' | 'title' | 'desc' | 'faction' | 'origin' | 'target' | 'reward'>): Mission {
  return {
    sub: -1, targets: [], commodity: -1, qty: 0, rep: 3, merit: 0, deadline: 0, status: 'available', progress: 0, goal: 1, enemy: -1, data: {}, military: false, minRank: 0,
    ...partial,
  };
}

export function missionBoard(w: World, sys: number): Mission[] {
  const week = Math.floor(w.day / 7);
  const b = w.boards[sys];
  if (!b || b.week !== week) {
    w.boards[sys] = { week, missions: generateMissions(w, sys, week) };
    // prune stale boards to keep saves small
    for (const k of Object.keys(w.boards)) if (w.boards[+k].week < week - 1) delete w.boards[+k];
  }
  return w.boards[sys].missions.filter((m) => m.status === 'available');
}

function generateMissions(w: World, sys: number, week: number): Mission[] {
  const rng = new RNG(hash(w.seed, sys, week, 0x1337));
  const st = w.systems[sys];
  const here = w.sysData[sys];
  const fid = st.owner;
  const f = fid > 0 ? w.factions[fid] : null;
  const out: Mission[] = [];
  const near = systemsNear(w.galaxy, here.x, here.y, 90).filter((id) => id !== sys);
  const friendlyStations = near.filter((id) => w.systems[id].station && !(fid > 0 && w.systems[id].owner >= 0 && w.hostile(fid, w.systems[id].owner)));
  const idBase = `${sys}_${week}_`;
  const day = Math.floor(w.day);
  const pirate = f?.kind === 'pirate';
  const count = rng.int(5, 9);

  const types: MissionType[] = [];
  const weights: number[] = [];
  const add = (t: MissionType, wt: number) => { types.push(t); weights.push(wt); };
  add('delivery', 3);
  add('passenger', 1.5);
  add('bounty', pirate ? 0.4 : 2.5);
  add('survey', 1.5);
  add('mining', 1.2);
  add('salvage', 1);
  add('rescue', 0.8);
  add('escort', f && !pirate ? 1 : 0);
  add('supply', 1);
  add('smuggle', pirate ? 3 : f?.subs.some((s) => s.role === 'intelligence') ? 0.8 : 0.3);
  add('raid', pirate ? 2.5 : 0);
  add('patrol', f && !pirate ? 1.5 : 0);
  add('courier', f && f.kind === 'human' ? 0.8 : 0);
  if (f && f.war.length) {
    add('strike', 2.5);
    add('defend', 1.5);
  }

  for (let i = 0; i < count; i++) {
    const t = rng.weighted(types, weights);
    const id = idBase + i;
    const m = makeMission(w, rng, t, id, sys, fid, friendlyStations, near, day);
    if (m) {
      if (f && f.subs.length) m.sub = rng.int(0, f.subs.length - 1);
      out.push(m);
    }
  }
  return out;
}

function makeMission(w: World, rng: RNG, t: MissionType, id: string, sys: number, fid: number, stations: number[], near: number[], day: number): Mission | null {
  const here = w.sysData[sys];
  const f = fid > 0 ? w.factions[fid] : null;
  const fname = f ? f.name : 'Local authorities';
  const dist = (id2: number) => sysDist(here, w.sysData[id2]);
  switch (t) {
    case 'delivery': {
      if (!stations.length) return null;
      const dst = rng.pick(stations);
      const c = rng.pick([0, 1, 4, 5, 7, 8, 9, 10, 11, 13]);
      const qty = rng.int(8, 40);
      const d = dist(dst);
      const reward = Math.round(qty * COMMODITIES[c].base * 0.25 + d * 30 + 300);
      return mk({ id, type: t, title: `Deliver ${COMMODITIES[c].name}`, desc: `Transport ${qty} units of ${COMMODITIES[c].name} to ${w.sysData[dst].name} (${d.toFixed(1)} ly). Cargo provided.`,
        faction: fid, origin: sys, target: dst, commodity: c, qty, reward, deadline: day + Math.ceil(d / 5) + 12, rep: 3 });
    }
    case 'passenger': {
      if (!stations.length) return null;
      const dst = rng.pick(stations);
      const qty = rng.int(3, 14);
      const d = dist(dst);
      const reward = Math.round(qty * 90 + d * 35 + 200);
      return mk({ id, type: t, title: 'Passenger Transport', desc: `Carry ${qty} passengers to ${w.sysData[dst].name}. They take cargo space.`,
        faction: fid, origin: sys, target: dst, commodity: C.pax, qty, reward, deadline: day + Math.ceil(d / 6) + 8, rep: 2 });
    }
    case 'supply': {
      const needy = stations.filter((s) => {
        const st = w.systems[s];
        return st.stock && (st.stock[0] < st.target![0] * 0.4 || st.stock[11] < st.target![11] * 0.4);
      });
      if (!needy.length) return null;
      const dst = rng.pick(needy);
      const c = w.systems[dst].stock![0] < w.systems[dst].target![0] * 0.4 ? 0 : 11;
      const qty = rng.int(15, 45);
      const reward = Math.round(qty * COMMODITIES[c].base * 1.6 + dist(dst) * 20);
      return mk({ id, type: t, title: `Relief: ${COMMODITIES[c].name}`, desc: `${w.sysData[dst].name} faces a shortage. Buy and deliver ${qty} ${COMMODITIES[c].name} there.`,
        faction: fid, origin: sys, target: dst, commodity: c, qty, reward, deadline: day + 20, rep: 5, data: { buy: true } });
    }
    case 'mining': {
      const c = rng.pick([C.ore, C.ore, C.ice, C.crys]);
      const qty = c === C.crys ? rng.int(4, 12) : rng.int(20, 60);
      const reward = Math.round(qty * COMMODITIES[c].base * 1.7 + 200);
      return mk({ id, type: t, title: `Mining Contract: ${COMMODITIES[c].name}`, desc: `Mine or acquire ${qty} ${COMMODITIES[c].name} and deliver to this station.`,
        faction: fid, origin: sys, target: sys, commodity: c, qty, reward, deadline: day + 25, rep: 3, data: { buy: true } });
    }
    case 'bounty': {
      const cands = near.filter((s) => dist(s) < 70);
      if (!cands.length) return null;
      const tgt = rng.pick(cands);
      const pirates = w.factions.filter((x) => x.kind === 'pirate' && x.alive);
      const enemy = pirates.length ? rng.pick(pirates).id : -1;
      if (enemy < 0) return null;
      const lvl = rng.int(1, 3);
      const reward = Math.round(1200 + lvl * 1500 + dist(tgt) * 25);
      return mk({ id, type: t, title: `Bounty: ${w.factions[enemy].short} ${['Raider', 'Marauder', 'Warlord'][lvl - 1]}`, desc: `A wanted ${w.factions[enemy].name} crew (threat ${'★'.repeat(lvl)}) is hiding at ${w.sysData[tgt].name}. Destroy them.`,
        faction: fid, origin: sys, target: tgt, enemy, reward, deadline: day + 30, rep: 5, merit: 10 * lvl, data: { level: lvl } });
    }
    case 'strike': {
      if (!f || !f.war.length) return null;
      const enemy = rng.pick(f.war);
      const es = near.filter((s) => w.systems[s].owner === enemy || (w.systems[s].owner === fid && w.systems[s].siege?.by === enemy));
      if (!es.length) return null;
      const tgt = rng.pick(es);
      const lvl = rng.int(2, 4);
      return mk({ id, type: t, title: `Strike on ${w.factions[enemy].short} forces`, desc: `Military operation: destroy the ${w.factions[enemy].name} battle group at ${w.sysData[tgt].name}.`,
        faction: fid, origin: sys, target: tgt, enemy, reward: 3000 + lvl * 2200, deadline: day + 25, rep: 7, merit: 30 * lvl, military: true, minRank: lvl - 2, data: { level: lvl } });
    }
    case 'defend': {
      if (!f || !f.war.length) return null;
      const own = near.filter((s) => w.systems[s].owner === fid && dist(s) < 60);
      if (!own.length) return null;
      const tgt = rng.pick(own);
      const enemy = rng.pick(f.war);
      return mk({ id, type: t, title: `Defend ${w.sysData[tgt].name}`, desc: `Intelligence predicts a ${w.factions[enemy].name} assault on ${w.sysData[tgt].name}. Go there and repel three attack waves.`,
        faction: fid, origin: sys, target: tgt, enemy, reward: 5500, deadline: day + 18, rep: 8, merit: 70, goal: 3, military: true, minRank: 1 });
    }
    case 'patrol': {
      const own = near.filter((s) => w.systems[s].owner === fid && dist(s) < 70);
      if (own.length < 2) return null;
      rng.shuffle(own);
      const targets = own.slice(0, Math.min(3, own.length));
      return mk({ id, type: t, title: 'Patrol Route', desc: `Patrol ${targets.map((x) => w.sysData[x].name).join(', ')}. Report in each system.`,
        faction: fid, origin: sys, target: targets[0], targets, goal: targets.length, reward: 900 + targets.length * 600, deadline: day + 25, rep: 4, merit: 20, military: !!f && f.kind === 'human' });
    }
    case 'survey': {
      const cands = near.filter((s) => dist(s) < 80 && w.sysData[s].planets.length >= 2);
      if (!cands.length) return null;
      const tgt = rng.pick(cands);
      const goal = Math.min(allBodies(w.sysData[tgt]).length, rng.int(2, 4));
      return mk({ id, type: t, title: `Survey ${w.sysData[tgt].name}`, desc: `Scan ${goal} planets or moons in the ${w.sysData[tgt].name} system.`,
        faction: fid, origin: sys, target: tgt, goal, reward: 700 + goal * 450 + Math.round(dist(tgt) * 20), deadline: day + 30, rep: 3 });
    }
    case 'salvage':
    case 'rescue': {
      const cands = near.filter((s) => dist(s) < 60);
      if (!cands.length) return null;
      const tgt = rng.pick(cands);
      const rescue = t === 'rescue';
      return mk({ id, type: t, title: rescue ? 'Search & Rescue' : 'Salvage Recovery', desc: rescue ? `An escape pod was detected in ${w.sysData[tgt].name}. Recover the survivors and return them here.` : `Recover the black box from a derelict in ${w.sysData[tgt].name} and bring it back.`,
        faction: fid, origin: sys, target: tgt, reward: rescue ? 1600 : 1300 + Math.round(dist(tgt) * 25), deadline: day + 22, rep: rescue ? 6 : 3, data: { picked: false } });
    }
    case 'escort': {
      if (!stations.length) return null;
      const dst = rng.pick(stations.filter((s) => dist(s) < 40) .concat(stations.slice(0, 1)));
      return mk({ id, type: t, title: 'Convoy Escort', desc: `Escort a ${fname} freighter to ${w.sysData[dst].name}. Pirates are expected. The freighter must survive.`,
        faction: fid, origin: sys, target: dst, reward: 2200 + Math.round(dist(dst) * 40), deadline: day + 15, rep: 5, merit: 15 });
    }
    case 'smuggle': {
      const dests = stations.filter((s) => {
        const o = w.systems[s].owner;
        return o > 0 && w.factions[o].illegal.includes(C.stim);
      });
      if (!dests.length) return null;
      const dst = rng.pick(dests);
      const qty = rng.int(5, 18);
      return mk({ id, type: t, title: 'Discreet Delivery', desc: `Smuggle ${qty} Neural Stims into ${w.sysData[dst].name}. Avoid patrol scans. No questions asked.`,
        faction: fid, origin: sys, target: dst, commodity: C.stim, qty, reward: qty * 320 + 800, deadline: day + 18, rep: 4 });
    }
    case 'raid': {
      const victims = w.factions.filter((x) => x.kind === 'human' && x.alive);
      if (!victims.length) return null;
      const v = rng.pick(victims);
      const own = near.filter((s) => w.systems[s].owner === v.id && dist(s) < 70);
      if (!own.length) return null;
      const tgt = rng.pick(own);
      return mk({ id, type: t, title: `Raid ${v.short} Convoy`, desc: `A fat ${v.name} convoy is passing through ${w.sysData[tgt].name}. Destroy it and take the loot.`,
        faction: fid, origin: sys, target: tgt, enemy: v.id, reward: 2800, deadline: day + 20, rep: 6 });
    }
    case 'courier': {
      const others = w.factions.filter((x) => x.alive && x.id !== fid && (x.kind === 'human' || x.species === 'synod') && !f!.war.includes(x.id) && x.capital >= 0);
      if (!others.length) return null;
      const o = rng.pick(others);
      return mk({ id, type: t, title: `Diplomatic Courier to ${o.short}`, desc: `Deliver sealed diplomatic dispatches to the ${o.name} capital at ${w.sysData[o.capital].name}.`,
        faction: fid, origin: sys, target: o.capital, enemy: o.id, reward: 1500 + Math.round(dist(o.capital) * 30), deadline: day + 35, rep: 6, data: { other: o.id } });
    }
  }
  return null;
}

// ------------------------------------------------------------------ lifecycle
export function acceptMission(w: World, m: Mission): string | null {
  const p = w.player;
  if (p.missions.filter((x) => x.status === 'active').length >= 8) return 'Mission log full (8 active).';
  if (m.military) {
    if (!p.military || p.military.faction !== m.faction) return 'Requires enlistment in this faction\'s military.';
    if (p.military.rank < m.minRank) return `Requires rank ${RANKS[Math.max(0, m.minRank)]}.`;
  }
  const stats = playerStats(p);
  const free = stats.cargo - cargoUsed(p);
  const provided = m.type === 'delivery' || m.type === 'passenger' || m.type === 'smuggle';
  if (provided && free < m.qty) return `Needs ${m.qty} free cargo space (you have ${free}).`;
  if (provided) p.cargo[m.commodity] += m.qty;
  m.status = 'active';
  p.missions.push(m);
  if (m.type === 'bounty' || m.type === 'strike') {
    const fl = w.spawnFleet(m.enemy, m.type === 'bounty' ? 'bounty' : 'war', m.target);
    const lvl = m.data.level ?? 1;
    if (m.type === 'bounty') {
      const tiers: ShipClass[][] = [['corvette', 'fighter'], ['frigate', 'corvette', 'fighter'], ['destroyer', 'frigate', 'fighter', 'fighter']];
      fl.ships = tiers[Math.min(2, lvl - 1)].map((cls, i) => ({ cls, v: i % 2, hp: 1 }));
    } else {
      const tiers: ShipClass[][] = [['frigate', 'corvette', 'fighter'], ['destroyer', 'frigate', 'corvette', 'fighter'], ['cruiser', 'destroyer', 'frigate', 'fighter', 'fighter'], ['cruiser', 'destroyer', 'destroyer', 'frigate', 'corvette', 'fighter']];
      fl.ships = tiers[Math.min(3, Math.max(0, lvl - 1))].map((cls, i) => ({ cls, v: i % 2, hp: 1 }));
    }
    fl.mission = m.id;
    fl.wait = 999;
    fl.strength = w.fleetStrength(fl);
    m.data.fleet = fl.id;
  }
  if (m.type === 'raid') {
    const fl = w.spawnFleet(m.enemy, 'convoy', m.target);
    fl.mission = m.id;
    fl.wait = 999;
    fl.cargo = { c: 13, q: 60, buy: 0 };
    m.data.fleet = fl.id;
  }
  bus.emit('toast', { text: `Mission accepted: ${m.title}`, kind: 'info' });
  return null;
}

export function abandonMission(w: World, m: Mission): void {
  const p = w.player;
  m.status = 'failed';
  p.failed++;
  if (m.type === 'delivery' || m.type === 'passenger' || m.type === 'smuggle') p.cargo[m.commodity] = Math.max(0, p.cargo[m.commodity] - m.qty);
  if (m.faction > 0) changeRep(w, m.faction, -Math.max(2, m.rep), 'mission failed');
  cleanupMission(w, m);
  p.missions = p.missions.filter((x) => x !== m);
}

function cleanupMission(w: World, m: Mission): void {
  if (m.data.fleet) {
    const fl = w.fleets.find((f) => f.id === m.data.fleet);
    if (fl) w.removeFleet(fl);
  }
}

export function completeMission(w: World, m: Mission): void {
  const p = w.player;
  m.status = 'done';
  p.completed++;
  const bonus = 1 + (p.military && p.military.faction === m.faction ? 0.1 * p.military.rank : 0);
  const reward = Math.round(m.reward * bonus);
  p.credits += reward;
  p.totalEarned += reward;
  if (m.faction > 0) changeRep(w, m.faction, m.rep, 'mission complete');
  if (m.type === 'courier' && m.data.other) changeRep(w, m.data.other, 4, 'diplomacy');
  if (m.type === 'raid' && m.enemy > 0) changeRep(w, m.enemy, -8, 'raid');
  if (m.merit && p.military?.faction === m.faction) addMerit(w, m.merit);
  if (m.sub >= 0 && m.faction > 0) {
    const sub = w.factions[m.faction].subs[m.sub];
    if (sub) sub.loyalty = Math.min(100, sub.loyalty + 1);
  }
  addXp(p, 40 + reward / 40);
  cleanupMission(w, m);
  p.missions = p.missions.filter((x) => x !== m);
  bus.emit('toast', { text: `Mission complete: ${m.title} (+${reward.toLocaleString()} cr)`, kind: 'good' });
  bus.emit('sfx', 'reward');
}

/** Called when docking at a station; completes deliverable missions. */
export function missionsOnDock(w: World, sys: number): void {
  const p = w.player;
  for (const m of [...p.missions]) {
    if (m.status !== 'active') continue;
    const delivery = m.type === 'delivery' || m.type === 'passenger' || m.type === 'supply' || m.type === 'mining' || m.type === 'smuggle';
    if (delivery && m.target === sys && p.cargo[m.commodity] >= m.qty) {
      p.cargo[m.commodity] -= m.qty;
      completeMission(w, m);
    } else if ((m.type === 'salvage' || m.type === 'rescue') && m.data.picked && m.origin === sys) {
      completeMission(w, m);
    } else if (m.type === 'courier' && m.target === sys) {
      completeMission(w, m);
    } else if (m.type === 'escort' && m.target === sys && m.data.arrived) {
      completeMission(w, m);
    }
  }
}

export function missionsOnEnter(w: World, sys: number): void {
  for (const m of [...w.player.missions]) {
    if (m.status !== 'active') continue;
    if (m.type === 'patrol' && m.targets.includes(sys) && !(m.data.visited ?? []).includes(sys)) {
      m.data.visited = [...(m.data.visited ?? []), sys];
      m.progress = m.data.visited.length;
      bus.emit('toast', { text: `Patrol checkpoint ${m.progress}/${m.goal}`, kind: 'info' });
      if (m.progress >= m.goal) completeMission(w, m);
    }
  }
}

export function missionsOnScan(w: World, sys: number): void {
  for (const m of [...w.player.missions]) {
    if (m.status === 'active' && m.type === 'survey' && m.target === sys) {
      m.progress++;
      if (m.progress >= m.goal) completeMission(w, m);
      else bus.emit('toast', { text: `Survey progress ${m.progress}/${m.goal}`, kind: 'info' });
    }
  }
}

export function missionsOnFleetDestroyed(w: World, fleetId: number): void {
  for (const m of [...w.player.missions]) {
    if (m.status === 'active' && m.data.fleet === fleetId) completeMission(w, m);
  }
}

export function missionsDaily(w: World): void {
  for (const m of [...w.player.missions]) {
    if (m.status === 'active' && m.deadline > 0 && w.day > m.deadline) {
      bus.emit('toast', { text: `Mission failed (deadline): ${m.title}`, kind: 'bad' });
      abandonMission(w, m);
    }
  }
}
