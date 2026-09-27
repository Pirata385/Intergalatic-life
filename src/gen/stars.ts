// Stellar classes and their physical/visual parameters.
import { RNG } from '../core/rng';

export type StarClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'WD' | 'NS' | 'BH';

export interface StarDef {
  cls: StarClass;
  color: string;
  glow: string;
  lum: number; // solar luminosities
  temp: number; // K
  mass: number;
  radius: number; // visual radius in system world units
}

interface ClassInfo {
  color: string;
  glow: string;
  lum: [number, number];
  temp: [number, number];
  mass: [number, number];
  radius: [number, number];
  weight: number;
  label: string;
}

export const STAR_CLASSES: Record<StarClass, ClassInfo> = {
  O: { color: '#9bb0ff', glow: '#6d8cff', lum: [30000, 90000], temp: [30000, 45000], mass: [16, 60], radius: [300, 360], weight: 0.4, label: 'Blue Giant (O)' },
  B: { color: '#aabfff', glow: '#8aa6ff', lum: [30, 2000], temp: [10000, 30000], mass: [2.1, 16], radius: [230, 300], weight: 1.6, label: 'Blue-White Star (B)' },
  A: { color: '#dde6ff', glow: '#b8c8ff', lum: [5, 25], temp: [7500, 10000], mass: [1.4, 2.1], radius: [190, 230], weight: 4, label: 'White Star (A)' },
  F: { color: '#fff4e8', glow: '#ffe8c8', lum: [1.5, 5], temp: [6000, 7500], mass: [1.04, 1.4], radius: [165, 195], weight: 8, label: 'Yellow-White Star (F)' },
  G: { color: '#fff1c0', glow: '#ffd98a', lum: [0.6, 1.5], temp: [5200, 6000], mass: [0.8, 1.04], radius: [145, 170], weight: 12, label: 'Yellow Dwarf (G)' },
  K: { color: '#ffd29a', glow: '#ffb060', lum: [0.08, 0.6], temp: [3700, 5200], mass: [0.45, 0.8], radius: [120, 150], weight: 18, label: 'Orange Dwarf (K)' },
  M: { color: '#ffb080', glow: '#ff7a40', lum: [0.005, 0.08], temp: [2400, 3700], mass: [0.08, 0.45], radius: [90, 125], weight: 38, label: 'Red Dwarf (M)' },
  WD: { color: '#e8f0ff', glow: '#b0c8ff', lum: [0.001, 0.05], temp: [8000, 40000], mass: [0.5, 1.3], radius: [40, 60], weight: 5, label: 'White Dwarf' },
  NS: { color: '#c8e0ff', glow: '#60a0ff', lum: [0.0005, 0.02], temp: [500000, 1000000], mass: [1.4, 2.1], radius: [22, 32], weight: 1.5, label: 'Neutron Star' },
  BH: { color: '#000000', glow: '#ff9a40', lum: [0.3, 2.5], temp: [0, 0], mass: [5, 40], radius: [70, 110], weight: 1.2, label: 'Black Hole' },
};

export const CLASS_ORDER: StarClass[] = ['O', 'B', 'A', 'F', 'G', 'K', 'M', 'WD', 'NS', 'BH'];

export function rollStarClass(rng: RNG): StarClass {
  return rng.weighted(CLASS_ORDER, CLASS_ORDER.map((c) => STAR_CLASSES[c].weight));
}

export function makeStar(rng: RNG, cls: StarClass): StarDef {
  const info = STAR_CLASSES[cls];
  const t = rng.next();
  const lerp = (r: [number, number]) => r[0] + (r[1] - r[0]) * t;
  return {
    cls,
    color: info.color,
    glow: info.glow,
    lum: lerp(info.lum),
    temp: lerp(info.temp),
    mass: lerp(info.mass),
    radius: lerp(info.radius),
  };
}

export function starLabel(cls: StarClass): string {
  return STAR_CLASSES[cls].label;
}
