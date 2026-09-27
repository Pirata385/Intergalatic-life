// Combat simulator used by the ship builder's "Test" button.
import type { Game, Scene } from '../game';
import type { ShipDesign, ShipClass } from '../ship/design';
import { CombatWorld } from '../ship/combat';
import { Ship } from '../ship/ship';
import { AIController } from '../ship/ai';
import { Camera } from '../render/camera';
import { drawShip, drawProjectiles, drawLoot, drawAsteroids } from '../render/combatdraw';
import { FlightControls } from './flight';
import { h, clear, bar, toast } from '../ui/dom';
import { input } from '../input/input';
import { clamp, dist2 } from '../core/math';
import { audio } from '../audio/audio';

export class ArenaScene implements Scene {
  name = 'arena';
  game: Game;
  design: ShipDesign;
  cw: CombatWorld;
  cam = new Camera();
  player!: Ship;
  zoomInit = (this.cam.zoom = 1.5);
  controls!: FlightControls;
  t = 0;
  refs: Record<string, HTMLElement> = {};
  hudT = 0;
  dmgLog: { t: number; d: number }[] = [];
  lastEnemyHp = 0;
  wave = 0;

  constructor(game: Game, opts: { design: ShipDesign }) {
    this.game = game;
    this.design = opts.design;
    // faction 1 = test dummy team, 0 = player
    this.cw = new CombatWorld((a, b) => a !== b);
    this.cw.sfx = (n, x, y, v = 0.4) => audio.play(n, v * 0.7);
  }

  enter(): void {
    audio.setMood('tense');
    this.reset();
    const hud = this.game.hud;
    clear(hud);
    this.refs.info = h('div', { class: 'panel shipstat' });
    hud.append(h('div', { class: 'hud-top' },
      h('div', { class: 'panel hud-info' }, h('b', null, 'COMBAT SIMULATOR'), h('span', { class: 'muted' }, this.design.name)),
      h('div', { class: 'hud-menu' },
        h('button', { class: 'btn', onclick: () => this.spawn('fighter', 3) }, '+3 Fighters'),
        h('button', { class: 'btn', onclick: () => this.spawn('frigate', 1) }, '+Frigate'),
        h('button', { class: 'btn', onclick: () => this.spawn('destroyer', 1) }, '+Destroyer'),
        h('button', { class: 'btn', onclick: () => this.spawn('cruiser', 1) }, '+Cruiser'),
        h('button', { class: 'btn', onclick: () => this.reset() }, '⟲ Reset'),
        h('button', { class: 'btn primary', onclick: () => this.back() }, '← Back to builder'))),
      this.refs.info);
    this.controls = new FlightControls(this.game, hud, {});
    this.controls.cruiseBtn.style.display = 'none';
    toast('Simulation: fly your design against target drones. Damage is not persistent.', 'info', 3500);
  }

  exit(): void {
    this.game.hud.innerHTML = '';
  }

  onBack(): boolean {
    this.back();
    return true;
  }

  back(): void {
    (this.game as any).builderDraft = this.design;
    this.game.go('builder', {});
  }

  reset(): void {
    this.cw.ships = [];
    this.cw.projectiles = [];
    this.cw.drones = [];
    this.player = new Ship(this.design, 0, this.design.name);
    this.player.isPlayer = true;
    this.player.ammo = { ...this.player.stats.ammoCap };
    this.cw.player = this.player;
    this.cw.add(this.player);
    // asteroid obstacles
    this.cw.asteroids = [];
    for (let i = 0; i < 25; i++) {
      const a = Math.random() * Math.PI * 2, r = 900 + Math.random() * 1800;
      this.cw.asteroids.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: 15 + Math.random() * 30, kind: 'ore', amount: 30, max: 30, angle: 0, spin: 0.2, verts: [i % 8], orbitR: r, orbitA: a, orbitSpeed: 0.002, mined: 0, hitT: 0 });
    }
    this.spawn('corvette', 1);
  }

  spawn(cls: ShipClass, n: number): void {
    const w = this.game.world;
    for (let i = 0; i < n; i++) {
      const fid = w ? w.factions.find((f) => f.kind === 'pirate')?.id ?? 1 : 1;
      const d = w ? w.design(fid, cls, i) : this.design;
      const s = new Ship(d, 1, `Drone ${cls}`);
      const a = Math.random() * Math.PI * 2;
      s.x = this.player.x + Math.cos(a) * 850;
      s.y = this.player.y + Math.sin(a) * 850;
      s.ai = new AIController('attack', 'normal', { x: s.x, y: s.y }, 0.55);
      s.target = this.player;
      s.warpIn = 0.6;
      this.cw.add(s);
    }
  }

  update(dt: number): void {
    this.t += dt;
    this.cam.vw = this.game.width;
    this.cam.vh = this.game.height;
    this.cam.tilt = this.game.settings.tilt;
    const s = this.player;
    if (!s.dead) {
      this.controls.apply(s, this.cam, dt, () => {
        let best: Ship | null = null, bd = 1e12;
        for (const o of this.cw.ships) {
          if (o === s || o.dead) continue;
          const d = dist2(o.x, o.y, s.x, s.y);
          if (d < bd) { bd = d; best = o; }
        }
        if (best) s.target = best;
        return best;
      }, false);
    }
    const before = this.cw.ships.filter((o) => o.faction === 1).reduce((a, o) => a + o.totalHp + o.shield, 0);
    this.cw.update(dt);
    const after = this.cw.ships.filter((o) => o.faction === 1 && !o.dead).reduce((a, o) => a + o.totalHp + o.shield, 0);
    const dealt = Math.max(0, before - after);
    this.dmgLog.push({ t: this.t, d: dealt });
    this.dmgLog = this.dmgLog.filter((x) => this.t - x.t < 5);
    if (s.dead) {
      toast('Your design was destroyed. Resetting simulation.', 'bad');
      this.reset();
    }
    if (input.wheel) this.cam.zoom = clamp(this.cam.zoom * Math.pow(0.88, input.wheel), 0.2, 3);
    if (input.pinch !== 1) this.cam.zoom = clamp(this.cam.zoom * input.pinch, 0.2, 3);
    this.cam.x += (s.x - this.cam.x) * Math.min(1, dt * 5);
    this.cam.y += (s.y - this.cam.y) * Math.min(1, dt * 5);
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.2;
      const dps = this.dmgLog.reduce((a, x) => a + x.d, 0) / 5;
      clear(this.refs.info);
      this.refs.info.append(
        h('div', { class: 'lbl' }, h('span', null, 'HULL'), h('span', null, `${Math.round(s.hpFraction() * 100)}%`)), bar(s.hpFraction(), '#e0a040'),
        h('div', { class: 'lbl' }, h('span', null, 'SHIELD'), h('span', null, `${Math.round(s.shield)}`)), bar(s.stats.shieldCap ? s.shield / s.stats.shieldCap : 0, '#50a8ff'),
        h('div', { class: 'lbl' }, h('span', null, 'ENERGY'), h('span', null, `${Math.round(s.energy)}`)), bar(s.energy / Math.max(1, s.stats.battery), '#60e0a0'),
        h('div', { class: 'lbl' }, h('span', null, 'MEASURED DPS'), h('span', null, dps.toFixed(0))),
        h('div', { class: 'lbl' }, h('span', null, 'ENEMIES'), h('span', null, String(this.cw.ships.filter((o) => o.faction === 1).length))));
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.game.width, H = this.game.height;
    this.game.starfield.draw(g, W, H, this.cam.x * 0.4, this.cam.y * 0.4, '#1a3050', 0.4);
    // grid floor for reference
    g.strokeStyle = 'rgba(70,208,220,0.07)';
    g.lineWidth = 1;
    const step = 200;
    const [x0, y0] = this.cam.toWorld(0, 0);
    const [x1, y1] = this.cam.toWorld(W, H);
    g.beginPath();
    for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
      const [sx] = this.cam.toScreen(x, 0);
      g.moveTo(sx, 0);
      g.lineTo(sx, H);
    }
    for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
      const [, sy] = this.cam.toScreen(0, y);
      g.moveTo(0, sy);
      g.lineTo(W, sy);
    }
    g.stroke();
    drawAsteroids(g, this.cw, this.cam);
    drawLoot(g, this.cw, this.cam, this.t);
    for (const s of [...this.cw.ships].sort((a, b) => a.y - b.y)) drawShip(g, s, this.cam, this.t, s.target === this.player);
    drawProjectiles(g, this.cw, this.cam);
    this.cw.particles.draw(g, (x, y) => this.cam.toScreen(x, y), this.cam.zoom, this.cam.tilt, W, H);
  }
}
