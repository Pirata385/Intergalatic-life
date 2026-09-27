// Orbital view of a single planet: detailed globe, survey data, landing-site
// selection, fuel skimming and colony founding.
import type { Game, Scene } from '../game';
import type { World } from '../sim/world';
import type { Body } from '../gen/system';
import { PLANET_LABEL, bodyPos } from '../gen/system';
import { generatePlanetTexture, PlanetTexture, PlanetField } from '../gen/planet';
import { planetGL } from '../render/planetgl';
import { renderSphere } from '../render/planetcpu';
import { h, clear, toast, openModal, bar, add, fmtCr } from '../ui/dom';
import { input } from '../input/input';
import { computeStats } from '../ship/design';
import { MODULE_MAP } from '../data/modules';
import { createColony } from '../sim/colony';
import { advanceTime } from '../sim/simulation';
import { addXp } from '../player/player';
import { drawStar } from '../render/sprites';
import { audio } from '../audio/audio';

export class PlanetScene implements Scene {
  name = 'planet';
  game: Game;
  w: World;
  body: Body;
  tex: PlanetTexture | null = null;
  field: PlanetField;
  rot = 0;
  t = 0;
  site: { lat: number; lon: number; water: boolean } | null = null;
  panel!: HTMLElement;
  sprite: HTMLCanvasElement | null = null;
  lastSpriteRot = -1;
  skimming = false;

  constructor(game: Game, opts: { body: Body }) {
    this.game = game;
    this.w = game.world!;
    this.body = opts.body;
    this.field = new PlanetField(this.body);
  }

  enter(): void {
    audio.setMood('calm');
    const st = this.w.systems[this.w.player.sys];
    const inhabited = st.pop > 50 && this.body.habitability > 0.4 && !this.body.parent ? 1 : 0;
    setTimeout(() => {
      this.tex = generatePlanetTexture(this.body, planetGL().ok ? 512 : 256, inhabited);
      if (planetGL().ok) planetGL().setTexture(this.tex);
    }, 20);
    this.buildHud();
  }

  exit(): void {
    this.game.hud.innerHTML = '';
  }

  onBack(): boolean {
    this.leave();
    return true;
  }

  leave(): void {
    this.game.go('system', { arrive: 'resume' });
  }

  private planetRect(): { cx: number; cy: number; r: number } {
    const W = this.game.width, H = this.game.height;
    const portrait = H > W;
    const r = portrait ? Math.min(W * 0.42, H * 0.26) : Math.min(W * 0.26, H * 0.4);
    return { cx: portrait ? W / 2 : W * 0.38, cy: portrait ? H * 0.3 : H * 0.52, r };
  }

  buildHud(): void {
    const hud = this.game.hud;
    clear(hud);
    this.panel = h('div', { class: 'panel gal-panel scroll' });
    hud.append(h('div', { class: 'gal-top' },
      h('button', { class: 'btn primary small', onclick: () => this.leave() }, '← Leave orbit'),
      h('div', { class: 'panel hud-info' }, h('b', null, this.body.name), h('span', { class: 'muted' }, PLANET_LABEL[this.body.type]))), this.panel);
    this.drawPanel();
  }

  drawPanel(): void {
    const w = this.w;
    const p = w.player;
    const b = this.body;
    const st = w.systems[p.sys];
    const scanned = st.scanned.includes(b.key);
    const panel = this.panel;
    clear(panel);
    const alive = p.hp.map((x) => x > 0);
    const stats = computeStats(p.design, alive);
    const giant = b.type === 'gas' || b.type === 'icegiant';
    const hasPod = p.design.modules.some((m, i) => alive[i] && MODULE_MAP[m.id].colony);
    const colonyHere = st.colony >= 0;
    const ownerOk = st.owner === -1 || st.owner === 0;
    add(panel,
      h('h3', { style: 'margin:0' }, b.name),
      h('div', { class: 'small muted' }, `${PLANET_LABEL[b.type]}${b.parent ? ` · moon of ${b.parent.name}` : ''} · ${b.au.toFixed(2)} AU`),
      scanned ? h('div', { class: 'kv' },
        'Radius', `${b.realRadius.toFixed(2)} R⊕`, 'Gravity', `${b.gravity.toFixed(2)} g`, 'Temperature', `${Math.round(b.temp)} K (${Math.round(b.temp - 273)} °C)`,
        'Atmosphere', b.atmosphere, 'Habitability', `${(b.habitability * 100).toFixed(0)}%`, 'Biosphere', b.biosphere > 0.05 ? `${(b.biosphere * 100).toFixed(0)}%` : 'None',
        'Moons', b.moons.length ? b.moons.map((m) => m.name).join(', ') : 'None') : h('div', { class: 'warn small' }, 'Not yet scanned. Scan from orbit to reveal details.'),
      scanned ? h('div', { class: 'col', style: 'gap:0.2em' }, h('h4', null, 'Resources'),
        ...Object.entries(b.resources).map(([k, v]) => h('div', { class: 'row nowrap small' }, h('span', { style: 'width:5.5em' }, k), h('div', { class: 'grow' }, bar(v, '#46d0dc')))),
        b.ruins ? h('div', { class: 'gold small' }, '◆ Ancient ruins detected on the surface.') : null) : null,
      !scanned ? h('button', { class: 'btn primary', onclick: () => {
        st.scanned.push(b.key);
        const value = Math.round((80 + b.habitability * 400 + (b.ruins ? 600 : 0) + b.biosphere * 300) * (1 + p.skills.science * 0.1));
        p.explorationData += value;
        addXp(p, 12 + value / 40);
        toast(`Orbital survey complete (+${value} cr of data).`, 'good');
        import('../sim/missions').then((m) => m.missionsOnScan(w, p.sys));
        this.drawPanel();
      } }, '📡 Orbital scan') : null,
      h('hr'),
      b.landable ? h('div', { class: 'col' },
        h('div', { class: 'small' }, this.site ? (this.site.water ? h('span', { class: 'bad' }, 'Selected site is liquid. Choose land.') : h('span', { class: 'good' }, `Landing site: ${(this.site.lat * 57.3).toFixed(1)}°, ${(this.site.lon * 57.3).toFixed(1)}°`)) : h('span', { class: 'muted' }, 'Tap the globe to choose a landing site.')),
        h('button', { class: `btn primary ${!this.site || this.site.water ? 'disabled' : ''}`, onclick: () => this.land() }, '⬇ Land & explore'),
        hasPod ? h('button', { class: `btn good ${!this.site || this.site.water || colonyHere || !ownerOk ? 'disabled' : ''}`, onclick: () => this.foundColony() }, '⌂ Found colony here') : null,
        hasPod && colonyHere ? h('div', { class: 'small warn' }, 'This system already hosts a colony.') : null,
        hasPod && !ownerOk ? h('div', { class: 'small warn' }, 'This system is claimed by another power. Colonize unclaimed systems.') : null,
        b.type === 'lava' || b.type === 'toxic' || b.temp > 500 || b.temp < 90 ? h('div', { class: 'small warn' }, '⚠ Hostile environment: your rover\'s life support will drain quickly.') : null)
        : h('div', { class: 'small muted' }, 'Gas giants cannot be landed on.'),
      giant ? h('button', { class: `btn ${p.fuel >= stats.fuel ? 'disabled' : ''}`, onclick: () => {
        const add = stats.fuel - p.fuel;
        p.fuel = stats.fuel;
        advanceTime(w, 0.5, p.sys);
        toast(`Skimmed ${Math.floor(add)} units of fuel from the upper atmosphere (half a day).`, 'good');
        this.drawPanel();
      } }, `⛽ Skim fuel (${Math.floor(p.fuel)}/${stats.fuel})`) : null,
      b.moons.length ? h('div', { class: 'row small' }, h('span', { class: 'muted' }, 'Moons:'), ...b.moons.map((m) => h('button', { class: 'btn tiny', onclick: () => this.game.go('planet', { body: m }) }, m.name))) : null,
      b.parent ? h('button', { class: 'btn tiny', onclick: () => this.game.go('planet', { body: b.parent }) }, `↑ ${b.parent.name}`) : null,
    );
    void fmtCr;
    void openModal;
  }

  private land(): void {
    if (!this.site || this.site.water) return;
    this.game.go('surface', { body: this.body, lat: this.site.lat, lon: this.site.lon });
  }

  private foundColony(): void {
    const w = this.w;
    const p = w.player;
    if (!this.site || this.site.water) return;
    const st = w.systems[p.sys];
    const podIdx = p.design.modules.findIndex((m, i) => p.hp[i] > 0 && MODULE_MAP[m.id].colony);
    if (podIdx < 0) return;
    const name = `${this.body.name} Colony`;
    const sys = w.sysData[p.sys];
    const c = createColony(w.colonies.length + 1, name, 'campaign', 0, this.body, this.site.lat, this.site.lon, sys.lum);
    c.founded = Math.floor(w.day);
    c.day = 0;
    c.credits = 0;
    w.colonies.push(c);
    st.colony = c.id;
    st.owner = 0;
    st.station = true;
    st.pop = Math.max(st.pop, 0.05);
    if (st.econ === 'frontier' || !st.stock) {
      st.econ = 'frontier';
      w.initMarket(p.sys);
    }
    st.maxDefense = w.baseDefense(st);
    st.defense = st.maxDefense;
    w.factions[0].systemsCount++;
    // consume the pod
    p.design = { ...p.design, modules: p.design.modules.filter((_, i) => i !== podIdx) };
    p.hp = p.hp.filter((_, i) => i !== podIdx);
    addXp(p, 300);
    w.stats.colonies++;
    w.addNews(`Captain ${p.name} founds the colony of ${name} on ${this.body.name}.`, 'colony', p.sys);
    toast('Colony founded! The Colony Pod has been deployed.', 'good', 5000);
    (this.game as any).systemNeedsRebuild = true;
    this.game.colony = c;
    this.game.go('colony', { colonyId: c.id });
  }

  update(dt: number): void {
    this.t += dt;
    this.rot += dt * 0.05;
    const { cx, cy, r } = this.planetRect();
    for (const tap of input.taps) {
      const dx = (tap.x - cx) / r, dy = (tap.y - cy) / r;
      if (dx * dx + dy * dy > 1) continue;
      const nz = Math.sqrt(1 - dx * dx - dy * dy);
      const lat = Math.asin(-dy);
      let lon = Math.atan2(dx, nz) + this.rot;
      lon = ((lon % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
      const hgt = this.field.height(x, y, z);
      const water = this.body.type !== 'barren' && this.body.type !== 'gas' && hgt < this.field.pal.seaLevel;
      this.site = { lat, lon, water };
      audio.play('ui', 0.3);
      this.drawPanel();
    }
    if (input.hit('KeyL') && this.site && !this.site.water) this.land();
  }

  render(g: CanvasRenderingContext2D): void {
    const game = this.game;
    const W = game.width, H = game.height;
    game.starfield.draw(g, W, H, this.t * 5, 0);
    const w = this.w;
    const sys = w.sysData[w.player.sys];
    const { cx, cy, r } = this.planetRect();
    // star direction from real positions
    const pos = bodyPos(this.body, w.day);
    const lxw = -pos.x, lyw = -pos.y;
    const l = Math.hypot(lxw, lyw) || 1;
    const lx = (lxw / l) * 0.8, ly = (lyw / l) * 0.45 - 0.15;
    const lz = 0.45;
    // distant star in the background
    drawStar(g, sys.stars[0], cx + lx * W * 0.9, cy + ly * H * 0.9, 14, this.t);
    if (this.tex) {
      const gl = planetGL();
      if (gl.ok) {
        const c = gl.render(Math.round(r * 2 * game.dpr), this.rot, this.rot * 1.25, [lx, ly, lz]);
        const s = c.width / game.dpr;
        g.drawImage(c, cx - s / 2, cy - s / 2, s, s);
      } else {
        if (!this.sprite || Math.abs(this.rot - this.lastSpriteRot) > 0.01) {
          this.sprite = renderSphere(this.tex, Math.min(360, Math.round(r * 2)), { rotation: this.rot, lightX: lx, lightY: ly, lightZ: lz }, this.sprite ?? undefined);
          this.lastSpriteRot = this.rot;
        }
        const s = r * 2 * 1.24;
        g.drawImage(this.sprite, cx - s / 2, cy - s / 2, s, s);
      }
    } else {
      g.fillStyle = '#89a';
      g.font = '14px Roboto Mono, monospace';
      g.textAlign = 'center';
      g.fillText('Generating surface map…', cx, cy);
    }
    // landing site marker
    if (this.site) {
      const lonV = this.site.lon - this.rot;
      const x = Math.cos(this.site.lat) * Math.sin(lonV), y = -Math.sin(this.site.lat), z = Math.cos(this.site.lat) * Math.cos(lonV);
      if (z > 0) {
        const sx = cx + x * r, sy = cy + y * r;
        g.strokeStyle = this.site.water ? '#ff6a5a' : '#46d0dc';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(sx, sy, 9 + Math.sin(this.t * 4) * 2, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(sx - 14, sy);
        g.lineTo(sx - 5, sy);
        g.moveTo(sx + 5, sy);
        g.lineTo(sx + 14, sy);
        g.stroke();
      }
    }
    // colony marker
    const st = w.systems[w.player.sys];
    const col = st.colony >= 0 ? w.colonies.find((c) => c.id === st.colony && c.body === this.body.key) : null;
    if (col) {
      const lonV = col.lon - this.rot;
      const x = Math.cos(col.lat) * Math.sin(lonV), y = -Math.sin(col.lat), z = Math.cos(col.lat) * Math.cos(lonV);
      if (z > 0) {
        g.fillStyle = '#6fe08a';
        g.beginPath();
        g.arc(cx + x * r, cy + y * r, 5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}
