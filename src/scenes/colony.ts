// Colony management: an isometric 2.5D city builder. Used for campaign colonies
// and as the standalone Colony Mode.
import type { Game, Scene } from '../game';
import { h, clear, toast, openModal, bar, fmtCr, add, tabs, confirmDialog } from '../ui/dom';
import { input } from '../input/input';
import { BUILDINGS, BUILDING_MAP, BuildingDef, COLONY_RES, COLONY_RES_ICON, ColonyRes, TECHS, TILE_INFO, TileType } from '../data/buildings';
import { ColonyState, colonyWallet, Wallet, build, canBuild, demolish, tickColony, buildingAt, techAvailable, computeReport, STANDALONE_PRICE, colonyScore } from '../sim/colony';
import { playerWallet, advanceTime } from '../sim/simulation';
import { clamp, shade, hexToRgb } from '../core/math';
import { RNG, hash } from '../core/rng';
import { audio } from '../audio/audio';
import { openSettings } from '../ui/settingsui';
import { openSaveLoad } from '../ui/saveui';
import { saveColony } from '../save/save';
import { PLANET_LABEL } from '../gen/system';
import { makePalette } from '../gen/planet';

const TW = 64, TH = 32, EH = 26;

export class ColonyScene implements Scene {
  name = 'colony';
  game: Game;
  c: ColonyState;
  standalone: boolean;
  wallet: Wallet;
  zoom = 1;
  panX = 0;
  panY = 0;
  speed = 1;
  acc = 0;
  sel: string | null = null;
  selTile: [number, number] | null = null;
  hoverTile: [number, number] | null = null;
  terrain: HTMLCanvasElement | null = null;
  refs: Record<string, HTMLElement> = {};
  hudT = 0;
  t = 0;
  sideTab = 'Overview';
  shownEnd = false;
  sky: [string, string];

  constructor(game: Game, opts: { standalone?: boolean; colonyId?: number }) {
    this.game = game;
    this.c = game.colony!;
    this.standalone = !!opts.standalone || this.c.mode === 'standalone';
    this.wallet = this.standalone ? colonyWallet(this.c) : playerWallet(game.world!);
    const pal = makePalette(this.c.planetType, this.c.planetSeed);
    this.sky = [`rgb(${pal.atmo.map((v) => Math.round(v * 0.25)).join(',')})`, '#05060b'];
  }

  enter(): void {
    audio.setMood('calm');
    this.renderTerrain();
    this.buildUI();
    this.center();
    if (this.c.day === 0 && this.game.settings.tutorial) setTimeout(() => this.tutorial(), 300);
  }

  exit(): void {
    this.game.hud.innerHTML = '';
    if (this.standalone) saveColony(this.game.colonySlot, this.c);
  }

  onBack(): boolean {
    if (this.sel) {
      this.sel = null;
      this.drawBuildBar();
      return true;
    }
    this.leave();
    return true;
  }

  private leave(): void {
    if (this.standalone) {
      saveColony(this.game.colonySlot, this.c);
      this.game.go('menu');
    } else this.game.go('system', { arrive: 'resume' });
  }

  private tutorial(): void {
    openModal('Governor\'s Briefing', [
      h('p', null, 'Your colony starts with a Headquarters. Keep colonists fed, watered, housed, powered and employed.'),
      h('ul', { class: 'small' },
        h('li', null, 'Build Solar Arrays for power, Hydroponic Farms for food (best on fertile soil) and Water Extractors (best on ice).'),
        h('li', null, 'Habitat Domes add housing. Colonists need jobs: every building needs workers.'),
        h('li', null, 'Mines on ore deposits → Refinery makes metals, needed for most construction.'),
        h('li', null, 'Research Labs unlock advanced buildings. A Spaceport exports surplus for credits.'),
        h('li', null, 'Build Defense Turrets before pirates notice you.'),
        this.standalone ? h('li', null, 'Victory: build the Space Elevator and reach 3,000 colonists.') : h('li', null, 'Your colony pays taxes into your account and exports to the system market.')),
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => document.querySelector('.modal-back')?.remove() }, 'Understood')),
    ]);
  }

  // ------------------------------------------------------------------ geometry
  private elev(i: number, j: number): number {
    const t = this.c.tiles[j * this.c.size + i];
    if (t === 'water' || t === 'lava') return 0;
    return Math.max(0, this.c.heights[j * this.c.size + i] + 0.15) * EH * 1.4;
  }

  private tileScreen(i: number, j: number): [number, number] {
    const z = this.zoom;
    const x = (i - j) * (TW / 2) * z + this.panX + this.game.width / 2;
    const y = (i + j) * (TH / 2) * z - this.elev(i, j) * z + this.panY + this.game.height * 0.18;
    return [x, y];
  }

  private center(): void {
    const s = this.c.size;
    const z = this.zoom;
    this.panX = 0;
    this.panY = -(s * TH / 2) * z * 0.5 + this.game.height * 0.12;
    const fit = Math.min(this.game.width / (s * TW), (this.game.height * 0.75) / (s * TH));
    this.zoom = clamp(fit * 1.1, 0.35, 2.2);
    this.panY = this.game.height * 0.05 - (s * TH / 2) * this.zoom * 0.35;
  }

  private pickTile(sx: number, sy: number): [number, number] | null {
    const s = this.c.size;
    let best: [number, number] | null = null;
    for (let j = 0; j < s; j++)
      for (let i = 0; i < s; i++) {
        const [x, y] = this.tileScreen(i, j);
        const dx = Math.abs(sx - x) / ((TW / 2) * this.zoom), dy = Math.abs(sy - (y + (TH / 2) * this.zoom)) / ((TH / 2) * this.zoom);
        if (dx + dy <= 1) best = [i, j];
      }
    return best;
  }

  // ------------------------------------------------------------------ terrain prerender
  private renderTerrain(): void {
    const c = this.c;
    const s = c.size;
    const w = s * TW + 20, hgt = s * TH + EH * 4 + 60;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = hgt;
    const g = cv.getContext('2d')!;
    const ox = w / 2, oy = EH * 3;
    const rng = new RNG(hash(c.planetSeed, 3));
    const pal = makePalette(c.planetType, c.planetSeed);
    const base: Partial<Record<TileType, string>> = {
      plain: `rgb(${pal.low.map((v) => v | 0).join(',')})`, fertile: '#4f8a3a', rock: `rgb(${pal.high.map((v) => v | 0).join(',')})`, mountain: `rgb(${pal.peak.map((v) => (v * 0.8) | 0).join(',')})`,
      water: `rgb(${pal.shallow.map((v) => v | 0).join(',')})`, ice: '#dceaf4', lava: '#e05020',
    };
    for (let j = 0; j < s; j++)
      for (let i = 0; i < s; i++) {
        const t = c.tiles[j * s + i];
        const e = this.elev(i, j);
        const x = ox + (i - j) * (TW / 2), y = oy + (i + j) * (TH / 2) - e;
        let col = base[t] ?? TILE_INFO[t].color;
        const jitter = rng.range(-0.06, 0.06) + (c.heights[j * s + i] * 0.15);
        col = shade(col.startsWith('rgb') ? rgbToHex(col) : col, jitter);
        // side faces
        const drop = e + 4;
        g.fillStyle = shade(col, -0.35);
        g.beginPath();
        g.moveTo(x - TW / 2, y + TH / 2);
        g.lineTo(x, y + TH);
        g.lineTo(x, y + TH + drop);
        g.lineTo(x - TW / 2, y + TH / 2 + drop);
        g.fill();
        g.fillStyle = shade(col, -0.5);
        g.beginPath();
        g.moveTo(x + TW / 2, y + TH / 2);
        g.lineTo(x, y + TH);
        g.lineTo(x, y + TH + drop);
        g.lineTo(x + TW / 2, y + TH / 2 + drop);
        g.fill();
        // top
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + TW / 2, y + TH / 2);
        g.lineTo(x, y + TH);
        g.lineTo(x - TW / 2, y + TH / 2);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.12)';
        g.stroke();
        // deposit decorations
        const cx = x, cy = y + TH / 2;
        if (t === 'ore') {
          for (let k = 0; k < 5; k++) { g.fillStyle = '#c08050'; g.fillRect(cx + rng.range(-14, 14), cy + rng.range(-6, 6), 4, 3); }
        } else if (t === 'crystal') {
          for (let k = 0; k < 4; k++) {
            const px = cx + rng.range(-12, 12), py = cy + rng.range(-5, 5);
            g.fillStyle = '#d0a0ff';
            g.beginPath(); g.moveTo(px, py - 9); g.lineTo(px + 3, py); g.lineTo(px - 3, py); g.fill();
          }
        } else if (t === 'vent') {
          g.fillStyle = '#301008';
          g.beginPath(); g.ellipse(cx, cy, 9, 4, 0, 0, 6.28); g.fill();
          g.fillStyle = 'rgba(255,120,40,0.8)';
          g.beginPath(); g.ellipse(cx, cy, 5, 2, 0, 0, 6.28); g.fill();
        } else if (t === 'mountain') {
          g.fillStyle = shade(col, 0.1);
          g.beginPath(); g.moveTo(cx - 16, cy + 6); g.lineTo(cx - 2, cy - 22); g.lineTo(cx + 14, cy + 6); g.fill();
          g.fillStyle = '#f0f0f0';
          g.beginPath(); g.moveTo(cx - 6, cy - 12); g.lineTo(cx - 2, cy - 22); g.lineTo(cx + 3, cy - 12); g.fill();
        } else if (t === 'fertile' && rng.chance(0.6)) {
          for (let k = 0; k < 3; k++) { g.fillStyle = '#2f6a2a'; g.beginPath(); g.arc(cx + rng.range(-14, 14), cy + rng.range(-5, 5), 3, 0, 6.28); g.fill(); }
        } else if (t === 'water') {
          g.strokeStyle = 'rgba(255,255,255,0.25)';
          g.beginPath(); g.moveTo(cx - 10, cy); g.lineTo(cx - 2, cy); g.stroke();
        }
      }
    this.terrain = cv;
    (this.terrain as any).ox = ox;
    (this.terrain as any).oy = oy;
  }

  // ------------------------------------------------------------------ UI
  buildUI(): void {
    const hud = this.game.hud;
    clear(hud);
    const R = this.refs;
    R.res = h('div', { class: 'col-res' });
    R.speed = h('div', { class: 'row' });
    hud.append(h('div', { class: 'panel col-top' },
      h('button', { class: 'btn small', onclick: () => this.leave() }, this.standalone ? '⏏' : '← Back'),
      h('b', null, this.c.name), h('span', { class: 'muted small' }, `${this.c.planetName} · ${PLANET_LABEL[this.c.planetType]}`),
      R.res, h('div', { class: 'grow' }), R.speed,
      h('button', { class: 'btn small', onclick: () => this.refs.side.classList.toggle('open') }, '☰ Info'),
      this.standalone ? h('button', { class: 'btn small', onclick: () => this.menu() }, '≡') : null));
    R.side = h('div', { class: 'panel col-side' });
    R.build = h('div', { class: 'panel col-build' });
    R.info = h('div', { class: 'panel', style: 'position:absolute;left:0.5em;top:4.2em;width:15em;padding:0.6em;font-size:0.82em;display:none' });
    hud.append(R.side, R.build, R.info);
    this.drawSpeed();
    this.drawBuildBar();
    this.updateHud();
  }

  private menu(): void {
    const m = openModal('Colony Menu', h('div', { class: 'col' },
      h('button', { class: 'btn', onclick: () => { m.close(); openSaveLoad(this.game, 'save', 'colony'); } }, '💾 Save colony'),
      h('button', { class: 'btn', onclick: () => { m.close(); openSaveLoad(this.game, 'load', 'colony'); } }, '⤓ Load colony'),
      h('button', { class: 'btn', onclick: () => { m.close(); openSettings(this.game); } }, '⚙ Settings'),
      h('button', { class: 'btn danger', onclick: () => { m.close(); this.leave(); } }, '⏏ Save & quit to title')));
  }

  private drawSpeed(): void {
    const R = this.refs;
    clear(R.speed);
    for (const [v, l] of [[0, '⏸'], [1, '▶'], [2, '▶▶'], [4, '▶▶▶']] as [number, string][]) {
      R.speed.append(h('button', { class: `btn tiny ${this.speed === v ? 'active' : ''}`, onclick: () => { this.speed = v; this.drawSpeed(); } }, l));
    }
  }

  private drawBuildBar(): void {
    const R = this.refs;
    clear(R.build);
    R.build.append(h('div', { class: `bitem ${this.sel === 'demolish' ? 'sel' : ''}`, onclick: () => { this.sel = this.sel === 'demolish' ? null : 'demolish'; this.drawBuildBar(); } },
      h('div', { class: 'bicon' }, '🗑'), h('div', null, 'Demolish')));
    for (const b of BUILDINGS) {
      if (b.id === 'hq') continue;
      const locked = !!b.research && !this.c.techs.includes(b.research);
      const cost = [`${b.cost.credits}cr`, b.cost.metals ? `${b.cost.metals}⛓` : '', b.cost.alloys ? `${b.cost.alloys}🔩` : '', b.cost.crystals ? `${b.cost.crystals}🔮` : ''].filter(Boolean).join(' ');
      R.build.append(h('div', { class: `bitem ${this.sel === b.id ? 'sel' : ''} ${locked ? 'locked' : ''}`, title: b.desc, onclick: () => {
        if (locked) return void toast(`Requires research: ${b.research}`, 'bad');
        this.sel = this.sel === b.id ? null : b.id;
        this.drawBuildBar();
        this.showBuildingInfo(b);
      } }, h('div', { class: 'bicon' }, b.icon), h('div', null, b.name), h('div', { class: 'tiny muted' }, cost)));
    }
  }

  private showBuildingInfo(b: BuildingDef, placed?: { x: number; y: number }): void {
    const R = this.refs;
    R.info.style.display = '';
    clear(R.info);
    const inst = placed ? buildingAt(this.c, placed.x, placed.y) : undefined;
    add(R.info,
      h('div', { class: 'row between' }, h('b', null, `${b.icon} ${b.name}`), h('button', { class: 'btn tiny', onclick: () => (R.info.style.display = 'none') }, '✕')),
      h('div', { class: 'small muted' }, b.desc),
      h('div', { class: 'small' }, `Power ${b.power > 0 ? '+' : ''}${b.power} · Workers ${b.workers}${b.housing ? ` · Housing ${b.housing}` : ''}`),
      b.produces ? h('div', { class: 'small good' }, 'Produces: ' + Object.entries(b.produces).map(([k, v]) => `${v} ${k}/day`).join(', ')) : null,
      b.consumes ? h('div', { class: 'small warn' }, 'Consumes: ' + Object.entries(b.consumes).map(([k, v]) => `${v} ${k}/day`).join(', ')) : null,
      b.requiresTile ? h('div', { class: 'small' }, `Requires: ${b.requiresTile.map((t) => TILE_INFO[t].name).join(', ')}`) : null,
      b.bonusTile ? h('div', { class: 'small' }, `Bonus ×${b.bonusTile.mult} on ${TILE_INFO[b.bonusTile.tile].name}`) : null,
      inst ? h('div', { class: 'small' }, inst.progress < 1 ? `Under construction ${(inst.progress * 100).toFixed(0)}%` : `Staffing ${(inst.staff * 100).toFixed(0)}% · Condition ${(inst.hp * 100).toFixed(0)}%`) : null,
      inst && inst.id !== 'hq' ? h('div', { class: 'row' },
        h('button', { class: 'btn tiny', onclick: () => { inst.enabled = !inst.enabled; this.c.report = computeReport(this.c); this.showBuildingInfo(b, placed); } }, inst.enabled ? '⏻ Disable' : '⏻ Enable'),
        h('button', { class: 'btn tiny danger', onclick: () => confirmDialog('Demolish', `Demolish ${b.name}?`, () => { demolish(this.c, this.wallet, inst.x, inst.y); R.info.style.display = 'none'; }, 'Demolish') }, 'Demolish')) : null);
  }

  private updateHud(): void {
    const R = this.refs;
    const c = this.c;
    const rep = c.report ?? computeReport(c);
    clear(R.res);
    const net = rep.net;
    const sp = (label: string, v: string, cls = '') => h('span', { class: cls }, label, ' ', v);
    add(R.res,
      sp('💰', fmtCr(this.wallet.get()), 'gold'),
      sp('👥', `${Math.round(c.pop)}/${rep.housing}`, c.pop > rep.housing ? 'bad' : ''),
      sp('😊', `${c.happiness.toFixed(0)}%`, c.happiness < 40 ? 'bad' : ''),
      sp('❤', `${c.health.toFixed(0)}%`, c.health < 40 ? 'bad' : ''),
      sp('⚡', `${rep.power.toFixed(0)}/${rep.powerDemand.toFixed(0)}`, rep.power < rep.powerDemand ? 'bad' : ''),
      sp('🛠', `${rep.workers}/${rep.jobs}`, rep.workers < rep.jobs ? 'warn' : ''),
      ...COLONY_RES.map((k) => sp(COLONY_RES_ICON[k], `${Math.floor(c.res[k])}${net && net[k] ? (net[k] >= 0 ? ' +' : ' ') + net[k].toFixed(1) : ''}`, net && net[k] < -0.01 && c.res[k] < 20 ? 'bad' : '')),
      sp('📅', `Day ${c.day}`));
    // side panel
    clear(R.side);
    const t = tabs(['Overview', 'Research', 'Trade', 'Log'], (name, body) => {
      this.sideTab = name;
      if (name === 'Overview') {
        add(body,
          h('div', { class: 'kv' }, 'Population', `${Math.round(c.pop)}`, 'Housing', rep.housing, 'Workforce / jobs', `${rep.workers} / ${rep.jobs}`,
            'Power', `${rep.power.toFixed(0)} / ${rep.powerDemand.toFixed(0)}`, 'Storage', 400 + rep.storage, 'Defense', rep.defense.toFixed(0),
            'Daily income', fmtCr(rep.income), 'Habitability', `${(c.habitability * 100).toFixed(0)}%`, 'Food need', `${rep.foodNeed.toFixed(1)}/day`, 'Water need', `${rep.waterNeed.toFixed(1)}/day`),
          c.effects.length ? h('div', { class: 'warn small' }, 'Active: ' + c.effects.map((e) => e.id).join(', ')) : null,
          h('div', { class: 'small muted' }, `Score ${colonyScore(c)}`));
        if (this.standalone) body.append(h('div', { class: 'small' }, 'Goal: Space Elevator + 3,000 colonists.'), bar(Math.min(1, c.pop / 3000), '#46d0dc', `${Math.round(c.pop)}/3000`));
      } else if (name === 'Research') {
        body.append(h('div', { class: 'small' }, `🔬 ${Math.floor(c.res.research)} points${c.researching ? ` · researching ${c.researching}` : ''}`));
        for (const tech of TECHS) {
          const done = c.techs.includes(tech.id);
          const avail = techAvailable(c, tech.id);
          body.append(h('div', { class: 'card', style: 'padding:0.4em;margin:0.3em 0' },
            h('div', { class: 'row between' }, h('b', null, tech.name), h('span', { class: 'mono' }, done ? '✓' : `${tech.cost}`)),
            h('div', { class: 'tiny muted' }, tech.desc),
            !done && avail ? h('button', { class: `btn tiny ${c.researching === tech.id ? 'active' : ''}`, onclick: () => { c.researching = tech.id; this.hudT = 0; } }, c.researching === tech.id ? 'Researching' : 'Research') :
              !done ? h('div', { class: 'tiny bad' }, `Requires: ${(tech.requires ?? []).join(', ')}`) : null));
        }
      } else if (name === 'Trade') {
        body.append(h('p', { class: 'tiny muted' }, this.standalone ? 'A freighter visits regularly. Buy at 150% and sell at 80% of base prices. A Spaceport also exports automatically above these limits.' : 'With a Spaceport, surplus above these limits is exported to the system market each day.'));
        for (const k of COLONY_RES) {
          if (k === 'research') continue;
          const lim = c.exportAbove[k] ?? 9999;
          add(body, h('div', { class: 'row between small' }, h('span', null, `${COLONY_RES_ICON[k]} ${k}`),
            h('span', { class: 'row nowrap' },
              h('button', { class: 'btn tiny', onclick: () => { c.exportAbove[k] = Math.max(0, lim - 50); this.hudT = 0; } }, '−'),
              h('span', { class: 'mono', style: 'width:3em;text-align:center' }, lim >= 9999 ? '∞' : String(lim)),
              h('button', { class: 'btn tiny', onclick: () => { c.exportAbove[k] = lim + 50; this.hudT = 0; } }, '+'),
              this.standalone ? h('button', { class: 'btn tiny', onclick: () => this.trade(k, 10) }, `Buy10 ${Math.round(STANDALONE_PRICE[k] * 15)}`) : null,
              this.standalone ? h('button', { class: 'btn tiny', onclick: () => this.trade(k, -10) }, 'Sell10') : null)));
        }
      } else {
        for (const l of c.log.slice(0, 40)) body.append(h('div', { class: `small ${l.kind === 'bad' ? 'bad' : l.kind === 'good' ? 'good' : ''}`, style: 'padding:0.15em 0;border-bottom:1px solid rgba(96,170,214,0.08)' }, h('span', { class: 'muted mono' }, `D${l.day} `), l.text));
      }
    }, this.sideTab);
    R.side.append(t);
  }

  private trade(k: ColonyRes, n: number): void {
    const c = this.c;
    if (n > 0) {
      const cost = Math.round(STANDALONE_PRICE[k] * 1.5 * n);
      if (this.wallet.get() < cost) return void toast('Not enough credits.', 'bad');
      this.wallet.add(-cost);
      c.res[k] += n;
    } else {
      const q = Math.min(-n, Math.floor(c.res[k]));
      c.res[k] -= q;
      this.wallet.add(Math.round(STANDALONE_PRICE[k] * 0.8 * q));
    }
    this.hudT = 0;
  }

  // ------------------------------------------------------------------ loop
  update(dt: number): void {
    this.t += dt;
    const c = this.c;
    const uiBusy = !!document.querySelector('.modal-back');
    // time
    if (!uiBusy && this.speed > 0 && !c.lost && !(c.won && this.standalone && !this.shownEnd)) {
      const dayLen = 2.5;
      if (this.standalone) {
        this.acc += dt * this.speed;
        while (this.acc >= dayLen) {
          this.acc -= dayLen;
          tickColony(c, this.wallet, undefined, 0);
        }
      } else {
        const w = this.game.world!;
        const before = c.day;
        advanceTime(w, (dt * this.speed) / dayLen, w.player.sys);
        if (c.day !== before) this.hudT = 0;
      }
    }
    if (this.standalone && (c.won || c.lost) && !this.shownEnd) {
      this.shownEnd = true;
      openModal(c.won ? 'Victory!' : 'Colony Lost', [
        h('p', null, c.won ? 'Your Space Elevator rises into the sky above a thriving world. History will remember this colony.' : 'The last colonists have left. The domes stand empty.'),
        h('p', { class: 'mono' }, `Score: ${colonyScore(c)} · Days: ${c.day} · Population: ${Math.round(c.pop)}`),
        h('div', { class: 'row end' }, c.won ? h('button', { class: 'btn', onclick: () => document.querySelector('.modal-back')?.remove() }, 'Keep playing') : null, h('button', { class: 'btn primary', onclick: () => { document.querySelector('.modal-back')?.remove(); this.leave(); } }, 'Main menu')),
      ]);
    }
    // camera
    if (!uiBusy) {
      if (input.dragging && input.pointers.size === 1) {
        this.panX += input.dragX;
        this.panY += input.dragY;
      }
      const zoomAt = (f: number, sx: number, sy: number) => {
        const nz = clamp(this.zoom * f, 0.3, 3);
        const k = nz / this.zoom;
        const cx = this.game.width / 2, cy = this.game.height * 0.18;
        this.panX = sx - cx - (sx - cx - this.panX) * k;
        this.panY = sy - cy - (sy - cy - this.panY) * k;
        this.zoom = nz;
      };
      if (input.wheel) zoomAt(Math.pow(0.9, input.wheel), input.mouseX, input.mouseY);
      if (input.pinch !== 1) zoomAt(input.pinch, input.pinchX, input.pinchY);
      const kx = (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
      const ky = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
      this.panX += kx * 500 * dt;
      this.panY += ky * 500 * dt;
      if (input.hit('Space')) { this.speed = this.speed ? 0 : 1; this.drawSpeed(); }
      this.hoverTile = this.game.isTouch() ? null : this.pickTile(input.mouseX, input.mouseY);
      for (const tap of input.taps) {
        const tile = this.pickTile(tap.x, tap.y);
        if (!tile) continue;
        this.selTile = tile;
        const [i, j] = tile;
        if (this.sel === 'demolish') {
          const err = demolish(c, this.wallet, i, j);
          if (err) toast(err, 'bad', 1500);
          else audio.play('build', 0.4);
        } else if (this.sel) {
          const err = build(c, this.wallet, this.sel, i, j);
          if (err) { toast(err, 'bad', 1800); audio.play('deny', 0.4); }
          else audio.play('build', 0.5);
        } else {
          const b = buildingAt(c, i, j);
          if (b) this.showBuildingInfo(BUILDING_MAP[b.id], { x: i, y: j });
          else {
            const t = c.tiles[j * c.size + i];
            this.refs.info.style.display = '';
            clear(this.refs.info);
            this.refs.info.append(h('div', { class: 'row between' }, h('b', null, TILE_INFO[t].name), h('button', { class: 'btn tiny', onclick: () => (this.refs.info.style.display = 'none') }, '✕')),
              h('div', { class: 'small muted' }, TILE_INFO[t].buildable ? 'Buildable. Select a structure from the bar below.' : 'Not buildable.'));
          }
        }
        this.hudT = 0;
      }
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.5;
      this.updateHud();
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.game.width, H = this.game.height;
    const c = this.c;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, this.sky[0]);
    sky.addColorStop(1, this.sky[1]);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    this.game.starfield.layers.slice(1).forEach(() => undefined);
    const z = this.zoom;
    if (this.terrain) {
      const T = this.terrain as any;
      const [x0, y0] = [this.panX + W / 2 - T.ox * z, this.panY + H * 0.18 - T.oy * z];
      g.drawImage(this.terrain, x0, y0, this.terrain.width * z, this.terrain.height * z);
    }
    // build range + placement preview
    const s = c.size;
    const tiles: [number, number][] = [];
    if (this.hoverTile) tiles.push(this.hoverTile);
    if (this.selTile && this.game.isTouch()) tiles.push(this.selTile);
    for (const [i, j] of tiles) {
      const [x, y] = this.tileScreen(i, j);
      let ok = true;
      if (this.sel && this.sel !== 'demolish') ok = !canBuild(c, this.wallet, this.sel, i, j);
      g.fillStyle = this.sel === 'demolish' ? 'rgba(255,80,80,0.35)' : this.sel ? (ok ? 'rgba(80,255,140,0.35)' : 'rgba(255,80,80,0.35)') : 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (TW / 2) * z, y + (TH / 2) * z);
      g.lineTo(x, y + TH * z);
      g.lineTo(x - (TW / 2) * z, y + (TH / 2) * z);
      g.closePath();
      g.fill();
    }
    // buildings, back to front
    const sorted = [...c.buildings].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const b of sorted) this.drawBuilding(g, b.id, b.x, b.y, b.progress, b.staff, b.enabled, b.hp);
    // ghost of selected building
    if (this.hoverTile && this.sel && this.sel !== 'demolish') {
      g.globalAlpha = 0.5;
      this.drawBuilding(g, this.sel, this.hoverTile[0], this.hoverTile[1], 1, 1, true, 1);
      g.globalAlpha = 1;
    }
    // colonist lights / traffic
    const rng = new RNG(7);
    for (let k = 0; k < Math.min(40, c.pop / 20); k++) {
      const b = c.buildings[rng.int(0, c.buildings.length - 1)];
      if (!b) break;
      const [x, y] = this.tileScreen(b.x, b.y);
      const a = this.t * rng.range(0.3, 1) + k;
      g.fillStyle = 'rgba(255,230,160,0.8)';
      g.fillRect(x + Math.cos(a) * 18 * z, y + TH / 2 * z + Math.sin(a) * 8 * z, 2, 2);
    }
    void s;
    void hexToRgb;
  }

  private drawBuilding(g: CanvasRenderingContext2D, id: string, i: number, j: number, progress: number, staff: number, enabled: boolean, hp: number): void {
    const def = BUILDING_MAP[id];
    const z = this.zoom;
    const [x, ty] = this.tileScreen(i, j);
    const y = ty + (TH / 2) * z; // tile centre
    const col = def.color;
    const bh = def.height * 22 * z;
    const building = progress < 1;
    if (building) g.globalAlpha *= 0.55;
    const prism = (w: number, d: number, hh: number, c: string) => {
      // w,d half extents in tile units
      const hw = (TW / 2) * w * z, hd = (TH / 2) * d * z;
      g.fillStyle = shade(c, -0.25);
      g.beginPath(); g.moveTo(x - hw, y); g.lineTo(x, y + hd); g.lineTo(x, y + hd - hh); g.lineTo(x - hw, y - hh); g.fill();
      g.fillStyle = shade(c, -0.45);
      g.beginPath(); g.moveTo(x + hw, y); g.lineTo(x, y + hd); g.lineTo(x, y + hd - hh); g.lineTo(x + hw, y - hh); g.fill();
      g.fillStyle = shade(c, 0.1);
      g.beginPath(); g.moveTo(x, y - hd - hh); g.lineTo(x + hw, y - hh); g.lineTo(x, y + hd - hh); g.lineTo(x - hw, y - hh); g.closePath(); g.fill();
    };
    switch (def.shape) {
      case 'box':
        prism(0.7, 0.7, bh, col);
        g.fillStyle = 'rgba(255,230,150,0.7)';
        for (let k = 0; k < 3; k++) g.fillRect(x - (TW / 2) * 0.5 * z + k * 7 * z, y - bh * 0.5, 3 * z, 3 * z);
        break;
      case 'tower':
        prism(0.45, 0.45, bh, col);
        g.fillStyle = 'rgba(255,240,180,0.8)';
        for (let k = 1; k < 6; k++) g.fillRect(x - 8 * z, y - (bh * k) / 6, 5 * z, 2 * z);
        break;
      case 'dome': {
        const r = (TW / 2) * 0.62 * z;
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath(); g.ellipse(x, y, r, r * 0.5, 0, 0, 6.28); g.fill();
        const grd = g.createRadialGradient(x - r * 0.3, y - bh * 0.7, 2, x, y - bh * 0.3, r * 1.2);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.3, col);
        grd.addColorStop(1, shade(col, -0.5));
        g.fillStyle = grd;
        g.beginPath(); g.ellipse(x, y, r, Math.max(r * 0.5, bh * 1.2), 0, Math.PI, 0); g.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI); g.fill();
        break;
      }
      case 'panel':
        g.fillStyle = '#1a2a50';
        for (let k = -1; k <= 1; k += 2) {
          g.beginPath();
          g.moveTo(x + k * 10 * z, y - 10 * z); g.lineTo(x + k * 24 * z, y - 3 * z); g.lineTo(x + k * 10 * z, y + 6 * z); g.lineTo(x - k * 4 * z, y - 1 * z);
          g.fill();
        }
        g.strokeStyle = '#6a8ac0';
        g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x - 20 * z, y - 2 * z); g.lineTo(x + 20 * z, y - 2 * z); g.stroke();
        break;
      case 'turret':
        prism(0.4, 0.4, bh * 0.6, '#5a5a62');
        g.strokeStyle = '#c8d0da';
        g.lineWidth = 3 * z;
        g.beginPath(); g.moveTo(x, y - bh * 0.7); g.lineTo(x + 16 * z, y - bh * 0.9 - 6 * z); g.stroke();
        g.fillStyle = col;
        g.beginPath(); g.arc(x, y - bh * 0.7, 6 * z, 0, 6.28); g.fill();
        break;
      case 'pad':
        g.fillStyle = '#6a6e78';
        g.beginPath(); g.ellipse(x, y, (TW / 2) * 0.8 * z, (TH / 2) * 0.8 * z, 0, 0, 6.28); g.fill();
        g.fillStyle = '#ffe080';
        g.font = `bold ${Math.round(12 * z)}px Roboto, sans-serif`;
        g.textAlign = 'center';
        g.fillText('H', x, y + 4 * z);
        if (Math.floor(this.t) % 6 < 3) {
          g.fillStyle = '#c8d0da';
          g.beginPath(); g.moveTo(x, y - 22 * z - (this.t % 3) * 6 * z); g.lineTo(x + 5 * z, y - 10 * z); g.lineTo(x - 5 * z, y - 10 * z); g.fill();
        }
        break;
      case 'rig':
        g.strokeStyle = shade(col, -0.2);
        g.lineWidth = 2 * z;
        g.beginPath();
        g.moveTo(x - 12 * z, y); g.lineTo(x, y - bh); g.lineTo(x + 12 * z, y);
        g.moveTo(x - 6 * z, y - bh * 0.5); g.lineTo(x + 6 * z, y - bh * 0.5);
        g.stroke();
        g.fillStyle = col;
        g.fillRect(x - 5 * z, y - bh - 4 * z, 10 * z, 5 * z);
        break;
      case 'spire': {
        g.fillStyle = shade(col, -0.3);
        g.beginPath(); g.moveTo(x - 12 * z, y); g.lineTo(x, y - bh); g.lineTo(x, y + 6 * z); g.fill();
        g.fillStyle = shade(col, -0.5);
        g.beginPath(); g.moveTo(x + 12 * z, y); g.lineTo(x, y - bh); g.lineTo(x, y + 6 * z); g.fill();
        const grd = g.createRadialGradient(x, y - bh, 0, x, y - bh, 10 * z);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x - 10 * z, y - bh - 10 * z, 20 * z, 20 * z);
        break;
      }
    }
    if (building) {
      g.globalAlpha = 1;
      g.strokeStyle = '#ffd040';
      g.lineWidth = 1;
      g.strokeRect(x - 16 * z, y - bh - 8 * z, 32 * z, bh + 8 * z);
      g.fillStyle = '#ffd040';
      g.fillRect(x - 16 * z, y + 6 * z, 32 * z * progress, 3 * z);
    } else if (!enabled || staff < 0.5 || hp < 0.6) {
      g.font = `${Math.round(12 * z)}px sans-serif`;
      g.textAlign = 'center';
      g.fillText(!enabled ? '⏻' : hp < 0.6 ? '🔧' : '👷', x, y - bh - 8 * z);
    }
  }
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m) return '#888888';
  return '#' + m.slice(0, 3).map((v) => Math.min(255, parseInt(v)).toString(16).padStart(2, '0')).join('');
}
