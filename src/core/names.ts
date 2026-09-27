// Procedural naming for stars, planets, factions, ships and people.
import { RNG } from './rng';

const HUMAN_START = ['Pho', 'Glas', 'Ve', 'Ka', 'Tar', 'Sol', 'Mir', 'Hel', 'Al', 'Cor', 'Den', 'Ery', 'Fal', 'Gan', 'Hy', 'Ix', 'Jor', 'Kel', 'Lu', 'Mar', 'Nor', 'Or', 'Pra', 'Qui', 'Ros', 'Sar', 'Tel', 'Ur', 'Val', 'Wen', 'Xan', 'Yor', 'Zel', 'Bra', 'Cae', 'Dra', 'Eo', 'Gri', 'Ha', 'Ith', 'Lo', 'Mo', 'Ne', 'Pe', 'Ri', 'Stra', 'Thu', 'Vo'];
const HUMAN_MID = ['u', 'sha', 'ka', 'ne', 'ri', 'lo', 'ta', 'ven', 'dor', 'la', 'mi', 'ro', 'sa', 'the', 'va', 'ze', 'kk', 'an', 'el', 'or', 'is', 'ar', 'en', 'ul'];
const HUMAN_END = ['nal', 'rau', 'eor', 'on', 'ia', 'us', 'is', 'ar', 'ex', 'um', 'a', 'os', 'eth', 'ine', 'or', 'ax', 'is', 'ae', 'yn', 'heim', 'gard', 'ton', 'ris', 'des', 'lon', 'mar', 'vek'];

const ALIEN_SYL: Record<string, string[]> = {
  hive: ['Zz', 'kr', 'vrr', 'ix', 'th', 'xx', 'ssk', 'kha', 'zeth', 'ul', 'rak', 'kki', 'zr', 'aa'],
  synod: ["Ae'", 'li', 'ora', 'sel', 'yth', 'ium', "ka'", 'ven', 'thal', 'ae', 'nys', 'ir', 'quo', 'ela'],
  automata: ['X', 'N-', '0', 'Tek', 'Vox', 'Arc', 'Syn', 'Ω', '-', 'Qua', 'Nul', 'Hex', '7', 'Ion'],
};

const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Sigma', 'Tau', 'Omega'];

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function starName(rng: RNG): string {
  const n = rng.int(0, 2);
  let s = rng.pick(HUMAN_START);
  for (let i = 0; i < n; i++) s += rng.pick(HUMAN_MID);
  s += rng.pick(HUMAN_END);
  s = s.replace(/(.)\1\1/g, '$1$1');
  return cap(s.toLowerCase());
}

export function catalogName(rng: RNG, prefix?: string): string {
  const letters = 'ABCDEFGHJKLMNPRSTVWXYZ';
  const p = prefix ?? letters[rng.int(0, letters.length - 1)] + letters[rng.int(0, letters.length - 1)];
  return `${p}-${rng.int(10000, 99999)}`;
}

export function planetName(star: string, index: number, rng: RNG): string {
  if (rng.chance(0.35)) return starName(rng);
  return `${star}-${String.fromCharCode(98 + index)}`;
}

export function moonName(planet: string, index: number): string {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  return `${planet} ${roman[index] ?? index + 1}`;
}

export function alienName(rng: RNG, kind: 'hive' | 'synod' | 'automata'): string {
  const syl = ALIEN_SYL[kind];
  let s = '';
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) s += rng.pick(syl);
  return cap(s);
}

const FIRST = ['Ari', 'Bex', 'Cato', 'Dara', 'Eli', 'Faye', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lena', 'Milo', 'Nia', 'Oren', 'Pia', 'Quinn', 'Rhea', 'Silas', 'Tova', 'Uma', 'Vex', 'Wren', 'Xia', 'Yuri', 'Zane', 'Ines', 'Rook', 'Sable', 'Tamsin', 'Oskar', 'Mara'];
const LAST = ['Vance', 'Okoro', 'Reyes', 'Holt', 'Nakamura', 'Stroud', 'Kade', 'Ivers', 'Moreau', 'Achebe', 'Lindqvist', 'Park', 'Duarte', 'Varga', 'Sato', 'Kovac', 'Quill', 'Marsh', 'Draven', 'Ossian', 'Petrov', 'Adeyemi', 'Castellan', 'Reinholt'];

export function personName(rng: RNG): string {
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}

const SHIP_WORDS = ['Valor', 'Dawn', 'Nomad', 'Serpent', 'Monsoon', 'Tempest', 'Aurora', 'Vigil', 'Harbinger', 'Radiant', 'Wanderer', 'Talon', 'Obsidian', 'Specter', 'Meridian', 'Zenith', 'Corsair', 'Leviathan', 'Pilgrim', 'Sovereign', 'Ember', 'Halcyon', 'Rampart', 'Kestrel', 'Nightfall', 'Borealis'];

export function shipName(rng: RNG): string {
  return rng.chance(0.5) ? `${rng.pick(SHIP_WORDS)}` : `${rng.pick(SHIP_WORDS)} ${rng.pick(GREEK)}`;
}

export { GREEK };
