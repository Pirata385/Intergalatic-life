// Colony buildings and research used by both the campaign colonies and the
// standalone Colony Mode.

export type ColonyRes = 'food' | 'water' | 'ore' | 'metals' | 'alloys' | 'crystals' | 'med' | 'research';
export const COLONY_RES: ColonyRes[] = ['food', 'water', 'ore', 'metals', 'alloys', 'crystals', 'med', 'research'];
export const COLONY_RES_ICON: Record<ColonyRes, string> = {
  food: '🌾', water: '💧', ore: '🪨', metals: '⛓', alloys: '🔩', crystals: '🔮', med: '✚', research: '🔬',
};
/** Colony resource -> galactic commodity key used when trading with markets. */
export const COLONY_RES_COMMODITY: Partial<Record<ColonyRes, string>> = {
  food: 'food', water: 'water', ore: 'ore', metals: 'metals', alloys: 'alloys', crystals: 'crys', med: 'med',
};

export type TileType = 'plain' | 'fertile' | 'rock' | 'ore' | 'crystal' | 'ice' | 'vent' | 'mountain' | 'water' | 'lava';

export const TILE_INFO: Record<TileType, { name: string; buildable: boolean; color: string }> = {
  plain: { name: 'Plains', buildable: true, color: '#9a8a6a' },
  fertile: { name: 'Fertile Soil', buildable: true, color: '#6a9a4a' },
  rock: { name: 'Rocky Ground', buildable: true, color: '#7a7470' },
  ore: { name: 'Ore Deposit', buildable: true, color: '#a07050' },
  crystal: { name: 'Crystal Deposit', buildable: true, color: '#9a70d0' },
  ice: { name: 'Ice Field', buildable: true, color: '#c8e4f0' },
  vent: { name: 'Geothermal Vent', buildable: true, color: '#c05030' },
  mountain: { name: 'Mountains', buildable: false, color: '#5a5450' },
  water: { name: 'Water', buildable: false, color: '#3a6aa0' },
  lava: { name: 'Lava', buildable: false, color: '#e05020' },
};

export interface BuildingDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  cost: { credits: number; metals?: number; alloys?: number; crystals?: number };
  power: number; // + produce / - consume
  workers: number;
  housing?: number;
  produces?: Partial<Record<ColonyRes, number>>; // per day at full staffing
  consumes?: Partial<Record<ColonyRes, number>>;
  requiresTile?: TileType[];
  bonusTile?: { tile: TileType; mult: number };
  happiness?: number;
  health?: number;
  defense?: number;
  storage?: number;
  income?: number; // credits per day
  terraform?: number;
  research?: string; // required tech
  unique?: boolean;
  height: number; // render height (iso)
  shape: 'dome' | 'box' | 'tower' | 'panel' | 'turret' | 'pad' | 'rig' | 'spire';
  desc: string;
}

export const BUILDINGS: BuildingDef[] = [
  { id: 'hq', name: 'Colony HQ', icon: '🏛', color: '#c8d4e8', cost: { credits: 0 }, power: 6, workers: 0, housing: 60, storage: 400, income: 20, height: 1.2, shape: 'box', unique: true, desc: 'The heart of the colony. Provides power, housing and storage.' },
  { id: 'habitat', name: 'Habitat Dome', icon: '🏠', color: '#9ad0ff', cost: { credits: 600, metals: 15 }, power: -2, workers: 0, housing: 100, height: 0.8, shape: 'dome', desc: 'Pressurised living space for 100 colonists.' },
  { id: 'arcology', name: 'Arcology', icon: '🏙', color: '#b0e0ff', cost: { credits: 3500, metals: 40, alloys: 25 }, power: -6, workers: 10, housing: 450, happiness: 2, height: 2.6, shape: 'tower', research: 'arcology', desc: 'Self-contained city tower for 450 colonists.' },
  { id: 'farm', name: 'Hydroponic Farm', icon: '🌾', color: '#8adf6a', cost: { credits: 400, metals: 8 }, power: -2, workers: 12, produces: { food: 9 }, bonusTile: { tile: 'fertile', mult: 1.6 }, height: 0.5, shape: 'dome', desc: 'Grows food. +60% on fertile soil.' },
  { id: 'water', name: 'Water Extractor', icon: '💧', color: '#5ab4f0', cost: { credits: 450, metals: 10 }, power: -2, workers: 6, produces: { water: 8 }, bonusTile: { tile: 'ice', mult: 2.2 }, height: 0.9, shape: 'rig', desc: 'Extracts water. Far better on ice fields.' },
  { id: 'mine', name: 'Mine', icon: '⛏', color: '#b08a6a', cost: { credits: 500, metals: 5 }, power: -3, workers: 15, produces: { ore: 3 }, bonusTile: { tile: 'ore', mult: 3 }, height: 1, shape: 'rig', desc: 'Digs ore. Triple output on ore deposits.' },
  { id: 'crystal_mine', name: 'Crystal Extractor', icon: '🔮', color: '#b070ff', cost: { credits: 1800, metals: 30 }, power: -5, workers: 15, produces: { crystals: 1.2 }, requiresTile: ['crystal'], height: 1.2, shape: 'spire', desc: 'Harvests rare crystals. Must be built on a crystal deposit.' },
  { id: 'solar', name: 'Solar Array', icon: '☀', color: '#f0d060', cost: { credits: 350, metals: 6 }, power: 8, workers: 0, height: 0.3, shape: 'panel', desc: 'Generates power from starlight. Output depends on the star.' },
  { id: 'geothermal', name: 'Geothermal Plant', icon: '♨', color: '#e07040', cost: { credits: 900, metals: 20 }, power: 24, workers: 6, requiresTile: ['vent'], height: 1, shape: 'box', desc: 'Taps planetary heat. Must be built on a vent.' },
  { id: 'fusion', name: 'Fusion Plant', icon: '⚛', color: '#ffb040', cost: { credits: 2800, metals: 30, alloys: 20 }, power: 45, workers: 12, consumes: { water: 1.5 }, research: 'fusion', height: 1.4, shape: 'dome', desc: 'Massive power output. Consumes water.' },
  { id: 'refinery', name: 'Refinery', icon: '🏭', color: '#c8ccd4', cost: { credits: 900, metals: 10 }, power: -4, workers: 14, consumes: { ore: 4 }, produces: { metals: 2.4 }, height: 1.3, shape: 'box', desc: 'Refines ore into metals.' },
  { id: 'foundry', name: 'Alloy Foundry', icon: '🔩', color: '#8fa8c8', cost: { credits: 1800, metals: 30 }, power: -7, workers: 18, consumes: { metals: 2 }, produces: { alloys: 1.1 }, research: 'foundry', height: 1.5, shape: 'box', desc: 'Forges metals into hull alloys.' },
  { id: 'medlab', name: 'Med Lab', icon: '✚', color: '#f07070', cost: { credits: 1200, metals: 15 }, power: -3, workers: 10, consumes: { water: 1, food: 1 }, produces: { med: 1.2 }, health: 4, height: 1, shape: 'box', desc: 'Produces medical supplies and improves health.' },
  { id: 'lab', name: 'Research Lab', icon: '🔬', color: '#60e0d0', cost: { credits: 1100, metals: 12 }, power: -4, workers: 10, produces: { research: 3 }, height: 1.1, shape: 'dome', desc: 'Generates research points.' },
  { id: 'hospital', name: 'Hospital', icon: '🏥', color: '#ff9a9a', cost: { credits: 1500, metals: 15 }, power: -3, workers: 12, consumes: { med: 0.3 }, health: 12, happiness: 4, height: 1.2, shape: 'box', desc: 'Keeps colonists healthy. Reduces plague risk.' },
  { id: 'recreation', name: 'Recreation Center', icon: '🎭', color: '#ff7ac8', cost: { credits: 1000, metals: 8 }, power: -3, workers: 6, happiness: 9, height: 0.9, shape: 'dome', desc: 'Parks, arenas and holo-theatres. Boosts happiness.' },
  { id: 'warehouse', name: 'Warehouse', icon: '📦', color: '#a09080', cost: { credits: 400, metals: 10 }, power: -1, workers: 2, storage: 500, height: 0.8, shape: 'box', desc: 'Increases storage capacity.' },
  { id: 'turret', name: 'Defense Turret', icon: '🛡', color: '#ff6a4a', cost: { credits: 900, metals: 15 }, power: -2, workers: 3, defense: 12, height: 0.9, shape: 'turret', desc: 'Defends against raids.' },
  { id: 'shield', name: 'Planetary Shield', icon: '🔰', color: '#4fa3ff', cost: { credits: 6000, alloys: 40, crystals: 5 }, power: -12, workers: 8, defense: 45, research: 'shields', height: 1.6, shape: 'spire', unique: true, desc: 'Deflects meteors and orbital bombardment.' },
  { id: 'spaceport', name: 'Spaceport', icon: '🚀', color: '#e0e8f0', cost: { credits: 2500, metals: 30 }, power: -4, workers: 20, income: 60, height: 0.4, shape: 'pad', unique: true, desc: 'Enables trade: surplus goods are exported for credits.' },
  { id: 'atmo', name: 'Atmosphere Processor', icon: '🌫', color: '#9adfb0', cost: { credits: 5000, metals: 40, alloys: 30 }, power: -10, workers: 15, terraform: 1, research: 'terraform', height: 2.2, shape: 'tower', desc: 'Slowly terraforms the planet, raising habitability.' },
  { id: 'elevator', name: 'Space Elevator', icon: '🗼', color: '#ffe080', cost: { credits: 40000, alloys: 250, crystals: 40 }, power: -25, workers: 60, income: 400, research: 'elevator', height: 4, shape: 'spire', unique: true, desc: 'A tether to orbit. The crowning achievement of any colony.' },
];

export const BUILDING_MAP: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

export interface TechDef {
  id: string;
  name: string;
  cost: number;
  requires?: string[];
  desc: string;
}

export const TECHS: TechDef[] = [
  { id: 'genetics', name: 'Genetic Crops', cost: 60, desc: '+30% food production.' },
  { id: 'foundry', name: 'Alloy Metallurgy', cost: 90, desc: 'Unlocks the Alloy Foundry.' },
  { id: 'automation', name: 'Automation', cost: 140, requires: ['foundry'], desc: '-25% workers needed by all buildings.' },
  { id: 'arcology', name: 'Arcologies', cost: 160, requires: ['genetics'], desc: 'Unlocks Arcology towers.' },
  { id: 'fusion', name: 'Fusion Power', cost: 180, requires: ['foundry'], desc: 'Unlocks the Fusion Plant.' },
  { id: 'shields', name: 'Planetary Shields', cost: 260, requires: ['fusion'], desc: 'Unlocks the Planetary Shield.' },
  { id: 'terraform', name: 'Terraforming', cost: 320, requires: ['fusion', 'genetics'], desc: 'Unlocks the Atmosphere Processor.' },
  { id: 'medicine', name: 'Advanced Medicine', cost: 120, desc: '+50% health from hospitals, lower plague risk.' },
  { id: 'deepcore', name: 'Deep Core Mining', cost: 200, requires: ['automation'], desc: '+50% ore and crystal output.' },
  { id: 'elevator', name: 'Orbital Engineering', cost: 600, requires: ['shields', 'terraform', 'deepcore'], desc: 'Unlocks the Space Elevator.' },
];

export const TECH_MAP: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));
