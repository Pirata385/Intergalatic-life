// Ship modules ("voxel blocks"). Ships are grids of these blocks; every block
// has its own HP and contributes to the ship's derived stats.

export type ModuleCategory = 'armor' | 'thruster' | 'energy' | 'weapon' | 'special' | 'decorative';
export type Species = 'human' | 'hive' | 'synod' | 'automata';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type AmmoType = 'shells' | 'slugs' | 'missiles' | 'torpedoes';

export interface WeaponDef {
  kind: 'beam' | 'projectile' | 'missile' | 'torpedo' | 'pd' | 'mining' | 'drone';
  damage: number; // per hit; beams: damage per second
  rof: number; // shots per second (beams: 1 = continuous)
  range: number; // world units
  speed: number; // projectile speed
  energy: number; // energy per shot (beams: per second)
  ammo?: AmmoType;
  spread: number; // radians
  shieldMult: number;
  hullMult: number;
  armorPen: number;
  arc: number; // total traverse arc in radians (TAU = omni)
  turnRate: number; // turret rad/s
  color: string;
  size: number;
  splash?: number;
  homing?: number; // rad/s
  dot?: number; // acid damage per second for 3s
  count?: number; // projectiles per shot
  sound: 'laser' | 'pulse' | 'gun' | 'rail' | 'missile' | 'torpedo' | 'ion' | 'plasma' | 'acid' | 'crystal' | 'mining';
}

export interface ModuleDef {
  id: string;
  name: string;
  cat: ModuleCategory;
  w: number;
  h: number;
  tier: number;
  cost: number;
  mass: number;
  hp: number;
  armor: number;
  power: number; // +generation / -consumption (continuous, per second)
  crew: number; // crew required
  crewCap?: number;
  thrust?: number;
  turn?: number;
  shieldCap?: number;
  shieldRegen?: number;
  battery?: number;
  cargo?: number;
  fuel?: number;
  jump?: number;
  sensor?: number;
  ammoCap?: number;
  weapon?: WeaponDef;
  repair?: number;
  tractor?: number;
  cloak?: boolean;
  colony?: number;
  mining?: number;
  scan?: number;
  drones?: number;
  leadership?: number;
  explosive?: number; // explodes when destroyed
  beamResist?: number;
  regen?: number; // self-repair hp/s
  species: Species;
  rarity: Rarity;
  art: string;
  desc: string;
  rotatable: boolean;
  shape?: 'full' | 'slope';
  command?: boolean;
}

const TAU = Math.PI * 2;

/** Global damage multiplier keeps block-based combat snappy. */
export const DAMAGE_SCALE = 1.8;

const W = (w: Partial<WeaponDef> & Pick<WeaponDef, 'kind' | 'damage' | 'rof' | 'range' | 'sound' | 'color'>): WeaponDef => ({
  speed: 900,
  energy: 0,
  spread: 0.02,
  shieldMult: 1,
  hullMult: 1,
  armorPen: 0,
  arc: TAU * 0.85,
  turnRate: 3.5,
  size: 3,
  ...w,
  damage: w.damage * (w.kind === 'mining' ? 1 : DAMAGE_SCALE),
});

type MD = Omit<ModuleDef, 'rotatable' | 'species' | 'rarity' | 'crew' | 'armor' | 'power'> &
  Partial<Pick<ModuleDef, 'rotatable' | 'species' | 'rarity' | 'crew' | 'armor' | 'power'>>;

const RARITY_BY_TIER: Rarity[] = ['common', 'common', 'uncommon', 'rare', 'epic', 'legendary'];

function M(d: MD): ModuleDef {
  return {
    rotatable: true,
    species: 'human',
    rarity: RARITY_BY_TIER[d.tier] ?? 'common',
    crew: 0,
    armor: 0,
    power: 0,
    ...d,
  };
}

export const MODULES: ModuleDef[] = [
  // ---------------- Command ----------------
  M({ id: 'cockpit', name: 'Cockpit', cat: 'special', w: 2, h: 2, tier: 1, cost: 400, mass: 6, hp: 140, armor: 2, power: 2, crewCap: 2, crew: 1, sensor: 1400, command: true, art: 'cockpit', desc: 'Compact flight deck. Every ship needs a command module.' }),
  M({ id: 'bridge', name: 'Bridge', cat: 'special', w: 3, h: 3, tier: 2, cost: 2200, mass: 14, hp: 360, armor: 4, power: 4, crewCap: 5, crew: 2, sensor: 2000, command: true, leadership: 1, art: 'bridge', desc: 'Armored bridge with improved sensors and room for officers.' }),
  M({ id: 'command', name: 'Command Center', cat: 'special', w: 3, h: 3, tier: 4, cost: 14000, mass: 20, hp: 650, armor: 7, power: 6, crewCap: 8, crew: 3, sensor: 2800, command: true, leadership: 2, art: 'command', desc: 'Flagship command nexus. Coordinates wingmen and long range sensors.' }),

  // ---------------- Armor ----------------
  M({ id: 'hull', name: 'Hull Frame', cat: 'armor', w: 1, h: 1, tier: 1, cost: 12, mass: 1, hp: 30, art: 'hull', desc: 'Light structural framing. Cheap and light.', rotatable: false }),
  M({ id: 'armor', name: 'Light Armor', cat: 'armor', w: 1, h: 1, tier: 1, cost: 30, mass: 2, hp: 70, armor: 2, art: 'armor', desc: 'Standard composite armor plating.', rotatable: false }),
  M({ id: 'armor_slope', name: 'Armor Slope', cat: 'armor', w: 1, h: 1, tier: 1, cost: 34, mass: 1.5, hp: 55, armor: 2, art: 'slope', shape: 'slope', desc: 'Angled armor for sleek hull lines.' }),
  M({ id: 'armor_heavy', name: 'Heavy Armor', cat: 'armor', w: 1, h: 1, tier: 2, cost: 75, mass: 4, hp: 140, armor: 5, art: 'armor_heavy', desc: 'Thick heavily armored hull plating.', rotatable: false }),
  M({ id: 'armor_hslope', name: 'Heavy Armor Cap', cat: 'armor', w: 1, h: 1, tier: 2, cost: 85, mass: 3.5, hp: 120, armor: 5, art: 'slope_heavy', shape: 'slope', desc: 'Heavily armored hull cap.' }),
  M({ id: 'armor_reactive', name: 'Reactive Armor', cat: 'armor', w: 1, h: 1, tier: 3, cost: 180, mass: 5, hp: 170, armor: 8, art: 'armor_reactive', desc: 'Explosive reactive plates that blunt kinetic impacts.', rotatable: false }),
  M({ id: 'armor_nano', name: 'Nanoweave Armor', cat: 'armor', w: 1, h: 1, tier: 4, cost: 420, mass: 4, hp: 210, armor: 10, regen: 1.2, art: 'armor_nano', desc: 'Self-repairing nanite lattice.', rotatable: false }),
  M({ id: 'armor_chitin', name: 'Chitin Plating', cat: 'armor', w: 1, h: 1, tier: 2, cost: 140, mass: 2.5, hp: 150, armor: 4, regen: 0.8, species: 'hive', art: 'bio_armor', desc: 'Living chitin that slowly regrows.', rotatable: false }),
  M({ id: 'armor_chitin_s', name: 'Chitin Spur', cat: 'armor', w: 1, h: 1, tier: 2, cost: 140, mass: 2, hp: 120, armor: 4, regen: 0.8, species: 'hive', art: 'bio_slope', shape: 'slope', desc: 'Curved chitin spine.' }),
  M({ id: 'armor_crystal', name: 'Crystal Lattice', cat: 'armor', w: 1, h: 1, tier: 3, cost: 260, mass: 2, hp: 120, armor: 6, beamResist: 0.5, species: 'synod', art: 'crys_armor', desc: 'Refractive crystal that scatters beam weapons.', rotatable: false }),
  M({ id: 'armor_crystal_s', name: 'Crystal Shard', cat: 'armor', w: 1, h: 1, tier: 3, cost: 260, mass: 1.6, hp: 100, armor: 6, beamResist: 0.5, species: 'synod', art: 'crys_slope', shape: 'slope', desc: 'Faceted crystal edge.' }),
  M({ id: 'armor_adaptive', name: 'Adaptive Plating', cat: 'armor', w: 1, h: 1, tier: 3, cost: 240, mass: 4.5, hp: 180, armor: 7, species: 'automata', art: 'mech_armor', desc: 'Machine plating that hardens under fire.', rotatable: false }),
  M({ id: 'armor_adaptive_s', name: 'Adaptive Wedge', cat: 'armor', w: 1, h: 1, tier: 3, cost: 240, mass: 4, hp: 160, armor: 7, species: 'automata', art: 'mech_slope', shape: 'slope', desc: 'Angular machine plating.' }),

  // ---------------- Thrusters (exhaust faces -X at rotation 0) ----------------
  M({ id: 'thruster', name: 'Small Thruster', cat: 'thruster', w: 1, h: 1, tier: 1, cost: 120, mass: 1.5, hp: 45, power: -0.5, thrust: 70, turn: 6, art: 'thruster', desc: 'Compact chemical thruster.' }),
  M({ id: 'maneuver', name: 'Maneuver Jet', cat: 'thruster', w: 1, h: 1, tier: 1, cost: 160, mass: 1, hp: 40, power: -0.3, thrust: 12, turn: 45, art: 'maneuver', desc: 'Omni-directional RCS jets. Greatly improves turning.' }),
  M({ id: 'engine', name: 'Ion Engine', cat: 'thruster', w: 2, h: 2, tier: 1, cost: 650, mass: 6, hp: 130, power: -2, thrust: 300, turn: 12, crew: 0, art: 'engine', desc: 'Reliable ion propulsion unit.' }),
  M({ id: 'afterburner', name: 'Afterburner', cat: 'thruster', w: 2, h: 1, tier: 2, cost: 900, mass: 3, hp: 70, power: -1, thrust: 220, turn: 4, art: 'afterburner', desc: 'High-output boost thruster.' }),
  M({ id: 'engine_fusion', name: 'Fusion Drive', cat: 'thruster', w: 2, h: 3, tier: 3, cost: 2800, mass: 14, hp: 320, power: -5, thrust: 900, turn: 25, crew: 1, art: 'engine_big', desc: 'Capital-grade fusion torch.' }),
  M({ id: 'engine_bio', name: 'Bio-Propulsor', cat: 'thruster', w: 2, h: 2, tier: 2, cost: 1100, mass: 5, hp: 160, power: -1, thrust: 360, turn: 30, species: 'hive', regen: 0.6, art: 'bio_engine', desc: 'Pulsing organic jet sac.' }),
  M({ id: 'engine_sail', name: 'Resonance Sail', cat: 'thruster', w: 2, h: 2, tier: 3, cost: 1600, mass: 3, hp: 110, power: 0, thrust: 330, turn: 40, species: 'synod', art: 'crys_engine', desc: 'Rides harmonic currents without draining power.' }),
  M({ id: 'engine_grav', name: 'Graviton Drive', cat: 'thruster', w: 2, h: 2, tier: 3, cost: 1700, mass: 7, hp: 200, power: -2, thrust: 460, turn: 20, species: 'automata', art: 'mech_engine', desc: 'Manipulates local gravity gradients.' }),

  // ---------------- Energy ----------------
  M({ id: 'reactor_micro', name: 'Micro Reactor', cat: 'energy', w: 1, h: 1, tier: 1, cost: 300, mass: 2, hp: 50, power: 6, explosive: 40, art: 'reactor_s', desc: 'Small power cell.', rotatable: false }),
  M({ id: 'reactor', name: 'Fission Reactor', cat: 'energy', w: 2, h: 2, tier: 1, cost: 1100, mass: 8, hp: 160, power: 22, crew: 1, explosive: 90, art: 'reactor', desc: 'Workhorse ship reactor.', rotatable: false }),
  M({ id: 'reactor_fusion', name: 'Fusion Reactor', cat: 'energy', w: 3, h: 3, tier: 3, cost: 4200, mass: 16, hp: 380, power: 60, crew: 1, explosive: 160, art: 'reactor_l', desc: 'High output fusion core.', rotatable: false }),
  M({ id: 'reactor_am', name: 'Antimatter Core', cat: 'energy', w: 3, h: 3, tier: 5, cost: 16000, mass: 14, hp: 420, power: 130, crew: 2, explosive: 320, art: 'reactor_am', desc: 'Enormous output. Enormous explosion.', rotatable: false }),
  M({ id: 'battery', name: 'Capacitor Bank', cat: 'energy', w: 1, h: 2, tier: 1, cost: 250, mass: 2, hp: 60, battery: 160, art: 'battery', desc: 'Stores energy for weapon bursts.' }),
  M({ id: 'solar', name: 'Solar Panel', cat: 'energy', w: 2, h: 1, tier: 1, cost: 140, mass: 1, hp: 25, power: 3, art: 'solar', desc: 'Low output, lightweight.' }),
  M({ id: 'bio_heart', name: 'Bio-Heart', cat: 'energy', w: 2, h: 2, tier: 2, cost: 1500, mass: 6, hp: 220, power: 32, regen: 1, species: 'hive', art: 'bio_heart', desc: 'Beating organ that metabolises stellar radiation.', rotatable: false }),
  M({ id: 'crystal_heart', name: 'Crystal Heart', cat: 'energy', w: 2, h: 2, tier: 3, cost: 2600, mass: 4, hp: 160, power: 44, species: 'synod', art: 'crys_heart', desc: 'Singing crystal focus.', rotatable: false }),
  M({ id: 'singularity', name: 'Singularity Core', cat: 'energy', w: 3, h: 3, tier: 4, cost: 9000, mass: 12, hp: 360, power: 95, explosive: 220, species: 'automata', art: 'mech_core', desc: 'Micro black hole bound in a lattice.', rotatable: false }),

  // ---------------- Weapons ----------------
  M({ id: 'laser', name: 'Laser Turret', cat: 'weapon', w: 1, h: 1, tier: 1, cost: 700, mass: 2, hp: 55, crew: 1, art: 'turret', desc: 'Continuous beam. Accurate, energy hungry.',
    weapon: W({ kind: 'beam', damage: 20, rof: 1, range: 430, energy: 5, color: '#ff4060', sound: 'laser', shieldMult: 1.1 }) }),
  M({ id: 'laser_heavy', name: 'Heavy Laser', cat: 'weapon', w: 2, h: 2, tier: 2, cost: 2600, mass: 6, hp: 150, crew: 1, art: 'turret_big', desc: 'Powerful beam turret.',
    weapon: W({ kind: 'beam', damage: 58, rof: 1, range: 540, energy: 13, color: '#ff3080', sound: 'laser', shieldMult: 1.1, turnRate: 2.2 }) }),
  M({ id: 'pulse', name: 'Pulse Cannon', cat: 'weapon', w: 1, h: 1, tier: 1, cost: 600, mass: 2, hp: 55, crew: 1, art: 'cannon', desc: 'Fires bolts of plasma.',
    weapon: W({ kind: 'projectile', damage: 13, rof: 2.4, range: 540, speed: 950, energy: 3, color: '#60f0ff', sound: 'pulse' }) }),
  M({ id: 'pulse_heavy', name: 'Heavy Pulse Cannon', cat: 'weapon', w: 2, h: 2, tier: 2, cost: 2400, mass: 7, hp: 160, crew: 1, art: 'cannon_big', desc: 'Average range, high rate of fire.',
    weapon: W({ kind: 'projectile', damage: 40, rof: 1.6, range: 620, speed: 1000, energy: 9, color: '#40c0ff', sound: 'pulse', size: 5, turnRate: 2.4 }) }),
  M({ id: 'autocannon', name: 'Autocannon', cat: 'weapon', w: 1, h: 1, tier: 1, cost: 500, mass: 3, hp: 60, crew: 1, art: 'gun', ammoCap: 200, desc: 'Rapid kinetic fire. Uses shells.',
    weapon: W({ kind: 'projectile', damage: 6.5, rof: 5, range: 500, speed: 1200, ammo: 'shells', color: '#ffd080', sound: 'gun', spread: 0.05, shieldMult: 0.7, hullMult: 1.25, size: 2 }) }),
  M({ id: 'flak', name: 'Point Defense', cat: 'weapon', w: 1, h: 1, tier: 1, cost: 650, mass: 2, hp: 50, crew: 0, art: 'pd', desc: 'Shoots down missiles and torpedoes automatically.',
    weapon: W({ kind: 'pd', damage: 14, rof: 5, range: 300, speed: 1500, energy: 1, color: '#ffff80', sound: 'gun', spread: 0.06, arc: TAU, turnRate: 8, size: 2 }) }),
  M({ id: 'railgun', name: 'Railgun', cat: 'weapon', w: 3, h: 1, tier: 3, cost: 5200, mass: 9, hp: 170, crew: 1, art: 'railgun', ammoCap: 30, desc: 'Spinal mount. Devastating long range slugs.',
    weapon: W({ kind: 'projectile', damage: 150, rof: 0.45, range: 1150, speed: 2800, energy: 14, ammo: 'slugs', color: '#a0e0ff', sound: 'rail', spread: 0.003, armorPen: 10, arc: 0.45, turnRate: 1, size: 3 }) }),
  M({ id: 'missile', name: 'Missile Rack', cat: 'weapon', w: 2, h: 1, tier: 1, cost: 1400, mass: 4, hp: 80, crew: 1, art: 'launcher', ammoCap: 16, desc: 'Homing missiles.',
    weapon: W({ kind: 'missile', damage: 48, rof: 0.7, range: 950, speed: 520, ammo: 'missiles', color: '#ffa040', sound: 'missile', homing: 3.2, arc: TAU, splash: 20, size: 4 }) }),
  M({ id: 'torpedo', name: 'Torpedo Bay', cat: 'weapon', w: 3, h: 2, tier: 3, cost: 6800, mass: 14, hp: 260, crew: 2, art: 'torpedo', ammoCap: 6, desc: 'Slow capital-killer torpedoes.',
    weapon: W({ kind: 'torpedo', damage: 320, rof: 0.16, range: 1050, speed: 330, ammo: 'torpedoes', color: '#ff6040', sound: 'torpedo', homing: 1.1, splash: 70, arc: 0.9, turnRate: 1, size: 7, armorPen: 6 }) }),
  M({ id: 'ion', name: 'Ion Cannon', cat: 'weapon', w: 2, h: 2, tier: 2, cost: 2800, mass: 6, hp: 140, crew: 1, art: 'ion', desc: 'Overloads shields. Weak against hull.',
    weapon: W({ kind: 'projectile', damage: 34, rof: 1.1, range: 600, speed: 850, energy: 10, color: '#8080ff', sound: 'ion', shieldMult: 3.2, hullMult: 0.3, size: 5 }) }),
  M({ id: 'plasma_lance', name: 'Plasma Lance', cat: 'weapon', w: 3, h: 2, tier: 4, cost: 11000, mass: 12, hp: 280, crew: 2, art: 'lance', desc: 'Forward-firing plasma beam of immense power.',
    weapon: W({ kind: 'beam', damage: 150, rof: 1, range: 640, energy: 34, color: '#ff80ff', sound: 'plasma', arc: 0.6, turnRate: 1.2, armorPen: 6 }) }),
  M({ id: 'mining_laser', name: 'Mining Laser', cat: 'weapon', w: 1, h: 1, tier: 1, cost: 450, mass: 2, hp: 45, crew: 0, art: 'mining', mining: 1, desc: 'Extracts ore from asteroids. Weak in combat.',
    weapon: W({ kind: 'mining', damage: 5, rof: 1, range: 320, energy: 2, color: '#70ff90', sound: 'mining' }) }),
  M({ id: 'mining_heavy', name: 'Strip Miner', cat: 'weapon', w: 2, h: 2, tier: 2, cost: 1800, mass: 6, hp: 120, crew: 1, art: 'mining_big', mining: 3, desc: 'Industrial mining beam.',
    weapon: W({ kind: 'mining', damage: 12, rof: 1, range: 380, energy: 6, color: '#50ffa0', sound: 'mining', turnRate: 2 }) }),
  // Alien weapons
  M({ id: 'acid', name: 'Acid Spitter', cat: 'weapon', w: 1, h: 1, tier: 2, cost: 1200, mass: 2, hp: 80, species: 'hive', regen: 0.5, art: 'bio_gun', desc: 'Spits corrosive bile that eats through hulls.',
    weapon: W({ kind: 'projectile', damage: 10, rof: 2, range: 440, speed: 700, energy: 1, color: '#a0ff40', sound: 'acid', dot: 6, shieldMult: 0.6, size: 4 }) }),
  M({ id: 'spore', name: 'Spore Launcher', cat: 'weapon', w: 2, h: 2, tier: 3, cost: 3400, mass: 5, hp: 170, species: 'hive', regen: 0.5, art: 'bio_launcher', desc: 'Releases swarms of homing spores.',
    weapon: W({ kind: 'missile', damage: 16, rof: 1.2, range: 850, speed: 480, energy: 4, count: 3, color: '#d0ff60', sound: 'acid', homing: 4, arc: TAU, dot: 3, size: 3 }) }),
  M({ id: 'crystal_lance', name: 'Crystal Lance', cat: 'weapon', w: 2, h: 1, tier: 3, cost: 3600, mass: 3, hp: 110, species: 'synod', art: 'crys_lance', desc: 'Focused harmonic beam with extreme range.',
    weapon: W({ kind: 'beam', damage: 45, rof: 1, range: 900, energy: 10, color: '#c0a0ff', sound: 'crystal', turnRate: 2.5, armorPen: 3 }) }),
  M({ id: 'prism', name: 'Prism Array', cat: 'weapon', w: 1, h: 1, tier: 2, cost: 1500, mass: 1.5, hp: 70, species: 'synod', art: 'crys_prism', desc: 'Splits light into a spread of shards.',
    weapon: W({ kind: 'projectile', damage: 9, rof: 1.8, range: 560, speed: 1100, energy: 5, count: 3, spread: 0.12, color: '#e0c0ff', sound: 'crystal' }) }),
  M({ id: 'disruptor', name: 'Disruptor', cat: 'weapon', w: 2, h: 2, tier: 3, cost: 3800, mass: 6, hp: 190, species: 'automata', art: 'mech_gun', desc: 'Phased energy slugs effective against shields and armor.',
    weapon: W({ kind: 'projectile', damage: 42, rof: 1.3, range: 660, speed: 1150, energy: 9, color: '#ff4040', sound: 'ion', shieldMult: 1.8, armorPen: 5, size: 4 }) }),
  M({ id: 'drone_bay', name: 'Drone Bay', cat: 'weapon', w: 2, h: 2, tier: 3, cost: 4500, mass: 7, hp: 170, crew: 1, drones: 2, art: 'hangar', desc: 'Launches autonomous attack drones.',
    weapon: W({ kind: 'drone', damage: 7, rof: 0.1, range: 900, energy: 0, color: '#80ffc0', sound: 'pulse', arc: TAU }) }),

  // ---------------- Shields ----------------
  M({ id: 'shield', name: 'Shield Generator', cat: 'energy', w: 2, h: 2, tier: 1, cost: 1300, mass: 5, hp: 110, power: -4, crew: 1, shieldCap: 160, shieldRegen: 12, art: 'shield', desc: 'Projects a deflector bubble.', rotatable: false }),
  M({ id: 'shield_cap', name: 'Shield Capacitor', cat: 'energy', w: 1, h: 1, tier: 2, cost: 700, mass: 2, hp: 50, power: -1, shieldCap: 70, shieldRegen: 2, art: 'shield_cap', desc: 'Adds shield capacity.', rotatable: false }),
  M({ id: 'shield_large', name: 'Shield Projector', cat: 'energy', w: 3, h: 3, tier: 3, cost: 5200, mass: 12, hp: 300, power: -10, crew: 1, shieldCap: 520, shieldRegen: 32, art: 'shield_big', desc: 'Capital deflector array.', rotatable: false }),
  M({ id: 'membrane', name: 'Psionic Membrane', cat: 'energy', w: 2, h: 2, tier: 2, cost: 1800, mass: 3, hp: 130, power: -2, shieldCap: 200, shieldRegen: 20, species: 'hive', art: 'bio_shield', desc: 'Pulsating bio-field.', rotatable: false }),
  M({ id: 'resonant', name: 'Resonant Barrier', cat: 'energy', w: 2, h: 2, tier: 3, cost: 3000, mass: 3, hp: 120, power: -3, shieldCap: 320, shieldRegen: 28, species: 'synod', art: 'crys_shield', desc: 'Harmonic force field.', rotatable: false }),
  M({ id: 'phase', name: 'Phase Field', cat: 'energy', w: 2, h: 2, tier: 3, cost: 3000, mass: 5, hp: 170, power: -5, shieldCap: 300, shieldRegen: 22, species: 'automata', art: 'mech_shield', desc: 'Phase-shifted deflector.', rotatable: false }),

  // ---------------- Special ----------------
  M({ id: 'jump', name: 'Jump Drive', cat: 'special', w: 2, h: 2, tier: 1, cost: 1600, mass: 6, hp: 110, power: -1, jump: 14, crew: 1, art: 'jump', desc: 'Faster-than-light jump drive. Range 14 ly.', rotatable: false }),
  M({ id: 'jump2', name: 'Jump Drive Mk II', cat: 'special', w: 2, h: 2, tier: 2, cost: 5200, mass: 6, hp: 130, power: -2, jump: 22, crew: 1, art: 'jump2', desc: 'Improved FTL drive. Range 22 ly.', rotatable: false }),
  M({ id: 'jump3', name: 'Hyperspace Engine', cat: 'special', w: 3, h: 3, tier: 4, cost: 18000, mass: 14, hp: 260, power: -4, jump: 36, crew: 2, art: 'jump3', desc: 'Military hyperspace engine. Range 36 ly.', rotatable: false }),
  M({ id: 'cargo_pod', name: 'Cargo Pod', cat: 'special', w: 1, h: 1, tier: 1, cost: 90, mass: 1, hp: 40, cargo: 6, art: 'cargo_s', desc: 'Small cargo container.', rotatable: false }),
  M({ id: 'cargo', name: 'Cargo Hold', cat: 'special', w: 2, h: 2, tier: 1, cost: 450, mass: 4, hp: 110, cargo: 30, art: 'cargo', desc: 'Standard cargo hold.', rotatable: false }),
  M({ id: 'cargo_bulk', name: 'Bulk Hold', cat: 'special', w: 3, h: 3, tier: 2, cost: 1500, mass: 9, hp: 220, cargo: 80, art: 'cargo_l', desc: 'Large freight hold.', rotatable: false }),
  M({ id: 'fuel', name: 'Fuel Tank', cat: 'special', w: 1, h: 2, tier: 1, cost: 220, mass: 2, hp: 50, fuel: 40, explosive: 30, art: 'fuel', desc: 'Deuterium storage for jumps.' }),
  M({ id: 'crew', name: 'Crew Quarters', cat: 'special', w: 2, h: 2, tier: 1, cost: 500, mass: 4, hp: 100, crewCap: 6, art: 'crew', desc: 'Bunks for six crew.', rotatable: false }),
  M({ id: 'sensor', name: 'Sensor Array', cat: 'special', w: 1, h: 1, tier: 1, cost: 600, mass: 1, hp: 35, sensor: 900, scan: 1, art: 'sensor', desc: 'Extends radar range and scan speed.' }),
  M({ id: 'scanner', name: 'Survey Scanner', cat: 'special', w: 2, h: 1, tier: 2, cost: 2200, mass: 2, hp: 60, power: -1, scan: 3, sensor: 400, art: 'scanner', desc: 'Deep planetary survey suite. Faster scans, better data.' }),
  M({ id: 'tractor', name: 'Tractor Beam', cat: 'special', w: 1, h: 1, tier: 1, cost: 700, mass: 1.5, hp: 40, power: -0.5, tractor: 260, art: 'tractor', desc: 'Pulls in loot and cargo pods.' }),
  M({ id: 'repair', name: 'Repair Bay', cat: 'special', w: 2, h: 2, tier: 2, cost: 3200, mass: 6, hp: 120, power: -3, crew: 1, repair: 5, art: 'repair', desc: 'Drones repair damaged blocks over time.', rotatable: false }),
  M({ id: 'magazine', name: 'Ammo Magazine', cat: 'special', w: 1, h: 1, tier: 1, cost: 350, mass: 2, hp: 40, ammoCap: 1, explosive: 50, art: 'magazine', desc: 'Doubles ammunition storage of nearby launchers.', rotatable: false }),
  M({ id: 'cloak', name: 'Cloaking Device', cat: 'special', w: 2, h: 2, tier: 5, cost: 25000, mass: 5, hp: 90, power: -8, cloak: true, species: 'synod', art: 'cloak', desc: 'Bends light around the ship. Enemies lose lock.', rotatable: false }),
  M({ id: 'colony_pod', name: 'Colony Pod', cat: 'special', w: 3, h: 3, tier: 1, cost: 20000, mass: 16, hp: 250, colony: 1, art: 'colony', desc: 'Prefab colony with landing systems. Found a colony on any solid world.', rotatable: false }),

  // ---------------- Decorative ----------------
  M({ id: 'window', name: 'Viewport', cat: 'decorative', w: 1, h: 1, tier: 1, cost: 20, mass: 1, hp: 25, art: 'window', desc: 'Lit windows.', rotatable: false }),
  M({ id: 'light', name: 'Running Light', cat: 'decorative', w: 1, h: 1, tier: 1, cost: 15, mass: 0.5, hp: 15, art: 'light', desc: 'Blinking navigation light.', rotatable: false }),
  M({ id: 'antenna', name: 'Antenna', cat: 'decorative', w: 1, h: 1, tier: 1, cost: 25, mass: 0.5, hp: 15, art: 'antenna', desc: 'Comms antenna.' }),
  M({ id: 'fin', name: 'Stabilizer Fin', cat: 'decorative', w: 1, h: 1, tier: 1, cost: 25, mass: 0.5, hp: 20, art: 'fin', shape: 'slope', desc: 'Purely aesthetic fin.' }),
  M({ id: 'stripe', name: 'Accent Plate', cat: 'decorative', w: 1, h: 1, tier: 1, cost: 18, mass: 1, hp: 30, art: 'stripe', desc: 'Painted in the accent color.', rotatable: false }),
  M({ id: 'vent', name: 'Heat Vent', cat: 'decorative', w: 1, h: 1, tier: 1, cost: 18, mass: 1, hp: 25, art: 'vent', desc: 'Glowing heat exhaust grille.' }),
  M({ id: 'emblem', name: 'Faction Emblem', cat: 'decorative', w: 2, h: 2, tier: 1, cost: 60, mass: 1, hp: 40, art: 'emblem', desc: 'Displays your insignia.', rotatable: false }),
];

export const MODULE_MAP: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.id, m]));

export function getModule(id: string): ModuleDef {
  const m = MODULE_MAP[id];
  if (!m) throw new Error('Unknown module ' + id);
  return m;
}

export const AMMO: Record<AmmoType, { name: string; price: number; perUnit: number }> = {
  shells: { name: 'Autocannon Shells', price: 2, perUnit: 1 },
  slugs: { name: 'Railgun Slugs', price: 12, perUnit: 1 },
  missiles: { name: 'Missiles', price: 55, perUnit: 1 },
  torpedoes: { name: 'Torpedoes', price: 240, perUnit: 1 },
};

export interface HullFrame {
  id: string;
  name: string;
  w: number;
  h: number;
  cost: number;
  tier: number;
  desc: string;
}

export const FRAMES: HullFrame[] = [
  { id: 'scout', name: 'Scout Frame', w: 14, h: 10, cost: 0, tier: 1, desc: 'Starter frame. 14×10 grid.' },
  { id: 'frigate', name: 'Frigate Frame', w: 20, h: 13, cost: 9000, tier: 1, desc: 'Versatile mid-size frame. 20×13 grid.' },
  { id: 'destroyer', name: 'Destroyer Frame', w: 26, h: 16, cost: 32000, tier: 2, desc: 'Warship frame. 26×16 grid.' },
  { id: 'cruiser', name: 'Cruiser Frame', w: 32, h: 20, cost: 90000, tier: 3, desc: 'Heavy frame. 32×20 grid.' },
  { id: 'capital', name: 'Capital Frame', w: 40, h: 24, cost: 240000, tier: 4, desc: 'Dreadnought frame. 40×24 grid.' },
];

export const FRAME_MAP: Record<string, HullFrame> = Object.fromEntries(FRAMES.map((f) => [f.id, f]));

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#c8d4e8',
  uncommon: '#6fe08a',
  rare: '#5aa8ff',
  epic: '#c07aff',
  legendary: '#ffb040',
};
