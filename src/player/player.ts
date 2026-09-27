// Player state creation and progression helpers.
import type { World } from '../sim/world';
import type { PlayerState } from '../sim/types';
import { NUM_COMMODITIES, COMMODITIES } from '../data/commodities';
import { starterDesign } from '../ship/shipgen';
import { computeStats, ShipStats } from '../ship/design';
import { RANKS, RANK_MERIT, repTier } from '../data/factions';
import { bus } from '../core/events';
import { clamp } from '../core/math';

export const SKILLS: { id: string; name: string; desc: string }[] = [
  { id: 'piloting', name: 'Piloting', desc: '+4% speed and turn rate per level.' },
  { id: 'gunnery', name: 'Gunnery', desc: '+5% weapon damage per level.' },
  { id: 'engineering', name: 'Engineering', desc: '+6% shield regen and repair per level.' },
  { id: 'trading', name: 'Trading', desc: 'Better buy/sell prices at markets.' },
  { id: 'leadership', name: 'Leadership', desc: '+1 wingman slot per 3 levels, cheaper crew wages.' },
  { id: 'science', name: 'Science', desc: 'Faster scans, better mining yields and survey data value.' },
];

export function createPlayer(w: World, name: string, startFaction: number): PlayerState {
  const humans = w.factions.filter((f) => f.kind === 'human');
  const home = humans[clamp(startFaction, 0, humans.length - 1)];
  // pick a populated shipyard world of the home faction that is not the capital
  const cands = w.ownedSystems(home.id).filter((id) => w.systems[id].shipyard && id !== home.capital);
  const sys = cands.length ? cands[Math.floor(w.rng.next() * cands.length)] : home.capital;
  const design = starterDesign();
  const st = computeStats(design);
  const rep = w.factions.map((f) => {
    if (f.kind === 'player') return 100;
    if (f.kind === 'pirate') return -40;
    if (f.species === 'hive') return -80;
    if (f.species === 'automata') return -50;
    if (f.id === home.id) return 15;
    if (home.war.includes(f.id)) return -15;
    return 0;
  });
  const cargo = new Array(NUM_COMMODITIES).fill(0);
  const p: PlayerState = {
    name, credits: 6000, xp: 0, level: 1, skillPoints: 1,
    skills: { piloting: 0, gunnery: 0, engineering: 0, trading: 0, leadership: 0, science: 0 },
    sys, x: 0, y: 0, design, hp: design.modules.map(() => 1), hangar: [], fuel: st.fuel,
    ammo: { shells: 0, slugs: 0, missiles: 0, torpedoes: 0 }, cargo, modules: { laser: 1, armor: 12, armor_slope: 6, hull: 8, thruster: 2 },
    rep, military: null, missions: [], completed: 0, failed: 0, kills: 0, killsBy: {}, explorationData: 0,
    discovered: [sys], visitedCount: 1, wingmen: [], roverUpgrades: [], artifacts: 0, homeFaction: home.id, startDay: w.day,
    totalEarned: 0, deaths: 0, insurance: true, frames: ['scout'], lastSalary: 0, bounty: {}, startFaction: home.id,
  };
  w.systems[sys].visited = true;
  return p;
}

export function xpForLevel(level: number): number {
  return Math.round(120 * Math.pow(level, 1.55));
}

export function addXp(p: PlayerState, amount: number): void {
  p.xp += Math.round(amount);
  while (p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    p.skillPoints++;
    bus.emit('toast', { text: `Level up! You are now level ${p.level}. +1 skill point.`, kind: 'good' });
  }
}

export function cargoUsed(p: PlayerState): number {
  let n = 0;
  for (const q of p.cargo) n += q;
  return n;
}

export function cargoValue(w: World, p: PlayerState): number {
  let v = 0;
  p.cargo.forEach((q, i) => (v += q * COMMODITIES[i].base));
  return v;
}

/**
 * Changes reputation with a faction and ripples to its allies (positive) and
 * enemies (negative).
 */
export function changeRep(w: World, fid: number, delta: number, reason = ''): void {
  const p = w.player;
  if (fid <= 0 || !w.factions[fid]) return;
  const before = repTier(p.rep[fid]).name;
  p.rep[fid] = clamp(p.rep[fid] + delta, -100, 100);
  const f = w.factions[fid];
  for (const a of f.allies) p.rep[a] = clamp(p.rep[a] + delta * 0.3, -100, 100);
  if (delta > 0) for (const e of f.war) if (w.factions[e].kind !== 'pirate') p.rep[e] = clamp(p.rep[e] - delta * 0.25, -100, 100);
  const after = repTier(p.rep[fid]).name;
  if (before !== after) bus.emit('toast', { text: `${f.name}: you are now ${after}${reason ? ' (' + reason + ')' : ''}.`, kind: delta > 0 ? 'good' : 'bad' });
}

export function addMerit(w: World, amount: number): void {
  const m = w.player.military;
  if (!m) return;
  m.merit += Math.round(amount);
  while (m.rank < RANKS.length - 1 && m.merit >= RANK_MERIT[m.rank + 1]) {
    m.rank++;
    bus.emit('toast', { text: `PROMOTED to ${RANKS[m.rank]} of the ${w.factions[m.faction].name}!`, kind: 'good' });
    w.addNews(`${w.player.name} promoted to ${RANKS[m.rank]} in the ${w.factions[m.faction].name} navy.`, 'player', w.player.sys);
  }
}

/** Ship stats with player skill bonuses applied. */
export function playerStats(p: PlayerState, alive?: boolean[]): ShipStats {
  const s = computeStats(p.design, alive);
  const pil = 1 + p.skills.piloting * 0.04;
  s.maxSpeed *= pil;
  s.accel *= pil;
  s.turnRate *= pil;
  s.shieldRegen *= 1 + p.skills.engineering * 0.06;
  s.repair *= 1 + p.skills.engineering * 0.06;
  s.dps *= 1 + p.skills.gunnery * 0.05;
  return s;
}

export function wingmanSlots(p: PlayerState, leadership: number): number {
  const rankSlots = p.military ? Math.floor(p.military.rank / 2) : 0;
  return 1 + Math.floor(p.skills.leadership / 3) + leadership + rankSlots;
}
