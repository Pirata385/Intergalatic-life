// Galaxy map: navigation, territory, fleets, trade routes and route planning.
import type { Game, Scene } from '../game';
import type { World } from '../sim/world';
import { h, clear, openModal, toast, fmtCr, add } from '../ui/dom';
import { input } from '../input/input';
import { sysDist, findRoute } from '../gen/galaxy';
import { STAR_CLASSES, starLabel } from '../gen/stars';
import { COMMODITIES } from '../data/commodities';
import { ECONOMY_LABEL } from '../data/commodities';
import { repTier } from '../data/factions';
import { fleetPos } from '../sim/ai';
import { advanceTime } from '../sim/simulation';
import { computeStats } from '../ship/design';
import { PLANET_LABEL } from '../gen/system';
import { drawBlackHole } from '../render/sprites';
import { audio } from '../audio/audio';
import { hexToRgb } from '../core/math';

const glowCache = new Map<string, HTMLCanvasElement>();
function glow(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  const [r, gg, b] = hexToRgb(color);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, `rgba(${r},${gg},${b},0.95)`);
  grd.addColorStop(0.35, `rgba(${r},${gg},${b},0.25)`);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

export function fuelForJump(ly: number): number {
  return Math.ceil(ly * 0.8);
}

export class GalaxyScene implements Scene {
  name = 'galaxy';
  game: Game;
  w: World;
  cx: number;
  cy: number;
  scale = 6;
  selected = -1;
  route: number[] | null = null;
  showTerritory = true;
  showFleets = true;
  showTrade = false;
  showLabels = true;
  panel!: HTMLElement;
  terrCanvas: HTMLCanvasElement | null = null;
  terrKey = '';
  nebCanvas: HTMLCanvasElement | null = null;
  t = 0;
  lastTap = 0;
  maxJump: number;
  fuel: number;

  constructor(game: Game) {
    this.game = game;
    this.w = game.world!;
    const s = this.w.sysData[this.w.player.sys];
    this.cx = s.x;
    this.cy = s.y;
    const p = this.w.player;
    const alive = p.hp.map((x) => x > 0);
    const st = computeStats(p.design, alive);
    this.maxJump = st.jump;
    this.fuel = p.fuel;
  }

  enter(): void {
    audio.setMood('calm');
    this.buildHud();
    this.select(this.game.world!.player.sys);
    const saved = (this.game as any).galaxyRoute as number[] | undefined;
    if (saved && saved.length > 1) {
      this.select(saved[saved.length - 1]);
    }
  }

  exit(): void {
    this.game.hud.innerHTML = '';
  }

  onBack(): boolean {
    this.close();
    return true;
  }

  close(): void {
    this.game.go('system', { arrive: 'resume' });
  }

  buildHud(): void {
    const hud = this.game.hud;
    clear(hud);
    const toggle = (label: string, key: 'showTerritory' | 'showFleets' | 'showTrade' | 'showLabels') =>
      h('button', { class: `btn small ${this[key] ? 'active' : ''}`, onclick: (e: MouseEvent) => { this[key] = !this[key]; (e.currentTarget as HTMLElement).classList.toggle('active', this[key]); } }, label);
    const search = h('input', { type: 'text', placeholder: 'Find system…', style: 'width:9em', onkeydown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
      const hit = this.w.sysData.find((s) => s.name.toLowerCase().startsWith(q));
      if (hit) { this.select(hit.id); this.cx = hit.x; this.cy = hit.y; this.scale = Math.max(this.scale, 8); }
      else toast('No system found.', 'bad');
    } });
    hud.append(
      h('div', { class: 'gal-top' },
        h('button', { class: 'btn primary small', onclick: () => this.close() }, '✕ Close map'),
        h('div', { class: 'panel hud-info' }, h('span', null, 'Day ', h('span', { class: 'v', id: 'g-day' }, '')), h('span', null, 'Fuel ', h('span', { class: 'v' }, `${Math.floor(this.fuel)}`)), h('span', null, 'Jump ', h('span', { class: 'v' }, `${this.maxJump} ly`))),
        toggle('Territory', 'showTerritory'), toggle('Fleets', 'showFleets'), toggle('Trade', 'showTrade'), toggle('Labels', 'showLabels'),
        h('button', { class: 'btn small', onclick: () => this.center() }, '◎ Me'),
        search,
        h('button', { class: 'btn small', onclick: () => this.wait(1) }, '⏳ Wait 1d'),
        h('button', { class: 'btn small', onclick: () => this.wait(7) }, '⏳ 7d'),
      ),
      (this.panel = h('div', { class: 'panel gal-panel scroll' })),
      h('div', { class: 'panel legend' }, ...this.w.factions.filter((f) => f.alive && f.kind !== 'player').map((f) =>
        h('div', null, h('span', { class: 'dot', style: { background: f.color } }), f.name, h('span', { class: 'muted' }, ` (${f.systemsCount})`)))),
    );
  }

  center(): void {
    const s = this.w.sysData[this.w.player.sys];
    this.cx = s.x;
    this.cy = s.y;
  }

  wait(days: number): void {
    advanceTime(this.w, days, this.w.player.sys);
    toast(`${days} day${days > 1 ? 's' : ''} pass…`, 'info');
    this.select(this.selected);
  }

  select(id: number): void {
    this.selected = id;
    const w = this.w;
    const p = w.player;
    this.route = id >= 0 && id !== p.sys && this.maxJump > 0 ? findRoute(w.galaxy, p.sys, id, this.maxJump) : null;
    this.drawPanel();
  }

  drawPanel(): void {
    const w = this.w;
    const panel = this.panel;
    clear(panel);
    if (this.selected < 0) return;
    const s = w.sysData[this.selected];
    const st = w.systems[this.selected];
    const p = w.player;
    const owner = st.owner >= 0 ? w.factions[st.owner] : null;
    const d = sysDist(w.sysData[p.sys], s);
    let routeInfo: HTMLElement;
    let fuelNeeded = 0;
    if (this.selected === p.sys) routeInfo = h('div', { class: 'accent small' }, 'You are here.');
    else if (this.maxJump <= 0) routeInfo = h('div', { class: 'bad small' }, 'Your ship has no jump drive.');
    else if (!this.route) routeInfo = h('div', { class: 'bad small' }, `Unreachable with a ${this.maxJump} ly jump range.`);
    else {
      let dist = 0;
      for (let i = 1; i < this.route.length; i++) {
        const hop = sysDist(w.sysData[this.route[i - 1]], w.sysData[this.route[i]]);
        dist += hop;
        fuelNeeded += fuelForJump(hop);
      }
      const hostileOnRoute = this.route.slice(1).filter((id) => w.systems[id].owner >= 0 && w.hostile(0, w.systems[id].owner)).length;
      routeInfo = h('div', { class: 'small' },
        h('div', null, `Route: ${this.route.length - 1} jump(s), ${dist.toFixed(1)} ly, ~${(dist / 9).toFixed(1)} days`),
        h('div', { class: fuelNeeded > p.fuel ? 'bad' : 'good' }, `Fuel needed: ${fuelNeeded} (you have ${Math.floor(p.fuel)})`),
        hostileOnRoute ? h('div', { class: 'warn' }, `⚠ ${hostileOnRoute} hostile system(s) on route`) : null);
    }
    const fleetsHere = w.fleetsAt(this.selected);
    const missionsHere = p.missions.filter((m) => m.target === this.selected || m.targets.includes(this.selected));
    add(panel,
      h('div', { class: 'row between' }, h('h3', { style: 'margin:0' }, s.name), h('span', { class: 'tag' }, `${s.x.toFixed(0)}, ${s.y.toFixed(0)}`)),
      h('div', { class: 'small muted' }, `${starLabel(s.stars[0].cls)}${s.stars.length > 1 ? ' + ' + starLabel(s.stars[1].cls) + ' (binary)' : ''}`),
      s.nebula >= 0 ? h('div', { class: 'small', style: 'color:#c08aff' }, `Inside the ${w.galaxy.nebulae[s.nebula].name}`) : null,
      h('div', { class: 'kv' },
        'Owner', owner ? h('span', null, h('span', { class: 'dot', style: { background: owner.color } }), owner.name) : h('span', { class: 'muted' }, st.pop > 0 ? 'Independent' : 'Unclaimed'),
        'Standing', owner && owner.kind !== 'player' ? h('span', { style: { color: repTier(p.rep[owner.id]).color } }, `${repTier(p.rep[owner.id]).name} (${p.rep[owner.id].toFixed(0)})`) : '—',
        'Population', st.pop > 0 ? (st.pop >= 1000 ? `${(st.pop / 1000).toFixed(1)} B` : `${st.pop.toFixed(1)} M`) : 'None',
        'Economy', st.station ? `${ECONOMY_LABEL[st.econ]} · Tech ${st.tech}` : '—',
        'Security', st.station ? `${Math.round(st.security * 100)}%` : 'None',
        'Facilities', [st.station ? 'Station' : null, st.shipyard ? 'Shipyard' : null, st.military ? 'Military base' : null, st.colony >= 0 ? 'Your colony' : null].filter(Boolean).join(', ') || 'None',
        'Bodies', `${s.planets.length} planets, ${s.planets.reduce((a, pl) => a + pl.moons.length, 0)} moons${s.belts.length ? `, ${s.belts.length} belt(s)` : ''}`,
        'Distance', `${d.toFixed(1)} ly`),
      st.siege ? h('div', { class: 'bad small' }, `⚔ Under siege by ${w.factions[st.siege.by].name} (${st.siege.progress.toFixed(0)}%)`) : null,
      s.special !== 'none' ? h('div', { class: 'small warn' }, s.special === 'derelict' ? 'Sensors detect a derelict wreck.' : s.special === 'anomaly' ? 'Strange spatial anomaly detected.' : s.special === 'ruins' ? 'Ancient ruins reported on a planet.' : 'Galactic core. Extreme gravity.') : null,
      missionsHere.length ? h('div', { class: 'small accent' }, `📌 Missions: ${missionsHere.map((m) => m.title).join(', ')}`) : null,
      fleetsHere.length ? h('div', { class: 'small' }, h('h4', null, 'Fleets present'), ...fleetsHere.slice(0, 6).map((f) =>
        h('div', null, h('span', { class: 'dot', style: { background: w.factions[f.faction].color } }), `${f.name} (${f.ships.length})`, w.hostile(0, f.faction) ? h('span', { class: 'bad' }, ' hostile') : null))) : null,
      st.visited && st.stock ? this.marketPreview(this.selected) : st.station ? h('div', { class: 'tiny muted' }, 'Visit to record market prices.') : null,
      s.planets.length && st.visited ? h('div', { class: 'tiny muted' }, s.planets.map((pl) => `${pl.name}: ${PLANET_LABEL[pl.type]}`).join(' · ')) : null,
      routeInfo,
      p.fuel < 12 && this.selected === p.sys ? h('div', { class: 'card small' }, h('div', { class: 'warn' }, 'Fuel critically low.'),
        h('button', { class: `btn small ${p.credits < 1500 ? 'disabled' : ''}`, onclick: () => {
          p.credits -= 1500;
          p.fuel += 25;
          advanceTime(w, 3, p.sys);
          this.fuel = p.fuel;
          toast('A fuel tender arrives after three days: +25 fuel.', 'good');
          this.buildHud();
          this.select(this.selected);
        } }, 'Call emergency fuel tender (1,500 cr, 3 days)')) : null,
      h('div', { class: 'row' },
        this.route && this.selected !== p.sys ? h('button', { class: `btn primary ${fuelForJump(sysDist(w.sysData[p.sys], w.sysData[this.route[1]])) > p.fuel ? 'disabled' : ''}`, onclick: () => this.jump() }, `⤳ Jump${this.route.length > 2 ? ' (next hop: ' + w.sysData[this.route[1]].name + ')' : ''}`) : null,
        this.route && this.route.length > 2 ? h('button', { class: 'btn', onclick: () => { (this.game as any).galaxyRoute = this.route; toast('Course plotted. Use "Continue route" in flight.', 'good'); } }, 'Plot course') : null),
    );
  }

  marketPreview(id: number): HTMLElement {
    const w = this.w;
    const rows = COMMODITIES.slice(0, 17).map((c) => ({ c, p: w.price(id, c.id), r: w.price(id, c.id) / c.base })).sort((a, b) => a.r - b.r);
    const cheap = rows.slice(0, 3), dear = rows.slice(-3).reverse();
    return h('div', { class: 'small' },
      h('div', null, h('span', { class: 'muted' }, 'Cheap: '), cheap.map((r) => `${r.c.icon}${r.c.name} ${r.p}`).join(', ')),
      h('div', null, h('span', { class: 'muted' }, 'Wanted: '), dear.map((r) => `${r.c.icon}${r.c.name} ${r.p}`).join(', ')));
  }

  jump(): void {
    if (!this.route || this.route.length < 2) return;
    (this.game as any).galaxyRoute = this.route;
    this.game.go('system', { arrive: 'resume', jumpTo: this.route[1] });
  }

  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cx) * this.scale + this.game.width / 2, (y - this.cy) * this.scale + this.game.height / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.game.width / 2) / this.scale + this.cx, (sy - this.game.height / 2) / this.scale + this.cy];
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.game;
    // pan
    if (input.dragging && input.pointers.size === 1) {
      this.cx -= input.dragX / this.scale;
      this.cy -= input.dragY / this.scale;
    }
    const kx = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const ky = (input.down('KeyS', 'ArrowDown') ? 1 : 0) - (input.down('KeyW', 'ArrowUp') ? 1 : 0);
    this.cx += (kx * 400 * dt) / this.scale;
    this.cy += (ky * 400 * dt) / this.scale;
    // zoom
    const zoomAt = (factor: number, sx: number, sy: number) => {
      const [wx, wy] = this.toWorld(sx, sy);
      this.scale = Math.max(0.6, Math.min(70, this.scale * factor));
      const [nx, ny] = this.toWorld(sx, sy);
      this.cx += wx - nx;
      this.cy += wy - ny;
    };
    if (input.wheel) zoomAt(Math.pow(0.88, input.wheel), input.mouseX, input.mouseY);
    if (input.pinch !== 1) zoomAt(input.pinch, input.pinchX, input.pinchY);
    if (input.hit('Equal', 'NumpadAdd')) zoomAt(1.3, g.width / 2, g.height / 2);
    if (input.hit('Minus', 'NumpadSubtract')) zoomAt(1 / 1.3, g.width / 2, g.height / 2);
    if (input.hit('KeyM')) this.close();
    if (input.hit('Enter') && this.route) this.jump();
    for (const tap of input.taps) {
      const [wx, wy] = this.toWorld(tap.x, tap.y);
      let best = -1, bd = (22 / this.scale) ** 2;
      for (const s of this.w.sysData) {
        const d = (s.x - wx) ** 2 + (s.y - wy) ** 2;
        if (d < bd) { bd = d; best = s.id; }
      }
      if (best >= 0) {
        const now = performance.now();
        if (best === this.selected && now - this.lastTap < 400 && this.route) this.jump();
        this.lastTap = now;
        this.select(best);
      }
    }
    const dayEl = document.getElementById('g-day');
    if (dayEl) dayEl.textContent = String(Math.floor(this.w.day));
  }

  private territory(): HTMLCanvasElement {
    const w = this.w;
    const key = w.systems.map((s) => s.owner).join(',');
    if (this.terrCanvas && key === this.terrKey) return this.terrCanvas;
    this.terrKey = key;
    const R = w.galaxy.radius + 40;
    const res = 1.6; // px per ly
    const size = Math.ceil(R * 2 * res);
    const c = this.terrCanvas ?? document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, size, size);
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = size;
    const tg = tmp.getContext('2d')!;
    for (const f of w.factions) {
      if (!f.alive || f.kind === 'player' && f.systemsCount === 0) continue;
      tg.clearRect(0, 0, size, size);
      tg.fillStyle = f.color;
      let any = false;
      for (let i = 0; i < w.systems.length; i++) {
        if (w.systems[i].owner !== f.id) continue;
        any = true;
        const s = w.sysData[i];
        tg.beginPath();
        tg.arc((s.x + R) * res, (s.y + R) * res, 13 * res, 0, Math.PI * 2);
        tg.fill();
      }
      if (!any) continue;
      g.globalAlpha = 0.16;
      g.drawImage(tmp, 0, 0);
      // border outline
      g.globalAlpha = 0.35;
      g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
    return c;
  }

  private nebulae(): HTMLCanvasElement {
    if (this.nebCanvas) return this.nebCanvas;
    const w = this.w;
    const R = w.galaxy.radius + 60;
    const res = 1;
    const size = Math.ceil(R * 2 * res);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    // galactic glow
    const core = g.createRadialGradient(R, R, 0, R, R, R);
    core.addColorStop(0, 'rgba(255,220,180,0.22)');
    core.addColorStop(0.25, 'rgba(160,120,200,0.08)');
    core.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, size, size);
    for (const n of w.galaxy.nebulae) {
      for (let k = 0; k < 5; k++) {
        const ox = Math.cos(k * 2.1) * n.r * 0.35, oy = Math.sin(k * 1.7) * n.r * 0.35;
        const grd = g.createRadialGradient(n.x + R + ox, n.y + R + oy, 0, n.x + R + ox, n.y + R + oy, n.r * 1.1);
        grd.addColorStop(0, `rgba(${n.color[0]},${n.color[1]},${n.color[2]},0.16)`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, size, size);
      }
    }
    this.nebCanvas = c;
    return c;
  }

  /** Draws only the visible part of a world-aligned overlay image (fast at high zoom). */
  private drawOverlay(g: CanvasRenderingContext2D, img: HTMLCanvasElement, worldR: number): void {
    const W = this.game.width, H = this.game.height;
    const res = img.width / (worldR * 2);
    const [wx0, wy0] = this.toWorld(0, 0);
    const [wx1, wy1] = this.toWorld(W, H);
    const sx = Math.max(0, (wx0 + worldR) * res), sy = Math.max(0, (wy0 + worldR) * res);
    const ex = Math.min(img.width, (wx1 + worldR) * res), ey = Math.min(img.height, (wy1 + worldR) * res);
    if (ex <= sx || ey <= sy) return;
    const [dx, dy] = this.toScreen(sx / res - worldR, sy / res - worldR);
    const [dx2, dy2] = this.toScreen(ex / res - worldR, ey / res - worldR);
    g.drawImage(img, sx, sy, ex - sx, ey - sy, dx, dy, dx2 - dx, dy2 - dy);
  }

  render(g: CanvasRenderingContext2D): void {
    const game = this.game;
    const W = game.width, H = game.height;
    const w = this.w;
    game.starfield.draw(g, W, H, this.cx * 3, this.cy * 3);
    this.drawOverlay(g, this.nebulae(), w.galaxy.radius + 60);
    if (this.showTerritory) this.drawOverlay(g, this.territory(), w.galaxy.radius + 40);
    const p = w.player;
    const here = w.sysData[p.sys];
    // jump range
    if (this.maxJump > 0) {
      const [hx, hy] = this.toScreen(here.x, here.y);
      g.strokeStyle = 'rgba(70,208,220,0.35)';
      g.setLineDash([4, 6]);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(hx, hy, this.maxJump * this.scale, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    // trade routes
    if (this.showTrade) {
      g.lineWidth = 1;
      for (const fl of w.fleets) {
        if ((fl.role !== 'trade' && fl.role !== 'convoy') || !fl.cargo || fl.target < 0) continue;
        const a = fleetPos(w, fl);
        const b = w.sysData[fl.target];
        const [ax, ay] = this.toScreen(a.x, a.y);
        const [bx, by] = this.toScreen(b.x, b.y);
        g.strokeStyle = COMMODITIES[fl.cargo.c].color + '99';
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
    }
    // stars
    const s0 = this.scale;
    const dotBase = Math.max(0.8, Math.min(3.5, s0 * 0.35));
    for (const s of w.sysData) {
      const [sx, sy] = this.toScreen(s.x, s.y);
      if (sx < -30 || sy < -30 || sx > W + 30 || sy > H + 30) continue;
      const st = w.systems[s.id];
      const star = s.stars[0];
      if (star.cls === 'BH') {
        if (s0 > 4) drawBlackHole(g, sx, sy, Math.max(2, dotBase * 1.4), this.t, star.glow);
        else { g.fillStyle = '#ffa050'; g.fillRect(sx - 1, sy - 1, 3, 3); }
      } else {
        const size = dotBase * (STAR_CLASSES[star.cls].radius[0] / 150) * 5 * (st.pop > 0 ? 1.15 : 0.85);
        g.globalAlpha = st.visited ? 1 : 0.75;
        g.drawImage(glow(star.color), sx - size, sy - size, size * 2, size * 2);
        if (s.stars.length > 1) g.drawImage(glow(s.stars[1].color), sx - size * 0.2, sy - size * 1.1, size * 1.2, size * 1.2);
        g.globalAlpha = 1;
      }
      if (st.station && s0 > 3) {
        g.strokeStyle = st.owner >= 0 ? w.factions[st.owner].color : '#aaaaaa';
        g.lineWidth = 1;
        g.strokeRect(sx - dotBase * 2.2, sy - dotBase * 2.2, dotBase * 4.4, dotBase * 4.4);
      }
      if (st.siege && Math.floor(this.t * 3) % 2 === 0) {
        g.strokeStyle = '#ff4040';
        g.beginPath();
        g.arc(sx, sy, dotBase * 4, 0, Math.PI * 2);
        g.stroke();
      }
      if (this.showLabels && (s0 > 7 || (s0 > 3 && st.pop > 500) || s.id === this.selected)) {
        g.font = `${s.id === this.selected ? 600 : 400} ${Math.max(10, Math.min(13, s0 * 1.1))}px Roboto, system-ui, sans-serif`;
        g.fillStyle = s.id === this.selected ? '#ffffff' : st.visited ? 'rgba(200,215,240,0.85)' : 'rgba(160,175,200,0.6)';
        g.textAlign = 'center';
        g.fillText(s.name, sx, sy + dotBase * 3 + 12);
      }
    }
    // fleets
    if (this.showFleets && s0 > 1.6) {
      for (const fl of w.fleets) {
        const pos = fleetPos(w, fl);
        const [fx, fy] = this.toScreen(pos.x, pos.y);
        if (fx < -10 || fy < -10 || fx > W + 10 || fy > H + 10) continue;
        const f = w.factions[fl.faction];
        const sz = fl.role === 'war' ? 4 : 2.6;
        let ang = 0;
        if (fl.dest >= 0) {
          const b = w.sysData[fl.dest];
          ang = Math.atan2(b.y - pos.y, b.x - pos.x);
        }
        const off = fl.dest >= 0 ? 0 : 7;
        g.save();
        g.translate(fx + (fl.dest < 0 ? Math.cos(fl.id) * off : 0), fy + (fl.dest < 0 ? Math.sin(fl.id) * off : 0));
        g.rotate(ang);
        g.fillStyle = f.color;
        g.beginPath();
        g.moveTo(sz * 1.6, 0);
        g.lineTo(-sz, sz);
        g.lineTo(-sz, -sz);
        g.closePath();
        g.fill();
        if (fl.role === 'war' || fl.role === 'pirate') {
          g.strokeStyle = fl.role === 'pirate' ? '#ff3030' : '#ffffff';
          g.lineWidth = 0.8;
          g.stroke();
        }
        g.restore();
      }
    }
    // route
    if (this.route && this.route.length > 1) {
      g.strokeStyle = '#46d0dc';
      g.lineWidth = 2;
      g.beginPath();
      this.route.forEach((id, i) => {
        const s = w.sysData[id];
        const [x, y] = this.toScreen(s.x, s.y);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
    }
    // missions
    for (const m of p.missions) {
      for (const id of [m.target, ...m.targets]) {
        if (id < 0) continue;
        const s = w.sysData[id];
        const [x, y] = this.toScreen(s.x, s.y);
        g.fillStyle = '#40ffb0';
        g.beginPath();
        g.moveTo(x, y - 10);
        g.lineTo(x + 5, y - 18);
        g.lineTo(x - 5, y - 18);
        g.fill();
      }
    }
    // player marker
    {
      const [x, y] = this.toScreen(here.x, here.y);
      const pr = 8 + Math.sin(this.t * 3) * 2;
      g.strokeStyle = '#6fe08a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, pr, 0, Math.PI * 2);
      g.stroke();
    }
    // selection reticle (reference style: teal ring with ticks)
    if (this.selected >= 0) {
      const s = w.sysData[this.selected];
      const [x, y] = this.toScreen(s.x, s.y);
      const r = 16;
      g.strokeStyle = '#46c0c8';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
      g.save();
      g.translate(x, y);
      g.rotate(this.t * 0.3);
      for (let i = 0; i < 4; i++) {
        g.rotate(Math.PI / 2);
        g.beginPath();
        g.moveTo(r + 3, 0);
        g.lineTo(r + 10, 0);
        g.stroke();
      }
      g.restore();
    }
    // scale bar + cursor coordinates (as in the reference map)
    const barLy = [1, 2, 5, 10, 25, 50, 100].find((v) => v * this.scale > 80) ?? 100;
    g.strokeStyle = 'rgba(200,215,240,0.7)';
    g.lineWidth = 1.5;
    const bx = 14, by = H - 40;
    g.beginPath();
    g.moveTo(bx, by - 5);
    g.lineTo(bx, by);
    g.lineTo(bx + barLy * this.scale, by);
    g.lineTo(bx + barLy * this.scale, by - 5);
    g.stroke();
    g.fillStyle = 'rgba(200,215,240,0.8)';
    g.font = `12px ${'Roboto Mono, monospace'}`;
    g.textAlign = 'left';
    g.fillText(`${barLy} ly`, bx, by - 8);
    const [mx, my] = this.toWorld(input.mouseX, input.mouseY);
    g.fillStyle = 'rgba(160,175,200,0.6)';
    g.fillText(`${mx.toFixed(0)}, ${my.toFixed(0)}`, bx, by + 16);
    void openModal;
    void fmtCr;
  }
}
