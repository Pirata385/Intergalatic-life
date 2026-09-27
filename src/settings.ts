// Persistent user settings (stored separately from save games).
import { storage } from './save/storage';

export type OrientationPref = 'auto' | 'portrait' | 'landscape';

export interface Settings {
  orientation: OrientationPref;
  flip: boolean;
  quality: 'low' | 'medium' | 'high';
  volume: number;
  music: boolean;
  sfx: boolean;
  uiScale: number;
  tilt: number;
  controls: 'auto' | 'touch' | 'desktop';
  showFps: boolean;
  offlineSim: boolean;
  autosave: boolean;
  joystickSide: 'left' | 'right';
  aimAssist: boolean;
  tutorial: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  orientation: 'auto',
  flip: false,
  quality: 'high',
  volume: 0.6,
  music: true,
  sfx: true,
  uiScale: 1,
  tilt: 0.62,
  controls: 'auto',
  showFps: false,
  offlineSim: true,
  autosave: true,
  joystickSide: 'left',
  aimAssist: true,
  tutorial: true,
};

const KEY = 'igl_settings';

export function loadSettings(): Settings {
  const raw = storage.get(KEY);
  if (!raw) return { ...DEFAULT_SETTINGS, quality: isLowEnd() ? 'medium' : 'high' };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  storage.set(KEY, JSON.stringify(s));
}

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function isLowEnd(): boolean {
  const mem = (navigator as any).deviceMemory as number | undefined;
  return (mem !== undefined && mem < 4) || (isTouchDevice() && window.devicePixelRatio > 2.5);
}

export function qualityScale(q: Settings['quality']): number {
  return q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
}
