// Static faction archetypes, governments, ranks and reputation tiers.
import type { Species } from './modules';
import type { EconomyType } from './commodities';

export type FactionKind = 'human' | 'alien' | 'pirate' | 'player' | 'rebel';

export interface Government {
  name: string;
  aggression: number;
  expansion: number;
  trade: number;
  xenophobia: number;
  honor: number;
  titles: string[];
}

export const GOVERNMENTS: Government[] = [
  { name: 'Federation', aggression: 0.3, expansion: 0.6, trade: 0.8, xenophobia: 0.2, honor: 0.8, titles: ['Federation', 'Republic', 'Commonwealth', 'Union'] },
  { name: 'Military Junta', aggression: 0.85, expansion: 0.7, trade: 0.4, xenophobia: 0.6, honor: 0.5, titles: ['Hegemony', 'Dominion', 'Directorate', 'Imperium'] },
  { name: 'Corporate', aggression: 0.45, expansion: 0.8, trade: 1, xenophobia: 0.3, honor: 0.4, titles: ['Consortium', 'Combine', 'Syndicate', 'Trade Authority'] },
  { name: 'Theocracy', aggression: 0.6, expansion: 0.5, trade: 0.5, xenophobia: 0.9, honor: 0.7, titles: ['Covenant', 'Ascendancy', 'Holy Order', 'Concord'] },
  { name: 'Monarchy', aggression: 0.55, expansion: 0.6, trade: 0.6, xenophobia: 0.4, honor: 0.9, titles: ['Kingdom', 'Empire', 'Crown', 'Throne'] },
];

export const FACTION_COLORS = ['#4fa3ff', '#ff5a5a', '#ffc94a', '#7cff8a', '#d77cff', '#ff9a3c', '#3cf0e0', '#ff7ac8', '#b8ff3c', '#9aa8ff'];

export interface AlienArchetype {
  species: Species;
  label: string;
  color: string;
  hull: string;
  accent: string;
  economy: EconomyType;
  aggression: number;
  expansion: number;
  trade: number;
  xenophobia: number;
  honor: number;
  desc: string;
  behavior: 'swarm' | 'kite' | 'relentless';
}

export const ALIENS: AlienArchetype[] = [
  { species: 'hive', label: 'Hive', color: '#9cff3c', hull: '#6a8a2a', accent: '#d4ff6a', economy: 'hive', aggression: 0.9, expansion: 0.9, trade: 0.05, xenophobia: 1, honor: 0.1, behavior: 'swarm',
    desc: 'A ravenous bio-organic collective that consumes worlds. Their living ships swarm and regenerate.' },
  { species: 'synod', label: 'Synod', color: '#c29cff', hull: '#5a4a8a', accent: '#e8d4ff', economy: 'crystal', aggression: 0.25, expansion: 0.35, trade: 0.7, xenophobia: 0.5, honor: 0.9, behavior: 'kite',
    desc: 'Ancient crystalline beings. Isolationist but willing to trade rare crystals. Their ships strike from extreme range.' },
  { species: 'automata', label: 'Automata', color: '#ff5050', hull: '#4a4a52', accent: '#ff4040', economy: 'forge', aggression: 0.75, expansion: 0.8, trade: 0.2, xenophobia: 0.8, honor: 0.5, behavior: 'relentless',
    desc: 'Self-replicating machine intelligence. Relentless, heavily armored and strictly logical.' },
];

export const PIRATE_NAMES = ['Red Maw', 'Black Comet', 'Void Jackals', 'Iron Wake', 'Crimson Tide', 'Ashen Fang', 'Hollow Crown', 'Rust Vultures'];

export type SubfactionRole = 'military' | 'merchant' | 'science' | 'intelligence' | 'religious' | 'separatist';

export const SUBFACTION_TEMPLATES: Record<SubfactionRole, { names: string[]; desc: string }> = {
  military: { names: ['Navy Command', 'Home Guard', 'Admiralty', 'Legion'], desc: 'The armed forces. Offers combat and patrol missions.' },
  merchant: { names: ['Merchant Guild', 'Trade Bureau', 'Commerce League', 'Freight Union'], desc: 'Traders and haulers. Offers delivery and trade contracts.' },
  science: { names: ['Science Directorate', 'Survey Corps', 'Academy', 'Institute of Stellar Studies'], desc: 'Researchers and explorers. Offers survey and exploration missions.' },
  intelligence: { names: ['Intelligence Bureau', 'Shadow Office', 'Watchers', 'Special Operations'], desc: 'Covert operatives. Offers risky high paying jobs.' },
  religious: { names: ['Temple of the Void', 'Stellar Church', 'Faithful', 'Order of Light'], desc: 'Spiritual leaders with strong opinions on aliens.' },
  separatist: { names: ['Free Worlds Movement', 'Liberation Front', 'Frontier Coalition', 'Independence League'], desc: 'Discontented worlds seeking independence. May rebel.' },
};

export const RANKS = ['Recruit', 'Ensign', 'Lieutenant', 'Lt. Commander', 'Commander', 'Captain', 'Commodore', 'Rear Admiral', 'Vice Admiral', 'Admiral'];
export const RANK_MERIT = [0, 60, 160, 320, 560, 900, 1350, 1950, 2700, 3700];
/** Weekly salary per rank. */
export const RANK_SALARY = [150, 300, 550, 900, 1400, 2100, 3000, 4200, 5600, 7500];
/** Highest module tier purchasable at the faction's stations for a given rank. */
export function rankTier(rank: number): number {
  return rank >= 7 ? 5 : rank >= 5 ? 4 : rank >= 3 ? 3 : 2;
}
export function rankWingmen(rank: number): number {
  return Math.floor(rank / 2);
}

export interface RepTier {
  name: string;
  min: number;
  color: string;
}

export const REP_TIERS: RepTier[] = [
  { name: 'Nemesis', min: -101, color: '#ff2a2a' },
  { name: 'Hostile', min: -60, color: '#ff6a4a' },
  { name: 'Unfriendly', min: -25, color: '#ffb04a' },
  { name: 'Neutral', min: -5, color: '#c8d4e8' },
  { name: 'Friendly', min: 15, color: '#8adf6a' },
  { name: 'Trusted', min: 45, color: '#4ad0ff' },
  { name: 'Allied', min: 75, color: '#b07aff' },
];

export function repTier(v: number): RepTier {
  let t = REP_TIERS[0];
  for (const r of REP_TIERS) if (v >= r.min) t = r;
  return t;
}

export const HOSTILE_REP = -25;
