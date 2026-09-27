// Save slots for the campaign and standalone colony mode, with compression,
// metadata index and file export / import.
import { storage } from './storage';
import { compressToUTF16, decompressFromUTF16 } from '../core/compress';
import type { WorldSave } from '../sim/types';
import type { ColonyState } from '../sim/colony';

export interface SlotMeta {
  slot: string;
  kind: 'campaign' | 'colony';
  name: string;
  detail: string;
  time: number;
}

const META = 'igl_meta';
export const CAMPAIGN_SLOTS = ['auto', 'slot1', 'slot2', 'slot3'];
export const COLONY_SLOTS = ['colony_auto', 'colony1', 'colony2'];

function readMeta(): Record<string, SlotMeta> {
  try {
    return JSON.parse(storage.get(META) ?? '{}');
  } catch {
    return {};
  }
}

function writeMeta(m: Record<string, SlotMeta>): void {
  storage.set(META, JSON.stringify(m));
}

export function listSlots(kind: 'campaign' | 'colony'): (SlotMeta | { slot: string; empty: true })[] {
  const meta = readMeta();
  const slots = kind === 'campaign' ? CAMPAIGN_SLOTS : COLONY_SLOTS;
  return slots.map((s) => meta[s] ?? { slot: s, empty: true as const });
}

export function latestCampaign(): SlotMeta | null {
  const meta = readMeta();
  let best: SlotMeta | null = null;
  for (const s of CAMPAIGN_SLOTS) if (meta[s] && (!best || meta[s].time > best.time)) best = meta[s];
  return best;
}

export function latestColony(): SlotMeta | null {
  const meta = readMeta();
  let best: SlotMeta | null = null;
  for (const s of COLONY_SLOTS) if (meta[s] && (!best || meta[s].time > best.time)) best = meta[s];
  return best;
}

export function saveCampaign(slot: string, data: WorldSave): boolean {
  const json = JSON.stringify(data);
  const ok = storage.set('igl_save_' + slot, compressToUTF16(json));
  const meta = readMeta();
  meta[slot] = {
    slot, kind: 'campaign', name: data.player.name,
    detail: `Day ${Math.floor(data.day)} · ${Math.round(data.player.credits).toLocaleString()} cr · Lv ${data.player.level}`, time: Date.now(),
  };
  writeMeta(meta);
  return ok;
}

export function loadCampaign(slot: string): WorldSave | null {
  const raw = storage.get('igl_save_' + slot);
  if (!raw) return null;
  try {
    const json = decompressFromUTF16(raw);
    return json ? (JSON.parse(json) as WorldSave) : null;
  } catch (e) {
    console.error('load failed', e);
    return null;
  }
}

export function saveColony(slot: string, c: ColonyState): boolean {
  const ok = storage.set('igl_save_' + slot, compressToUTF16(JSON.stringify(c)));
  const meta = readMeta();
  meta[slot] = { slot, kind: 'colony', name: c.name, detail: `Day ${c.day} · Pop ${Math.round(c.pop)} · ${c.planetName}`, time: Date.now() };
  writeMeta(meta);
  return ok;
}

export function loadColony(slot: string): ColonyState | null {
  const raw = storage.get('igl_save_' + slot);
  if (!raw) return null;
  try {
    const json = decompressFromUTF16(raw);
    return json ? (JSON.parse(json) as ColonyState) : null;
  } catch {
    return null;
  }
}

export function deleteSlot(slot: string): void {
  storage.remove('igl_save_' + slot);
  const meta = readMeta();
  delete meta[slot];
  writeMeta(meta);
}

export function exportFile(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

export function importFile(): Promise<any> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return reject(new Error('No file'));
      const r = new FileReader();
      r.onload = () => {
        try {
          resolve(JSON.parse(String(r.result)));
        } catch (e) {
          reject(e);
        }
      };
      r.onerror = () => reject(r.error);
      r.readAsText(f);
    };
    input.click();
  });
}
