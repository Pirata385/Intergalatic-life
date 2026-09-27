// Master clock of the background simulation. The galaxy advances one "day" at a
// time regardless of where the player is.
import type { World } from './world';
import { moveFleets, decideFleet, onFleetArrive, resolveBattles, factionDaily, diplomacy, subfactionPolitics, economyDaily, randomEvents } from './ai';
import { missionsDaily } from './missions';
import { tickColony, Wallet, MarketLink } from './colony';
import { COLONY_RES_COMMODITY } from '../data/buildings';
import { C } from '../data/commodities';
import { RANK_SALARY } from '../data/factions';
import { bus } from '../core/events';

/** Real seconds per in-game day while flying inside a system. */
export const SECONDS_PER_DAY = 40;

export function advanceTime(w: World, days: number, activeSys: number): void {
  const target = w.day + days;
  let guard = 0;
  while (Math.floor(target) > Math.floor(w.day) && guard++ < 400) {
    w.day = Math.floor(w.day) + 1;
    dailyTick(w, activeSys);
  }
  w.day = target;
}

export function dailyTick(w: World, activeSys: number): void {
  // Fleets travel and act
  moveFleets(w, 1, (fl) => onFleetArrive(w, fl));
  for (const fl of [...w.fleets]) {
    if (fl.dest >= 0) continue;
    if (fl.sys === activeSys && fl.faction !== 0) {
      // Fleets in the player's system are simulated in real time; they still leave eventually.
      fl.wait -= 0.5;
    } else fl.wait -= 1;
    if (fl.wait <= 0) decideFleet(w, fl);
  }
  resolveBattles(w, activeSys);
  economyDaily(w, activeSys);
  for (const f of w.factions) factionDaily(w, f);
  if (Math.floor(w.day) % 5 === 0) for (const f of w.factions) diplomacy(w, f);
  if (Math.floor(w.day) % 10 === 0) for (const f of w.factions) subfactionPolitics(w, f);
  randomEvents(w);
  missionsDaily(w);
  playerDaily(w);
  for (const c of w.colonies) {
    if (c.owner !== 0 || c.lost) continue;
    tickColony(c, playerWallet(w), colonyMarket(w, c.sys), raidThreat(w, c.sys));
    if (c.lost) {
      w.systems[c.sys].colony = -1;
      if (w.systems[c.sys].owner === 0) w.systems[c.sys].owner = -1;
    } else {
      // colony population feeds the system population & market
      const st = w.systems[c.sys];
      st.pop = Math.max(st.pop, c.pop / 1000);
    }
  }
}

export function playerWallet(w: World): Wallet {
  return {
    get: () => w.player.credits,
    add: (n) => {
      w.player.credits += n;
      if (n > 0) w.player.totalEarned += n;
    },
  };
}

function colonyMarket(w: World, sys: number): MarketLink {
  return {
    sell: (res, qty) => {
      const key = COLONY_RES_COMMODITY[res];
      if (!key) return 0;
      const c = C[key];
      const price = w.sellPrice(sys, c);
      const st = w.systems[sys];
      if (st.stock) st.stock[c] += qty;
      return price * qty * 0.9;
    },
  };
}

function raidThreat(w: World, sys: number): number {
  let t = 0;
  for (const fl of w.fleetsAt(sys)) if (w.hostile(0, fl.faction)) t += 1;
  return t;
}

function playerDaily(w: World): void {
  const p = w.player;
  const day = Math.floor(w.day);
  // Weekly military salary
  if (p.military && day - p.lastSalary >= 7) {
    p.lastSalary = day;
    const sal = RANK_SALARY[p.military.rank];
    p.credits += sal;
    bus.emit('toast', { text: `Military salary received: ${sal} cr`, kind: 'good' });
  }
  // Wingmen wages
  let wages = 0;
  for (const wm of p.wingmen) wages += wm.wage;
  if (wages > 0) {
    p.credits -= wages;
    if (p.credits < 0) {
      const gone = p.wingmen.pop();
      if (gone) bus.emit('toast', { text: `${gone.name} left: unpaid wages.`, kind: 'bad' });
      p.credits = Math.max(0, p.credits);
    }
  }
  // Reputation slowly normalises toward neutral for non-hostile factions
  for (let i = 1; i < p.rep.length; i++) {
    const f = w.factions[i];
    if (!f) continue;
    if (f.kind === 'pirate' || f.species === 'hive') continue;
    if (p.rep[i] < -5) p.rep[i] += 0.03;
  }
}
