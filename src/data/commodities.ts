// Tradable goods. Indices are stable and used in market arrays and saves.

export interface Commodity {
  id: number;
  key: string;
  name: string;
  base: number; // base price in credits per unit
  icon: string;
  color: string;
  mass: number; // cargo units per item (always 1 for simplicity, kept for balance)
  contrabandIn?: string[]; // governments where it's illegal
}

export const COMMODITIES: Commodity[] = [
  { id: 0, key: 'food', name: 'Food Rations', base: 22, icon: '🌾', color: '#9ccf6a', mass: 1 },
  { id: 1, key: 'water', name: 'Purified Water', base: 14, icon: '💧', color: '#5ab4f0', mass: 1 },
  { id: 2, key: 'ore', name: 'Raw Ore', base: 18, icon: '🪨', color: '#b08a6a', mass: 1 },
  { id: 3, key: 'ice', name: 'Volatile Ice', base: 16, icon: '🧊', color: '#bfe8ff', mass: 1 },
  { id: 4, key: 'metals', name: 'Refined Metals', base: 48, icon: '⛓', color: '#c8ccd4', mass: 1 },
  { id: 5, key: 'alloys', name: 'Hull Alloys', base: 95, icon: '🔩', color: '#8fa8c8', mass: 1 },
  { id: 6, key: 'fuel', name: 'Deuterium Fuel', base: 34, icon: '⛽', color: '#f0c050', mass: 1 },
  { id: 7, key: 'chem', name: 'Chemicals', base: 42, icon: '⚗', color: '#b0e070', mass: 1 },
  { id: 8, key: 'poly', name: 'Polymers', base: 38, icon: '🧪', color: '#e0a0e0', mass: 1 },
  { id: 9, key: 'elec', name: 'Electronics', base: 140, icon: '💾', color: '#60e0d0', mass: 1 },
  { id: 10, key: 'mach', name: 'Machinery', base: 120, icon: '⚙', color: '#d0a060', mass: 1 },
  { id: 11, key: 'med', name: 'Medical Supplies', base: 110, icon: '✚', color: '#f07070', mass: 1 },
  { id: 12, key: 'arms', name: 'Munitions', base: 160, icon: '💥', color: '#e06040', mass: 1, contrabandIn: ['Theocracy'] },
  { id: 13, key: 'lux', name: 'Luxury Goods', base: 230, icon: '💎', color: '#f0d0ff', mass: 1 },
  { id: 14, key: 'crys', name: 'Rare Crystals', base: 310, icon: '🔮', color: '#b070ff', mass: 1 },
  { id: 15, key: 'art', name: 'Alien Artifacts', base: 650, icon: '🗿', color: '#ffb040', mass: 1, contrabandIn: ['Theocracy', 'Military Junta'] },
  { id: 16, key: 'stim', name: 'Neural Stims', base: 280, icon: '💊', color: '#ff60a0', mass: 1, contrabandIn: ['Federation', 'Theocracy', 'Military Junta', 'Monarchy', 'Corporate'] },
  { id: 17, key: 'pax', name: 'Colonists', base: 60, icon: '👥', color: '#ffffff', mass: 1 },
];

export const NUM_COMMODITIES = COMMODITIES.length;
export const C = Object.fromEntries(COMMODITIES.map((c) => [c.key, c.id])) as Record<string, number>;

export type EconomyType = 'agricultural' | 'industrial' | 'mining' | 'hightech' | 'refinery' | 'military' | 'research' | 'tourism' | 'frontier' | 'hive' | 'crystal' | 'forge' | 'pirate';

export const ECONOMY_LABEL: Record<EconomyType, string> = {
  agricultural: 'Agricultural',
  industrial: 'Industrial',
  mining: 'Mining',
  hightech: 'High-Tech',
  refinery: 'Refinery',
  military: 'Military',
  research: 'Research',
  tourism: 'Tourism',
  frontier: 'Frontier',
  hive: 'Hive Brood',
  crystal: 'Crystal Choir',
  forge: 'Machine Forge',
  pirate: 'Pirate Haven',
};

// Production (+) / consumption (-) per million population per day.
// Tuned so markets move noticeably over a few weeks.
export const ECONOMY_PROFILE: Record<EconomyType, Partial<Record<string, number>>> = {
  agricultural: { food: 6, water: 2, med: -0.4, mach: -0.5, elec: -0.3, lux: -0.3, chem: -0.4, fuel: -0.5, arms: -0.2, pax: 0.4 },
  industrial: { metals: -1.5, ore: -2, alloys: 1.2, mach: 1.4, poly: 1.2, food: -2, water: -1, fuel: -0.8, elec: -0.4, chem: -0.6, stim: -0.1 },
  mining: { ore: 6, ice: 3, crys: 0.25, food: -1.6, water: -1, mach: -0.5, fuel: -0.6, med: -0.3, arms: -0.2, stim: -0.15 },
  hightech: { elec: 1.5, med: 1, lux: 0.6, metals: -0.8, poly: -0.8, chem: -0.6, food: -1.8, water: -0.9, crys: -0.15, art: -0.05 },
  refinery: { ore: -3, ice: -2, metals: 2.4, fuel: 2.5, chem: 1.2, food: -1.4, water: -0.5, mach: -0.4 },
  military: { arms: 1.2, alloys: -1, fuel: -1.5, food: -1.6, med: -0.6, elec: -0.5, metals: -0.4 },
  research: { elec: 0.3, med: 0.5, art: -0.12, crys: -0.2, chem: -0.6, food: -1.2, water: -0.6, lux: -0.3 },
  tourism: { lux: 0.5, food: -2.2, water: -1.2, med: -0.4, stim: -0.2, art: -0.05 },
  frontier: { food: 1.2, ore: 1.5, water: 1, mach: -0.8, med: -0.5, arms: -0.4, fuel: -0.6, pax: -0.3, alloys: -0.3 },
  hive: { food: 3, chem: 2, poly: 1.2, metals: -1, ore: -1.5, water: -1.2, art: 0.03 },
  crystal: { crys: 1.2, lux: 0.6, art: 0.08, elec: -0.6, metals: -0.8, water: -0.4, ice: -0.8 },
  forge: { alloys: 2, mach: 2, elec: 1, ore: -3, metals: -2, fuel: -1, ice: -0.5 },
  pirate: { stim: 0.5, arms: 0.4, food: -1.5, water: -1, fuel: -1.2, lux: -0.4, med: -0.5, mach: -0.3, alloys: -0.4 },
};

export function commodityByKey(key: string): Commodity {
  return COMMODITIES[C[key]];
}
