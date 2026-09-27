// Shared simulation state types. Everything in here is plain data so it can be
// serialised directly into save files.
import type { EconomyType } from '../data/commodities';
import type { FactionKind, SubfactionRole } from '../data/factions';
import type { Species, AmmoType } from '../data/modules';
import type { ShipClass, ShipDesign } from '../ship/design';
import type { ShipStyle } from '../ship/shipgen';
import type { ColonyState } from './colony';

export interface SystemState {
  owner: number; // faction id (0 = player), -1 unclaimed
  pop: number; // millions
  econ: EconomyType;
  tech: number;
  security: number; // 0..1
  defense: number; // current garrison strength
  maxDefense: number;
  station: boolean;
  shipyard: boolean;
  military: boolean;
  stock: number[] | null;
  target: number[] | null;
  siege: { by: number; progress: number } | null;
  unrest: number;
  visited: boolean;
  scanned: string[]; // body keys scanned by player
  lastBattle: number;
  colony: number; // colony id or -1
  sub: number; // subfaction index controlling the world
}

export interface SubFaction {
  role: SubfactionRole;
  name: string;
  loyalty: number; // 0..100
  influence: number; // 0..100
}

export interface Faction {
  id: number;
  name: string;
  short: string;
  kind: FactionKind;
  species: Species;
  gov: string;
  color: string;
  traits: { aggression: number; expansion: number; trade: number; xenophobia: number; honor: number };
  capital: number;
  treasury: number;
  tech: number;
  alive: boolean;
  relations: number[];
  war: number[];
  allies: number[];
  exhaustion: Record<number, number>;
  subs: SubFaction[];
  style: ShipStyle;
  parent: number;
  founded: number;
  desc: string;
  illegal: number[];
  jump: number; // fleet jump range
  kills: number;
  losses: number;
  systemsCount: number;
  strength: number;
  lastRebellion?: number;
}

export type FleetRole = 'war' | 'patrol' | 'trade' | 'colony' | 'pirate' | 'explore' | 'mining' | 'defense' | 'bounty' | 'convoy';

export interface FleetShip {
  cls: ShipClass;
  v: number;
  hp: number;
}

export interface Fleet {
  id: number;
  faction: number;
  role: FleetRole;
  name: string;
  ships: FleetShip[];
  sys: number;
  dest: number; // next hop target (-1 when docked)
  route: number[];
  progress: number; // 0..1 along current hop
  hopDays: number;
  target: number; // final objective system
  wait: number; // days to linger
  cargo: { c: number; q: number; buy: number } | null;
  captain: string;
  mission: string; // linked mission id
  strength: number;
  morale: number;
}

export type NewsKind = 'war' | 'peace' | 'alliance' | 'capture' | 'colony' | 'battle' | 'pirate' | 'economy' | 'rebellion' | 'discovery' | 'player' | 'alien';

export interface NewsItem {
  day: number;
  text: string;
  kind: NewsKind;
  sys: number;
}

export type MissionType =
  | 'delivery' | 'passenger' | 'bounty' | 'patrol' | 'survey' | 'mining' | 'smuggle' | 'strike' | 'defend' | 'raid'
  | 'courier' | 'salvage' | 'rescue' | 'escort' | 'supply';

export interface Mission {
  id: string;
  type: MissionType;
  title: string;
  desc: string;
  faction: number;
  sub: number;
  origin: number;
  target: number;
  targets: number[];
  commodity: number;
  qty: number;
  reward: number;
  rep: number;
  merit: number;
  deadline: number;
  status: 'available' | 'active' | 'done' | 'failed';
  progress: number;
  goal: number;
  enemy: number; // enemy faction for combat missions
  data: Record<string, any>;
  military: boolean;
  minRank: number;
}

export interface Wingman {
  id: string;
  name: string;
  cls: ShipClass;
  faction: number; // design source faction
  v: number;
  hp: number;
  wage: number;
  skill: number;
  kills: number;
}

export interface PlayerState {
  name: string;
  credits: number;
  xp: number;
  level: number;
  skillPoints: number;
  skills: Record<string, number>;
  sys: number;
  x: number;
  y: number;
  design: ShipDesign;
  hp: number[]; // per-module hp fraction
  hangar: ShipDesign[];
  fuel: number;
  ammo: Record<AmmoType, number>;
  cargo: number[];
  modules: Record<string, number>; // spare modules owned
  rep: number[];
  military: { faction: number; rank: number; merit: number; joined: number } | null;
  missions: Mission[];
  completed: number;
  failed: number;
  kills: number;
  killsBy: Record<number, number>;
  explorationData: number; // credits worth of unsold survey data
  discovered: number[]; // systems discovered
  visitedCount: number;
  wingmen: Wingman[];
  roverUpgrades: string[];
  artifacts: number;
  homeFaction: number;
  startDay: number;
  totalEarned: number;
  deaths: number;
  insurance: boolean;
  frames: string[]; // owned hull frames
  lastSalary: number;
  bounty: Record<number, number>; // bounty on the player per faction
  startFaction: number;
}

export interface WorldSave {
  version: number;
  seed: number;
  day: number;
  systems: SystemState[];
  factions: Faction[];
  fleets: Fleet[];
  nextFleetId: number;
  news: NewsItem[];
  colonies: ColonyState[];
  player: PlayerState;
  rng: number[];
  boards: Record<number, { week: number; missions: Mission[] }>;
  stats: { wars: number; captures: number; colonies: number };
  realTime: number;
}
