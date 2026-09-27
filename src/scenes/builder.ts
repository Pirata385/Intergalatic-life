// Voxel ship builder: grid editor with module palette, mirroring, undo/redo,
// painting, live stats, validation, purchasing and a test flight arena.
import type { Game, Scene } from '../game';
import type { World } from '../sim/world';
import { h, clear, toast, openModal, fmtCr, add, confirmDialog } from '../ui/dom';
import { input } from '../input/input';
import { MODULES, MODULE_MAP, ModuleDef, ModuleCategory, FRAMES, FRAME_MAP, RARITY_COLOR } from '../data/modules';
import { ShipDesign, PlacedModule, buildGrid, canPlace, footprint, mirrorRotation, computeStats, disconnected, cloneDesign, recenter, ShipStats } from '../ship/design';
import { drawShipInto, drawPlacedModule, moduleIcon, PX } from '../ship/render';
import { rankTier } from '../data/factions';
import { clamp } from '../core/math';
import { audio } from '../audio/audio';
import { RNG } from '../core/rng';

type Tool = 'place' | 'erase' | 'paint';
const CATS: (ModuleCategory | 'all')[] = ['all', 'armor', 'thruster', 'energy', 'weapon', 'special', 'decorative'];

export class BuilderScene implements Scene {
  name = 'builder';
  game: Game;
  w: World;
  draft: ShipDesign;
  grid: Int16Array;
  stats!: ShipStats;
  sel: string | null = 'armor';
  rot = 0;
  tool: Tool = 'place';
  mirror = true;
  undo: string[] = [];
  redo: string[] = [];
  cell = 24;
  ox = 0;
  oy = 0;
  cat: ModuleCategory | 'all' = 'all';
  tab: 'Modules' | 'Paint' | 'Details' = 'Modules';
  hover: [number, number] | null = null;
  sprite: HTMLCanvasElement | null = null;
  dirty = true;
  refs: Record<string, HTMLElement> = {};
  available: Set<string>;
  maxTier: number;
  lastPaintCell = '';
  bgStars: HTMLCanvasElement;
  disc: Set<number> = new Set();
  paintIdx = 2;
  inspect: number = -1;

  constructor(game: Game, opts: { returnTo?: string } = {}) {
    this.game = game;
    this.w = game.world!;
    const saved = (game as any).builderDraft as ShipDesign | undefined;
    this.draft = saved ? cloneDesign(saved) : cloneDesign(this.w.player.design);
    (game as any).builderDraft = undefined;
    this.grid = buildGrid(this.draft);
    this.stats = computeStats(this.draft);
    const w = this.w;
    const st = w.systems[w.player.sys];
    const fac = st.owner > 0 ? w.factions[st.owner] : null;
    this.maxTier = Math.min(3, st.tech);
    if (fac && w.player.military?.faction === fac.id) this.maxTier = Math.max(this.maxTier, rankTier(w.player.military.rank));
    if (fac && w.player.rep[fac.id] >= 45) this.maxTier = Math.max(this.maxTier, Math.min(4, st.tech + 1));
    const species = ['human'];
    if (fac?.species === 'synod' && w.player.rep[fac.id] >= 15) species.push('synod');
    if (fac?.kind === 'pirate') species.push('hive', 'automata');
    this.available = new Set(MODULES.filter((m) => m.tier <= this.maxTier && species.includes(m.species) && m.id !== 'cloak').map((m) => m.id));
    this.bgStars = document.createElement('canvas');
    this.bgStars.width = this.bgStars.height = 512;
    const bg = this.bgStars.getContext('2d')!;
    const rng = new RNG(99);
    for (let i = 0; i < 160; i++) {
      bg.fillStyle = `rgba(200,210,255,${rng.range(0.1, 0.5)})`;
      bg.fillRect(rng.range(0, 512), rng.range(0, 512), 1.2, 1.2);
    }
    void opts;
  }

  enter(): void {
    audio.setMood('calm');
    this.buildUI();
    this.recalc();
    this.fit();
  }

  exit(): void {
    this.game.hud.innerHTML = '';
  }

  onBack(): boolean {
    this.cancel();
    return true;
  }

  onResize(): void {
    this.fit();
  }

  // ------------------------------------------------------------------ helpers
  private viewport(): { x: number; y: number; w: number; h: number } {
    const W = this.game.width, H = this.game.height;
    const portrait = H > W;
    const fs = parseFloat(getComputedStyle(this.game.app).fontSize) || 14;
    if (portrait) {
      const top = fs * 2.9 + 8;
      const bottom = H * 0.36;
      return { x: 0, y: top, w: W, h: H - top - bottom - fs * 3 };
    }
    const left = fs * 16, right = fs * 17.5, top = fs * 2.9;
    return { x: left, y: top, w: W - left - right, h: H - top - fs * 3.2 };
  }

  private fit(): void {
    const v = this.viewport();
    this.cell = clamp(Math.floor(Math.min(v.w / (this.draft.w + 2), v.h / (this.draft.h + 2))), 8, 64);
    this.ox = v.x + (v.w - this.draft.w * this.cell) / 2;
    this.oy = v.y + (v.h - this.draft.h * this.cell) / 2;
  }

  private snapshot(): string {
    return JSON.stringify({ m: this.draft.modules, c: this.draft.colors, w: this.draft.w, h: this.draft.h, f: this.draft.frame });
  }

  private pushUndo(): void {
    this.undo.push(this.snapshot());
    if (this.undo.length > 100) this.undo.shift();
    this.redo = [];
  }

  private restore(s: string): void {
    const o = JSON.parse(s);
    this.draft.modules = o.m;
    this.draft.colors = o.c;
    this.draft.w = o.w;
    this.draft.h = o.h;
    this.draft.frame = o.f;
    this.recalc();
    this.fit();
  }

  private recalc(): void {
    this.grid = buildGrid(this.draft);
    this.stats = computeStats(this.draft);
    this.disc = new Set(disconnected(this.draft));
    this.dirty = true;
    this.drawLeft();
    this.drawTopCost();
  }

  private cellAt(sx: number, sy: number): [number, number] | null {
    const x = Math.floor((sx - this.ox) / this.cell), y = Math.floor((sy - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= this.draft.w || y >= this.draft.h) return null;
    return [x, y];
  }

  private ownedCount(id: string): number {
    const orig = this.w.player.design.modules.filter((m) => m.id === id).length;
    return orig + (this.w.player.modules[id] ?? 0);
  }

  private canUse(id: string): boolean {
    return this.available.has(id) || this.ownedCount(id) > 0;
  }

  /** Purchases needed to realise the draft: modules not covered by the current ship or spares. */
  purchaseList(): { id: string; n: number; cost: number }[] {
    const need = new Map<string, number>();
    for (const m of this.draft.modules) need.set(m.id, (need.get(m.id) ?? 0) + 1);
    const out: { id: string; n: number; cost: number }[] = [];
    for (const [id, n] of need) {
      const have = this.ownedCount(id);
      if (n > have) out.push({ id, n: n - have, cost: (n - have) * MODULE_MAP[id].cost });
    }
    return out;
  }

  private tryPlace(x: number, y: number): void {
    if (!this.sel) return;
    const def = MODULE_MAP[this.sel];
    if (!this.canUse(def.id)) return void toast('That module is not sold here and you own none.', 'bad', 1500);
    const r = def.rotatable ? this.rot : 0;
    const [fw, fh] = footprint(def, r);
    const px = x - Math.floor((fw - 1) / 2), py = y - Math.floor((fh - 1) / 2);
    if (!canPlace(this.draft, this.grid, def, px, py, r)) return;
    this.pushUndo();
    this.draft.modules.push({ id: def.id, x: px, y: py, r });
    this.grid = buildGrid(this.draft);
    if (this.mirror) {
      const my = this.draft.h - py - fh;
      const mr = def.rotatable ? mirrorRotation(def, r) : 0;
      if (my !== py && canPlace(this.draft, this.grid, def, px, my, mr)) this.draft.modules.push({ id: def.id, x: px, y: my, r: mr });
    }
    audio.play('build', 0.25);
    this.recalc();
  }

  private tryErase(x: number, y: number): void {
    const mi = this.grid[y * this.draft.w + x];
    if (mi < 0) return;
    this.pushUndo();
    const m = this.draft.modules[mi];
    const def = MODULE_MAP[m.id];
    const [, fh] = footprint(def, m.r);
    let remove = new Set([mi]);
    if (this.mirror) {
      const my = this.draft.h - m.y - fh;
      const other = this.draft.modules.findIndex((o, i) => i !== mi && o.id === m.id && o.x === m.x && o.y === my);
      if (other >= 0) remove.add(other);
    }
    this.draft.modules = this.draft.modules.filter((_, i) => !remove.has(i));
    if (this.inspect >= 0) this.inspect = -1;
    audio.play('ui', 0.2);
    this.recalc();
  }

  private tryPaint(x: number, y: number): void {
    const mi = this.grid[y * this.draft.w + x];
    if (mi < 0) return;
    this.pushUndo();
    const apply = (m: PlacedModule) => (m.p = this.paintIdx === 0 ? undefined : this.paintIdx);
    const m = this.draft.modules[mi];
    apply(m);
    if (this.mirror) {
      const def = MODULE_MAP[m.id];
      const [, fh] = footprint(def, m.r);
      const my = this.draft.h - m.y - fh;
      const o = this.draft.modules.find((q) => q.id === m.id && q.x === m.x && q.y === my);
      if (o) apply(o);
    }
    this.recalc();
  }

  // ------------------------------------------------------------------ UI
  buildUI(): void {
    const hud = this.game.hud;
    clear(hud);
    const R = this.refs;
    R.name = h('input', { type: 'text', value: this.draft.name, maxLength: 28, oninput: (e: Event) => (this.draft.name = (e.target as HTMLInputElement).value) });
    R.mirror = h('button', { class: `btn small ${this.mirror ? 'active' : ''}`, onclick: () => { this.mirror = !this.mirror; R.mirror.classList.toggle('active', this.mirror); } }, '⇅ Mirroring');
    R.accept = h('button', { class: 'btn small primary', onclick: () => this.accept() }, '✓ Accept');
    const frameSel = h('select', { onchange: (e: Event) => this.changeFrame((e.target as HTMLSelectElement).value) },
      ...FRAMES.filter((f) => this.w.player.frames.includes(f.id) || f.id === this.draft.frame).map((f) => h('option', { value: f.id, selected: f.id === this.draft.frame }, `${f.name} ${f.w}×${f.h}`)));
    if (this.draft.frame === 'npc') frameSel.prepend(h('option', { value: 'npc', selected: true }, `Custom hull ${this.draft.w}×${this.draft.h}`));
    hud.append(h('div', { class: 'bld-top' },
      h('button', { class: 'btn small', onclick: () => this.toggleLeft() }, '≡'),
      R.name,
      h('button', { class: 'btn small', onclick: () => { const s = this.undo.pop(); if (s) { this.redo.push(this.snapshot()); this.restore(s); } } }, 'Undo'),
      h('button', { class: 'btn small', onclick: () => { const s = this.redo.pop(); if (s) { this.undo.push(this.snapshot()); this.restore(s); } } }, 'Redo'),
      R.mirror,
      frameSel,
      h('div', { class: 'grow' }),
      (R.cost = h('span', { class: 'mono small' })),
      h('button', { class: 'btn small', onclick: () => this.test() }, '▶ Test'),
      h('button', { class: 'btn small danger', onclick: () => this.cancel() }, '✕ Cancel'),
      R.accept));
    R.left = h('div', { class: 'bld-left' });
    hud.append(R.left);
    R.right = h('div', { class: 'bld-right' });
    hud.append(R.right);
    R.tools = h('div', { class: 'bld-tools' });
    hud.append(R.tools);
    this.drawRight();
    this.drawTools();
    this.drawLeft();
    this.drawTopCost();
  }

  private toggleLeft(): void {
    this.refs.left.classList.toggle('open');
  }

  private drawTools(): void {
    const R = this.refs;
    clear(R.tools);
    const tool = (t: Tool, label: string) => h('button', { class: `btn small ${this.tool === t ? 'active' : ''}`, onclick: () => { this.tool = t; this.drawTools(); } }, label);
    R.tools.append(
      tool('place', '✚ Place'), tool('erase', '✖ Erase'), tool('paint', '🖌 Paint'),
      h('button', { class: 'btn small', onclick: () => { this.rot = (this.rot + 1) % 4; this.drawTools(); } }, `⟳ Rotate (${this.rot * 90}°)`),
      h('button', { class: 'btn small', onclick: () => this.fit() }, '⌖ Fit'),
      h('button', { class: 'btn small danger', onclick: () => confirmDialog('Clear design', 'Remove all modules?', () => { this.pushUndo(); this.draft.modules = []; this.recalc(); }, 'Clear') }, 'Clear'));
  }

  private drawTopCost(): void {
    const R = this.refs;
    if (!R.cost) return;
    const buys = this.purchaseList();
    const total = buys.reduce((a, b) => a + b.cost, 0);
    R.cost.textContent = total > 0 ? `Purchase: ${fmtCr(total)} / ${fmtCr(this.w.player.credits)}` : `${fmtCr(this.w.player.credits)}`;
    R.cost.style.color = total > this.w.player.credits ? 'var(--bad)' : total > 0 ? 'var(--gold)' : 'var(--muted)';
    R.accept.classList.toggle('disabled', !this.stats.valid || total > this.w.player.credits);
  }

  private drawLeft(): void {
    const R = this.refs;
    if (!R.left) return;
    clear(R.left);
    const s = this.stats;
    const row = (icon: string, label: string, v: string, bad = false) => h('div', { class: 'bld-stat' }, h('span', null, `${icon} ${label}`), h('span', { style: bad ? 'color:var(--bad)' : '' }, v));
    add(R.left, h('h4', { style: 'color:#cfe0ff' }, 'Ship Statistics'),
      row('▲', 'Mass', s.mass.toFixed(0)), row('✚', 'Hull HP', String(s.hp)), row('▣', 'Armor', s.armor.toFixed(1)),
      row('◯', 'Shield', `${s.shieldCap} (+${s.shieldRegen}/s)`), row('⚡', 'Power', `${s.powerGen.toFixed(0)} / ${(s.powerUse).toFixed(0)}`, s.powerGen < s.powerUse),
      row('🔋', 'Battery', String(s.battery)), row('➤', 'Thrust', s.thrust.toFixed(0), s.thrust <= 0), row('⇢', 'Speed', s.maxSpeed.toFixed(0)), row('↻', 'Turn', `${s.turnRate.toFixed(2)}`),
      row('✹', 'DPS', s.dps.toFixed(0)), row('⌖', 'Range', s.range.toFixed(0)), row('▦', 'Cargo', String(s.cargo)), row('⛽', 'Fuel', String(s.fuel)),
      row('⤳', 'Jump', `${s.jump} ly`, s.jump <= 0), row('☺', 'Crew', `${s.crewCap}/${s.crewReq}`, s.crewCap < s.crewReq), row('◎', 'Sensor', s.sensor.toFixed(0)),
      row('$', 'Value', fmtCr(s.cost)), row('■', 'Blocks', String(s.blocks)));
    if (s.errors.length || s.warnings.length) {
      add(R.left, h('hr'), ...s.errors.map((e) => h('div', { class: 'bad small' }, '✖ ' + e)), ...s.warnings.map((e) => h('div', { class: 'warn small' }, '⚠ ' + e)));
    }
    const id = this.inspect >= 0 ? this.draft.modules[this.inspect]?.id : this.sel;
    if (id) {
      const d = MODULE_MAP[id];
      add(R.left, h('hr'), h('div', { style: { color: RARITY_COLOR[d.rarity] } }, h('b', null, d.name), ` (${d.rarity})`), h('div', { class: 'small muted' }, d.desc),
        h('div', { class: 'small' }, `${d.w}×${d.h} · ${fmtCr(d.cost)} · mass ${d.mass} · HP ${d.hp}${d.armor ? ' · armor ' + d.armor : ''}`),
        d.power ? h('div', { class: 'small' }, `Power ${d.power > 0 ? '+' : ''}${d.power}`) : null,
        d.weapon ? h('div', { class: 'small' }, `Damage ${d.weapon.damage}${d.weapon.kind === 'beam' ? '/s' : ''} · ${d.weapon.rof}/s · range ${d.weapon.range}${d.weapon.ammo ? ' · ' + d.weapon.ammo : ''}${d.weapon.energy ? ' · ' + d.weapon.energy + ' energy' : ''}`) : null,
        d.thrust ? h('div', { class: 'small' }, `Thrust ${d.thrust} · turn ${d.turn ?? 0} (rotation matters: 0° = forward)`) : null,
        h('div', { class: 'small muted' }, `Owned: ${this.ownedCount(id)} · ${this.available.has(id) ? 'Sold here' : 'Not sold here'}`));
    }
  }

  private drawRight(): void {
    const R = this.refs;
    clear(R.right);
    const tabsRow = h('div', { class: 'bld-cats' }, ...(['Modules', 'Paint', 'Details'] as const).map((t) =>
      h('button', { class: `tab ${this.tab === t ? 'active' : ''}`, onclick: () => { this.tab = t; if (t === 'Paint') this.tool = 'paint'; else if (this.tool === 'paint') this.tool = 'place'; this.drawTools(); this.drawRight(); } }, t)));
    R.right.append(tabsRow);
    if (this.tab === 'Modules') {
      R.right.append(h('div', { class: 'bld-cats' }, ...CATS.map((c) => h('button', { class: `tab ${this.cat === c ? 'active' : ''}`, onclick: () => { this.cat = c; this.drawRight(); } }, c === 'all' ? 'All' : c[0].toUpperCase() + c.slice(1)))));
      const grid = h('div', { class: 'bld-grid scroll' });
      const list = MODULES.filter((m) => (this.cat === 'all' || m.cat === this.cat) && (this.canUse(m.id) || m.species === 'human'));
      for (const m of list) {
        const usable = this.canUse(m.id);
        const owned = this.w.player.modules[m.id] ?? 0;
        const tile = h('div', { class: `mod-tile r-${m.rarity} ${this.sel === m.id ? 'sel' : ''} ${usable ? '' : 'locked'}`, title: `${m.name}${usable ? '' : ' (requires tier ' + m.tier + ')'}`, onclick: () => {
          this.sel = m.id;
          this.inspect = -1;
          if (this.tool !== 'place') { this.tool = 'place'; this.drawTools(); }
          this.drawRight();
          this.drawLeft();
        } }, moduleIcon(m.id, 48, this.draft.colors), h('div', { class: 'cost' }, m.cost >= 1000 ? `${(m.cost / 1000).toFixed(1)}k` : String(m.cost)), owned ? h('div', { class: 'own' }, `×${owned}`) : null);
        grid.append(tile);
      }
      R.right.append(grid);
    } else if (this.tab === 'Paint') {
      const labels = ['Primary hull', 'Secondary', 'Accent / lights'];
      const col = h('div', { class: 'col small' });
      this.draft.colors.forEach((c, i) => {
        col.append(h('label', { class: 'row between' }, labels[i], h('input', { type: 'color', value: c, oninput: (e: Event) => { this.draft.colors[i] = (e.target as HTMLInputElement).value; this.dirty = true; } })));
      });
      col.append(h('h4', null, 'Paint brush'), h('div', { class: 'row' }, ...['Default', 'Secondary', 'Accent'].map((l, i) =>
        h('button', { class: `btn tiny ${this.paintIdx === i ? 'active' : ''}`, onclick: () => { this.paintIdx = i; this.tool = 'paint'; this.drawTools(); this.drawRight(); } }, l))),
        h('p', { class: 'muted tiny' }, 'Tap modules on the grid to paint them. Mirroring applies.'),
        h('h4', null, 'Presets'),
        h('div', { class: 'row' }, ...([['#c8782a', '#3a3a44', '#60d0ff'], ['#3c8a4a', '#2a2e2a', '#e8f0e0'], ['#8a92a8', '#2a3040', '#ff5a4a'], ['#e8e8ec', '#4a5060', '#46d0dc'], ['#6a3a8a', '#201830', '#ffb040'], ['#2a5aa0', '#141c30', '#ffe080']] as [string, string, string][]).map((p) =>
          h('button', { class: 'btn tiny', style: { background: `linear-gradient(90deg, ${p[0]} 50%, ${p[2]} 50%)`, width: '2.4em', height: '1.6em' }, onclick: () => { this.pushUndo(); this.draft.colors = [...p] as [string, string, string]; this.dirty = true; this.drawRight(); } }))));
      R.right.append(col);
    } else {
      const s = this.stats;
      const frame = FRAME_MAP[this.draft.frame];
      const hang = this.w.player.hangar;
      add(R.right, h('div', { class: 'col small scroll', style: 'overflow-y:auto' },
        h('div', null, frame ? `${frame.name}: ${frame.desc}` : `Custom hull ${this.draft.w}×${this.draft.h}`),
        h('div', null, `Strength rating: ${s.strength}`),
        h('h4', null, 'Weapons'),
        ...s.weapons.map((wm) => h('div', null, `${wm.def.name} @ ${wm.cx.toFixed(1)},${wm.cy.toFixed(1)}`)),
        h('h4', null, 'Hangar designs'),
        hang.length ? null : h('div', { class: 'muted' }, 'Save copies of designs from the shipyard.'),
        ...hang.map((d) => h('button', { class: 'btn tiny', onclick: () => { this.pushUndo(); const c = cloneDesign(d); this.draft.modules = c.modules; this.draft.w = c.w; this.draft.h = c.h; this.draft.frame = c.frame; this.draft.colors = c.colors; this.recalc(); this.fit(); } }, `Load ${d.name}`)),
        h('h4', null, 'Tips'),
        h('div', { class: 'muted' }, 'Every ship needs a command module, rear-facing thrusters (rotation 0°), enough reactor power and connected blocks. Add a jump drive to travel between stars, crew quarters for crew, and armor on the outside. Shots destroy individual blocks.')));
    }
  }

  private changeFrame(id: string): void {
    if (id === 'npc') return;
    const f = FRAME_MAP[id];
    if (!f) return;
    this.pushUndo();
    const nd = recenter(this.draft, f.w, f.h);
    const lost = this.draft.modules.length - nd.modules.length;
    this.draft.modules = nd.modules;
    this.draft.w = f.w;
    this.draft.h = f.h;
    this.draft.frame = f.id;
    if (lost > 0) toast(`${lost} module(s) did not fit the new frame.`, 'bad');
    this.recalc();
    this.fit();
  }

  private test(): void {
    if (!this.stats.valid) return void toast('Fix the design errors before testing.', 'bad');
    (this.game as any).builderDraft = cloneDesign(this.draft);
    this.game.go('arena', { design: cloneDesign(this.draft) });
  }

  private cancel(): void {
    this.game.go('system', { arrive: 'resume', docked: true });
  }

  private accept(): void {
    const p = this.w.player;
    if (!this.stats.valid) return void toast(this.stats.errors[0] ?? 'Invalid design', 'bad');
    const buys = this.purchaseList();
    const total = buys.reduce((a, b) => a + b.cost, 0);
    if (total > p.credits) return void toast('Not enough credits for the new modules.', 'bad');
    const doIt = () => {
      p.credits -= total;
      // update spare inventory: old modules return to spares, new ones consume spares
      const count = (arr: PlacedModule[]) => {
        const m = new Map<string, number>();
        for (const x of arr) m.set(x.id, (m.get(x.id) ?? 0) + 1);
        return m;
      };
      const oldC = count(p.design.modules), newC = count(this.draft.modules);
      const ids = new Set([...oldC.keys(), ...newC.keys()]);
      for (const id of ids) {
        const bought = buys.find((b) => b.id === id)?.n ?? 0;
        const delta = (oldC.get(id) ?? 0) + bought - (newC.get(id) ?? 0);
        p.modules[id] = Math.max(0, (p.modules[id] ?? 0) + delta);
      }
      // keep damage on modules that stayed in place
      const oldMap = new Map(p.design.modules.map((m, i) => [`${m.id}:${m.x}:${m.y}:${m.r}`, p.hp[i] ?? 1]));
      const nd = cloneDesign(this.draft);
      nd.cls = 'custom';
      p.hp = nd.modules.map((m) => oldMap.get(`${m.id}:${m.x}:${m.y}:${m.r}`) ?? 1);
      p.design = nd;
      const st = computeStats(nd);
      p.fuel = Math.min(p.fuel, st.fuel);
      for (const k of Object.keys(p.ammo) as (keyof typeof p.ammo)[]) p.ammo[k] = Math.min(p.ammo[k], st.ammoCap[k]);
      toast('Refit complete!', 'good');
      audio.play('reward', 0.4);
      this.game.go('system', { arrive: 'resume', docked: true });
    };
    if (total > 0) confirmDialog('Confirm refit', `Purchase ${buys.reduce((a, b) => a + b.n, 0)} new module(s) for ${fmtCr(total)}? Removed modules go to your spare parts.`, doIt, 'Buy & refit');
    else doIt();
  }

  // ------------------------------------------------------------------ loop
  update(dt: number): void {
    const v = this.viewport();
    const uiBusy = !!document.querySelector('.modal-back');
    if (uiBusy) return;
    // zoom / pan
    const zoomAt = (f: number, sx: number, sy: number) => {
      const nc = clamp(this.cell * f, 6, 80);
      const k = nc / this.cell;
      this.ox = sx - (sx - this.ox) * k;
      this.oy = sy - (sy - this.oy) * k;
      this.cell = nc;
    };
    if (input.wheel) zoomAt(Math.pow(0.9, input.wheel), input.mouseX, input.mouseY);
    if (input.pinch !== 1) zoomAt(input.pinch, input.pinchX, input.pinchY);
    const touch = this.game.isTouch();
    const inView = (x: number, y: number) => x >= v.x && y >= v.y && x <= v.x + v.w && y <= v.y + v.h;
    if (input.dragging && input.pointers.size === 1) {
      const paintDrag = !touch && input.mouseDown && this.tool !== 'paint' && inView(input.mouseX, input.mouseY);
      if (!paintDrag || input.rightDown) {
        this.ox += input.dragX;
        this.oy += input.dragY;
      }
    }
    if (input.rightDown && !touch && input.dragX === 0 && input.dragY === 0) {
      // right click erases
      const c = this.cellAt(input.mouseX, input.mouseY);
      if (c && this.grid[c[1] * this.draft.w + c[0]] >= 0) {
        const key = 'e' + c.join(',');
        if (key !== this.lastPaintCell) { this.lastPaintCell = key; this.tryErase(c[0], c[1]); }
      }
    }
    this.hover = inView(input.mouseX, input.mouseY) ? this.cellAt(input.mouseX, input.mouseY) : null;
    // desktop drag-to-place for armor painting
    if (!touch && input.mouseDown && input.dragging && this.hover && (this.tool === 'place' || this.tool === 'erase')) {
      const key = this.tool + this.hover.join(',');
      if (key !== this.lastPaintCell) {
        this.lastPaintCell = key;
        if (this.tool === 'place') this.tryPlace(this.hover[0], this.hover[1]);
        else this.tryErase(this.hover[0], this.hover[1]);
      }
    }
    if (!input.mouseDown && !input.rightDown) this.lastPaintCell = '';
    for (const tap of input.taps) {
      if (!inView(tap.x, tap.y)) continue;
      const c = this.cellAt(tap.x, tap.y);
      if (!c) continue;
      const occupied = this.grid[c[1] * this.draft.w + c[0]];
      if (tap.button === 2) { this.tryErase(c[0], c[1]); continue; }
      if (this.tool === 'place') {
        if (occupied >= 0 && !(this.sel && canPlace(this.draft, this.grid, MODULE_MAP[this.sel], c[0], c[1], this.rot))) {
          this.inspect = occupied;
          this.drawLeft();
        } else this.tryPlace(c[0], c[1]);
      } else if (this.tool === 'erase') this.tryErase(c[0], c[1]);
      else this.tryPaint(c[0], c[1]);
    }
    if (input.hit('KeyR')) { this.rot = (this.rot + 1) % 4; this.drawTools(); }
    if (input.hit('KeyZ') && (input.down('ControlLeft', 'MetaLeft'))) { const s = this.undo.pop(); if (s) { this.redo.push(this.snapshot()); this.restore(s); } }
    if (input.hit('KeyY') && (input.down('ControlLeft', 'MetaLeft'))) { const s = this.redo.pop(); if (s) { this.undo.push(this.snapshot()); this.restore(s); } }
    void dt;
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.game.width, H = this.game.height;
    // space backdrop like the reference builder
    g.fillStyle = '#0b1222';
    g.fillRect(0, 0, W, H);
    const grd = g.createRadialGradient(W * 0.55, H * 0.45, 0, W * 0.55, H * 0.45, Math.max(W, H) * 0.7);
    grd.addColorStop(0, 'rgba(90,40,50,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 512) for (let y = 0; y < H; y += 512) g.drawImage(this.bgStars, x, y);
    const d = this.draft;
    const c = this.cell;
    // grid
    g.fillStyle = 'rgba(20,40,80,0.35)';
    g.fillRect(this.ox, this.oy, d.w * c, d.h * c);
    g.strokeStyle = 'rgba(90,130,200,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= d.w; x++) { g.moveTo(this.ox + x * c + 0.5, this.oy); g.lineTo(this.ox + x * c + 0.5, this.oy + d.h * c); }
    for (let y = 0; y <= d.h; y++) { g.moveTo(this.ox, this.oy + y * c + 0.5); g.lineTo(this.ox + d.w * c, this.oy + y * c + 0.5); }
    g.stroke();
    // mirror axis
    if (this.mirror) {
      g.strokeStyle = 'rgba(255,224,128,0.35)';
      g.setLineDash([6, 6]);
      g.beginPath();
      g.moveTo(this.ox, this.oy + (d.h * c) / 2);
      g.lineTo(this.ox + d.w * c, this.oy + (d.h * c) / 2);
      g.stroke();
      g.setLineDash([]);
    }
    // forward arrow (reference: green arrow on the nose side)
    g.fillStyle = '#3aa040';
    const ay = this.oy + (d.h * c) / 2, ax = this.ox + d.w * c + 10;
    g.beginPath();
    g.moveTo(ax, ay - 14);
    g.lineTo(ax + 22, ay);
    g.lineTo(ax, ay + 14);
    g.fill();
    // ship
    if (this.dirty || !this.sprite) {
      this.sprite = document.createElement('canvas');
      this.sprite.width = d.w * PX;
      this.sprite.height = d.h * PX;
      const sg = this.sprite.getContext('2d')!;
      drawShipInto(sg, d, { barrels: true });
      this.dirty = false;
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(this.sprite, this.ox, this.oy, d.w * c, d.h * c);
    g.imageSmoothingEnabled = true;
    // disconnected highlight
    for (const i of this.disc) {
      const m = d.modules[i];
      if (!m) continue;
      const [fw, fh] = footprint(MODULE_MAP[m.id], m.r);
      g.strokeStyle = '#ff4040';
      g.lineWidth = 2;
      g.strokeRect(this.ox + m.x * c + 1, this.oy + m.y * c + 1, fw * c - 2, fh * c - 2);
    }
    if (this.inspect >= 0 && d.modules[this.inspect]) {
      const m = d.modules[this.inspect];
      const [fw, fh] = footprint(MODULE_MAP[m.id], m.r);
      g.strokeStyle = '#ffe080';
      g.lineWidth = 2;
      g.strokeRect(this.ox + m.x * c, this.oy + m.y * c, fw * c, fh * c);
    }
    // centre of mass
    if (this.stats.blocks) {
      const cx = this.ox + this.stats.cx * c, cy = this.oy + this.stats.cy * c;
      g.strokeStyle = '#ff60ff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, 5, 0, Math.PI * 2);
      g.moveTo(cx - 9, cy);
      g.lineTo(cx + 9, cy);
      g.moveTo(cx, cy - 9);
      g.lineTo(cx, cy + 9);
      g.stroke();
    }
    // ghost preview
    if (this.hover && this.tool === 'place' && this.sel && !this.game.isTouch()) {
      const def: ModuleDef = MODULE_MAP[this.sel];
      const r = def.rotatable ? this.rot : 0;
      const [fw, fh] = footprint(def, r);
      const px = this.hover[0] - Math.floor((fw - 1) / 2), py = this.hover[1] - Math.floor((fh - 1) / 2);
      const ok = canPlace(d, this.grid, def, px, py, r) && this.canUse(def.id);
      const ghost = (x: number, y: number, rr: number) => {
        g.save();
        g.globalAlpha = 0.65;
        g.translate(this.ox, this.oy);
        drawPlacedModule(g, d, { id: def.id, x, y, r: rr }, true, c);
        g.restore();
        g.fillStyle = ok ? 'rgba(80,255,120,0.18)' : 'rgba(255,60,60,0.35)';
        const [gw, gh] = footprint(def, rr);
        g.fillRect(this.ox + x * c, this.oy + y * c, gw * c, gh * c);
      };
      ghost(px, py, r);
      if (this.mirror) {
        const my = d.h - py - fh;
        if (my !== py) ghost(px, my, def.rotatable ? mirrorRotation(def, r) : 0);
      }
    } else if (this.hover) {
      g.strokeStyle = this.tool === 'erase' ? '#ff6060' : '#ffe080';
      g.lineWidth = 2;
      g.strokeRect(this.ox + this.hover[0] * c, this.oy + this.hover[1] * c, c, c);
    }
    void openModal;
  }
}
