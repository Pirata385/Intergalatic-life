// Save / load dialogs for campaign and colony mode, including file export/import.
import type { Game } from '../game';
import { h, openModal, clear, toast, confirmDialog } from './dom';
import { listSlots, deleteSlot, exportFile, importFile, loadColony, saveColony } from '../save/save';
import { storage } from '../save/storage';

export function openSaveLoad(game: Game, mode: 'save' | 'load', kind: 'campaign' | 'colony' = 'campaign'): void {
  const body = h('div', { class: 'col' });
  const m = openModal(mode === 'save' ? 'Save Game' : 'Load Game', body);
  const draw = () => {
    clear(body);
    if (!storage.persistent()) body.append(h('p', { class: 'warn small' }, 'Browser storage is unavailable here: saves last for this session only. Use Export to keep a file.'));
    for (const s of listSlots(kind)) {
      const empty = 'empty' in s;
      const label = s.slot.includes('auto') ? 'Autosave' : `Slot ${s.slot.replace(/\D/g, '')}`;
      body.append(h('div', { class: 'card row between' },
        h('div', { class: 'col', style: 'gap:0.1em' },
          h('b', null, label),
          empty ? h('span', { class: 'muted small' }, 'Empty') : h('span', { class: 'small' }, `${(s as any).name} — ${(s as any).detail}`),
          empty ? null : h('span', { class: 'muted tiny' }, new Date((s as any).time).toLocaleString())),
        h('div', { class: 'row' },
          mode === 'save' && !s.slot.includes('auto') ? h('button', { class: 'btn primary small', onclick: () => {
            if (kind === 'campaign') game.saveTo(s.slot);
            else if (game.colony) { saveColony(s.slot, game.colony); toast('Colony saved.', 'good'); }
            draw();
          } }, 'Save') : null,
          mode === 'load' && !empty ? h('button', { class: 'btn primary small', onclick: () => {
            m.close();
            if (kind === 'campaign') game.loadFrom(s.slot);
            else {
              const c = loadColony(s.slot);
              if (c) { game.colony = c; game.colonySlot = s.slot.includes('auto') ? 'colony_auto' : s.slot; game.go('colony', { standalone: true }); }
            }
          } }, 'Load') : null,
          !empty ? h('button', { class: 'btn danger small', onclick: () => confirmDialog('Delete save', 'Delete this save permanently?', () => { deleteSlot(s.slot); draw(); }, 'Delete') }, '🗑') : null)));
    }
    body.append(h('div', { class: 'row end' },
      mode === 'save' ? h('button', { class: 'btn', onclick: () => {
        if (kind === 'campaign' && game.world) {
          (game.scene as any)?.syncBeforeSave?.();
          exportFile(`intergalactic-life-day${Math.floor(game.world.day)}.json`, { kind: 'campaign', data: game.world.toSave() });
        } else if (game.colony) exportFile(`colony-${game.colony.name}.json`, { kind: 'colony', data: game.colony });
      } }, '⬇ Export file') : null,
      mode === 'load' ? h('button', { class: 'btn', onclick: async () => {
        try {
          const f = await importFile();
          m.close();
          if (f.kind === 'colony') {
            game.colony = f.data;
            game.go('colony', { standalone: true });
          } else game.loadData(f.data ?? f);
        } catch (e) {
          toast('Could not import that file.', 'bad');
        }
      } }, '⬆ Import file') : null,
      h('button', { class: 'btn', onclick: () => m.close() }, 'Close')));
  };
  draw();
}
