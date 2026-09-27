// Planetary surface exploration: procedural chunked terrain, a rover, resource
// deposits, ruins, wrecks, fauna and ancient sentinels.
import type { Game, Scene } from '../game';
import type { World } from '../sim/world';
import type { Body } from '../gen/system';
import { PLANET_LABEL } from '../gen/system';
import { SurfaceGen, ChunkData, CHUNK, KIND_LIST, kindPassable, kindSpeed, SurfaceEntity, SurfaceKind } from '../gen/terrain';
import { h, clear, toast, bar, openModal, fmtCr, add } from '../ui/dom';
import { input } from '../input/input';
import { FlightControls } from './flight';
import { clamp, wrapAngle, dist, dist2, hsl } from '../core/math';
import { RNG, hash } from '../core/rng';
import { C, COMMODITIES } from '../data/commodities';
import { MODULE_MAP } from '../data/modules';
import { advanceTime } from '../sim/simulation';
import { addXp, cargoUsed, playerStats } from '../player/player';
import { audio } from '../audio/audio';
import { Particles, PType } from '../render/particles';

const TPX = 6; // pixels per tile in chunk images

interface Bullet { x: number; y: number; vx: number; vy: number; life: number; enemy: boolean; dmg: number }

const UPGRADES: { id: string; name: string; cost: number; desc: string }[] = [
  { id: 'armor', name: 'Composite Armor', cost: 2500, desc: '+60 rover hull' },
  { id: 'cargo', name: 'Extended Hold', cost: 2000, desc: '+40 rover cargo' },
  { id: 'drill', name: 'Plasma Drill', cost: 3000, desc: 'Mine twice as fast' },
  { id: 'cannon', name: 'Rail Cannon', cost: 3500, desc: 'Double weapon damage' },
  { id: 'shield', name: 'Environmental Shield', cost: 4000, desc: 'Halves hazard drain' },
  { id: 'hover', name: 'Hover Skirt', cost: 5000, desc: 'Cross water at full speed' },
];

export class SurfaceScene implements Scene {
  name = 'surface';
  game: Game;
  w: World;
  body: Body;
  gen: SurfaceGen;
  chunks = new Map<string, ChunkData>();
  pending: [number, number][] = [];
  rover = { x: 0, y: 0, angle: 0, speed: 0, hp: 100, maxHp: 100, life: 100, cargo: new Array(COMMODITIES.length).fill(0) as number[], cap: 40, cd: 0 };
  entities = new Map<string, SurfaceEntity>();
  removed = new Set<string>();
  bullets: Bullet[] = [];
  particles = new Particles(800);
  camX = 0;
  camY = 0;
  zoom = 3.2;
  t = 0;
  controls!: FlightControls;
  hudRefs: Record<string, HTMLElement> = {};
  hudT = 0;
  mining: SurfaceEntity | null = null;
  mineT = 0;
  hazard: number;
  lightX: number;
  lightY: number;
  haze: string;
  discovered = 0;
  actions: { label: string; fn: () => void }[] = [];
  actKey = '';
  dayFrac = 0;
  lander = { x: 0.5, y: 0.5 };

  constructor(game: Game, opts: { body: Body; lat: number; lon: number }) {
    this.game = game;
    this.w = game.world!;
    this.body = opts.body;
    this.gen = new SurfaceGen(opts.body, opts.lat, opts.lon);
    const p = this.w.player;
    const up = p.roverUpgrades;
    this.rover.maxHp = 100 + (up.includes('armor') ? 60 : 0);
    this.rover.hp = this.rover.maxHp;
    this.rover.cap = 40 + (up.includes('cargo') ? 40 : 0);
    const b = this.body;
    this.hazard = (b.type === 'lava' ? 3 : 0) + (b.atmosphere === 'toxic' ? 1.5 : 0) + (b.atmosphere === 'none' ? 0.6 : 0) + Math.max(0, (b.temp - 330) / 150) + Math.max(0, (200 - b.temp) / 120);
    if (up.includes('shield')) this.hazard *= 0.5;
    const rng = new RNG(hash(b.seed, 3));
    const a = rng.range(0, Math.PI * 2);
    this.lightX = Math.cos(a);
    this.lightY = Math.sin(a);
    const atmo = this.gen.field.pal.atmo;
    this.haze = `rgba(${atmo[0] | 0},${atmo[1] | 0},${atmo[2] | 0},${(this.gen.field.pal.atmoStrength * 0.12).toFixed(3)})`;
    // find dry land near the chosen site (spiral search over nearby chunks)
    for (let cy = -1; cy <= 1; cy++) for (let cx = -1; cx <= 1; cx++) this.chunk(cx, cy);
    let found = false;
    for (let r = 0; r < CHUNK && !found; r++) {
      for (let a = 0; a < Math.max(1, r * 8) && !found; a++) {
        const ang = (a / Math.max(1, r * 8)) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r), y = Math.round(Math.sin(ang) * r);
        const k = this.kindAt(x, y);
        if (k && kindPassable(k) && k !== 'lava' && k !== 'water' && k !== 'toxic') {
          this.lander = { x: x + 0.5, y: y + 0.5 };
          found = true;
        }
      }
    }
    this.rover.x = this.lander.x + 1.5;
    this.rover.y = this.lander.y;
    if (!found) this.rover.x = this.lander.x;
    this.camX = this.rover.x;
    this.camY = this.rover.y;
  }

  enter(): void {
    audio.setMood('calm');
    this.buildHud();
    toast(`Touchdown on ${this.body.name}. Explore, mine deposits and return to the lander to lift off.`, 'info', 4500);
  }

  exit(): void {
    this.game.hud.innerHTML = '';
  }

  onBack(): boolean {
    this.landerMenu();
    return true;
  }

  // ------------------------------------------------------------------ terrain
  private chunk(cx: number, cy: number): ChunkData {
    const key = cx + ',' + cy;
    let c = this.chunks.get(key);
    if (!c) {
      c = this.gen.generateChunk(cx, cy);
      this.chunks.set(key, c);
      for (const e of c.entities) if (!this.removed.has(e.id)) this.entities.set(e.id, e);
    }
    return c;
  }

  private kindAt(x: number, y: number): SurfaceKind | null {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const c = this.chunks.get(cx + ',' + cy);
    if (!c) return null;
    const lx = Math.floor(x) - cx * CHUNK, ly = Math.floor(y) - cy * CHUNK;
    return KIND_LIST[c.kinds[ly * CHUNK + lx]];
  }

  /** Base layer: one pixel per tile (with margin) drawn with bilinear smoothing. */
  private chunkCanvas(c: ChunkData): HTMLCanvasElement {
    if (c.canvas) return c.canvas;
    const S = CHUNK, G = S + 2, M = S + 4;
    const cv = document.createElement('canvas');
    cv.width = cv.height = G;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(G, G);
    const d = img.data;
    const lx = this.lightX, ly = this.lightY;
    for (let ty = 0; ty < G; ty++)
      for (let tx = 0; tx < G; tx++) {
        const hi = (ty + 1) * M + tx + 1;
        const dx = c.heights[hi + 1] - c.heights[hi - 1];
        const dy = c.heights[hi + M] - c.heights[hi - M];
        const water = c.heights[hi] < this.gen.field.pal.seaLevel;
        const shade = water ? 1 : clamp(1 - (dx * lx + dy * ly) * 7, 0.55, 1.4);
        const o = (ty * G + tx) * 4, q = (ty * G + tx) * 3;
        d[o] = c.rgbM[q] * shade; d[o + 1] = c.rgbM[q + 1] * shade; d[o + 2] = c.rgbM[q + 2] * shade; d[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    c.canvas = cv;
    return cv;
  }

  /** Detail layer: dithering, vegetation, rocks and crystals at full resolution. */
  private chunkDetail(c: ChunkData): HTMLCanvasElement {
    if (c.detail) return c.detail;
    const S = CHUNK;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S * TPX;
    const g = cv.getContext('2d')!;
    const lx = this.lightX, ly = this.lightY;
    const rng = new RNG(hash(c.cx, c.cy, 5));
    // fine grain so the ground doesn't look like plastic
    for (let i = 0; i < S * S * 1.5; i++) {
      const x = rng.range(0, S * TPX), y = rng.range(0, S * TPX);
      const kind = KIND_LIST[c.kinds[Math.floor(y / TPX) * S + Math.floor(x / TPX)]];
      if (kind === 'water' || kind === 'deepwater' || kind === 'lava') continue;
      g.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
      g.fillRect(x, y, rng.range(1, 2.5), rng.range(1, 2.5));
    }
    const rng2 = new RNG(hash(c.cx, c.cy, 9));
    for (let i = 0; i < S * S * 0.09; i++) {
      const tx = rng2.int(0, S - 1), ty = rng2.int(0, S - 1);
      const kind = KIND_LIST[c.kinds[ty * S + tx]];
      const x = tx * TPX + rng2.range(0, TPX), y = ty * TPX + rng2.range(0, TPX);
      if (kind === 'forest') {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath();
        g.ellipse(x - lx * 3, y - ly * 3, 4, 3, 0, 0, 6.28);
        g.fill();
        g.fillStyle = `rgb(${30 + rng2.int(0, 30)},${80 + rng2.int(0, 50)},${30 + rng2.int(0, 20)})`;
        g.beginPath();
        g.arc(x, y, rng2.range(2.5, 4.5), 0, 6.28);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.beginPath();
        g.arc(x + lx * 1.2, y + ly * 1.2, 1.4, 0, 6.28);
        g.fill();
      } else if (kind === 'rock' || kind === 'sand' || kind === 'mountain' || kind === 'ice') {
        if (rng2.chance(kind === 'mountain' ? 0.7 : 0.35)) {
          const r = rng2.range(1, kind === 'mountain' ? 3.5 : 2.2);
          g.fillStyle = 'rgba(0,0,0,0.28)';
          g.beginPath(); g.arc(x - lx * r, y - ly * r, r, 0, 6.28); g.fill();
          g.fillStyle = kind === 'ice' ? 'rgba(255,255,255,0.5)' : 'rgba(210,200,180,0.4)';
          g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill();
        }
      } else if (kind === 'crystal') {
        g.fillStyle = 'rgba(200,170,255,0.85)';
        g.beginPath();
        g.moveTo(x, y - 4);
        g.lineTo(x + 2, y);
        g.lineTo(x, y + 2);
        g.lineTo(x - 2, y);
        g.fill();
      } else if (kind === 'grass' && rng2.chance(0.4)) {
        g.fillStyle = 'rgba(120,180,80,0.45)';
        g.fillRect(x, y, 1, 3);
      } else if ((kind === 'water' || kind === 'deepwater') && rng2.chance(0.25)) {
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x + 3, y); g.stroke();
      } else if (kind === 'lava' && rng2.chance(0.5)) {
        g.fillStyle = 'rgba(255,200,80,0.6)';
        g.beginPath(); g.arc(x, y, rng2.range(0.8, 2), 0, 6.28); g.fill();
      }
    }
    c.detail = cv;
    return cv;
  }

  // ------------------------------------------------------------------ HUD
  buildHud(): void {
    const hud = this.game.hud;
    clear(hud);
    const R = this.hudRefs;
    R.stats = h('div', { class: 'panel surface-hud' });
    R.actions = h('div', { class: 'actionbar' });
    hud.append(h('div', { class: 'hud-top' },
      h('div', { class: 'panel hud-info' }, h('b', null, this.body.name), h('span', { class: 'muted' }, PLANET_LABEL[this.body.type]), h('span', null, `${Math.round(this.body.temp - 273)}°C · ${this.body.atmosphere}`)),
      h('div', { class: 'hud-menu' }, h('button', { class: 'btn', onclick: () => this.landerMenu() }, '🛸 Lander'))), R.stats, R.actions);
    this.controls = new FlightControls(this.game, hud, { onAction: () => this.actions[0]?.fn() });
    this.controls.cruiseBtn.style.display = 'none';
    this.controls.autoBtn.style.display = 'none';
  }

  private updateHud(): void {
    const R = this.hudRefs;
    const r = this.rover;
    clear(R.stats);
    const used = r.cargo.reduce((a, b) => a + b, 0);
    add(R.stats,
      h('div', { class: 'row between' }, h('span', null, 'HULL'), h('span', { class: 'mono' }, `${Math.round(r.hp)}/${r.maxHp}`)), bar(r.hp / r.maxHp, '#e0a040'),
      h('div', { class: 'row between' }, h('span', null, 'LIFE SUPPORT'), h('span', { class: 'mono' }, `${Math.round(r.life)}%`)), bar(r.life / 100, r.life < 30 ? '#ff5a4a' : '#60e0a0'),
      h('div', { class: 'row between' }, h('span', null, 'ROVER HOLD'), h('span', { class: 'mono' }, `${used}/${r.cap}`)),
      h('div', { class: 'tiny muted' }, r.cargo.map((q, i) => (q ? `${COMMODITIES[i].icon}${q}` : '')).filter(Boolean).join(' ') || 'empty'),
      h('div', { class: 'tiny muted' }, `Lander: ${Math.round(dist(r.x, r.y, this.lander.x, this.lander.y))} m · Discoveries ${this.discovered}`));
    // actions
    this.actions = [];
    if (dist(r.x, r.y, this.lander.x, this.lander.y) < 4) this.actions.push({ label: 'Lander', fn: () => this.landerMenu() });
    const near = this.nearestEntity(2.6);
    if (near) {
      const label = near.kind === 'ruin' ? 'Explore ruin' : near.kind === 'wreck' ? 'Salvage wreck' : near.kind === 'cache' ? 'Open cache' : near.kind === 'artifact' ? 'Take artifact'
        : near.kind === 'creature' || near.kind === 'sentinel' ? '' : `Mine ${near.kind}`;
      if (label) this.actions.push({ label, fn: () => this.interact(near) });
    }
    const key = this.actions.map((a) => a.label).join('|');
    if (key !== this.actKey) {
      this.actKey = key;
      clear(R.actions);
      this.actions.forEach((a, i) => R.actions.append(h('button', { class: `btn ${i === 0 ? 'primary' : ''}`, onclick: a.fn }, a.label + (i === 0 && !this.game.isTouch() ? ' [E]' : ''))));
      this.controls.setAction(this.actions[0]?.label.split(' ')[0] ?? null);
    }
  }

  private nearestEntity(r: number): SurfaceEntity | null {
    let best: SurfaceEntity | null = null, bd = r * r;
    for (const e of this.entities.values()) {
      if (e.kind === 'creature' || e.kind === 'sentinel') continue;
      const d = dist2(e.x, e.y, this.rover.x, this.rover.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private addCargo(c: number, q: number): number {
    const used = this.rover.cargo.reduce((a, b) => a + b, 0);
    const n = Math.min(q, this.rover.cap - used);
    if (n <= 0) {
      toast('Rover hold is full. Return to the lander.', 'bad', 1500);
      return 0;
    }
    this.rover.cargo[c] += n;
    return n;
  }

  private interact(e: SurfaceEntity): void {
    const w = this.w;
    const p = w.player;
    const rng = new RNG(hash(e.x * 100, e.y * 100));
    switch (e.kind) {
      case 'ore': case 'crystal': case 'ice': case 'organics':
        this.mining = e;
        this.mineT = 0;
        return;
      case 'ruin': {
        const credits = rng.int(300, 1500);
        p.credits += credits;
        const art = this.addCargo(C.art, rng.int(1, 3));
        p.explorationData += 400;
        addXp(p, 80);
        if (rng.chance(0.45)) {
          const mods = ['shield_large', 'reactor_fusion', 'jump2', 'armor_nano', 'laser_heavy', 'repair', 'cloak', 'crystal_lance', 'singularity'];
          const id = rng.pick(mods);
          p.modules[id] = (p.modules[id] ?? 0) + 1;
          toast(`Ancient technology recovered: ${MODULE_MAP[id].name}!`, 'good', 4000);
        }
        toast(`The ruins yield ${art} artifact(s) and ${credits} cr of relics.`, 'good', 3500);
        this.discovered++;
        w.addNews(`${p.name} excavates ancient ruins on ${this.body.name}.`, 'discovery', p.sys);
        break;
      }
      case 'wreck': {
        const c = rng.pick([C.metals, C.alloys, C.elec, C.mach]);
        const n = this.addCargo(c, rng.int(4, 14));
        if (rng.chance(0.3)) {
          const id = rng.pick(['shield', 'reactor', 'laser', 'missile', 'cargo', 'sensor']);
          p.modules[id] = (p.modules[id] ?? 0) + 1;
          toast(`Salvaged ${MODULE_MAP[id].name} from the wreck.`, 'good');
        }
        toast(`Salvaged ${n} ${COMMODITIES[c].name}.`, 'good');
        addXp(p, 25);
        break;
      }
      case 'cache': {
        const cr = rng.int(200, 900);
        p.credits += cr;
        toast(`Supply cache: +${cr} credits.`, 'good');
        addXp(p, 15);
        break;
      }
      case 'artifact': {
        const n = this.addCargo(C.art, e.amount);
        toast(`Recovered ${n} alien artifact(s).`, 'good');
        addXp(p, 40);
        this.discovered++;
        break;
      }
    }
    this.removed.add(e.id);
    this.entities.delete(e.id);
    audio.play('pickup', 0.5);
  }

  landerMenu(): void {
    const w = this.w;
    const p = w.player;
    const atLander = dist(this.rover.x, this.rover.y, this.lander.x, this.lander.y) < 4;
    const body = h('div', { class: 'col' });
    const m = openModal('Lander', body);
    const draw = () => {
      clear(body);
      add(body,
        atLander ? null : h('p', { class: 'warn small' }, 'You must drive back to the lander (marked on screen) to lift off, or call an emergency pickup.'),
        h('div', { class: 'row' },
          h('button', { class: `btn primary ${atLander ? '' : 'disabled'}`, onclick: () => { m.close(); this.liftOff(false); } }, '⬆ Lift off'),
          !atLander ? h('button', { class: 'btn danger', onclick: () => { m.close(); this.liftOff(true); } }, 'Emergency pickup (lose rover cargo, 500 cr)') : null),
        h('h4', null, 'Rover upgrades'),
        ...UPGRADES.map((u) => {
          const own = p.roverUpgrades.includes(u.id);
          return h('div', { class: 'row between small' }, h('div', null, h('b', null, u.name), h('div', { class: 'muted tiny' }, u.desc)),
            own ? h('span', { class: 'good' }, 'Installed') : h('button', { class: `btn tiny ${p.credits < u.cost ? 'disabled' : ''}`, onclick: () => {
              p.credits -= u.cost;
              p.roverUpgrades.push(u.id);
              if (u.id === 'armor') { this.rover.maxHp += 60; this.rover.hp += 60; }
              if (u.id === 'cargo') this.rover.cap += 40;
              if (u.id === 'shield') this.hazard *= 0.5;
              draw();
            } }, fmtCr(u.cost)));
        }));
    };
    draw();
  }

  private liftOff(emergency: boolean): void {
    const w = this.w;
    const p = w.player;
    if (emergency) {
      p.credits = Math.max(0, p.credits - 500);
      this.rover.cargo.fill(0);
    }
    const stats = playerStats(p, p.hp.map((x) => x > 0));
    let lost = 0;
    this.rover.cargo.forEach((q, c) => {
      if (!q) return;
      const free = stats.cargo - cargoUsed(p);
      const n = Math.min(q, free);
      p.cargo[c] += n;
      lost += q - n;
    });
    if (lost) toast(`Ship hold full: ${lost} units left behind.`, 'bad');
    this.game.go('system', { arrive: 'resume' });
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    this.t += dt;
    const r = this.rover;
    const W = this.game.width, H = this.game.height;
    // time on the surface passes too
    this.dayFrac += dt / 60;
    if (this.dayFrac >= 0.25) {
      advanceTime(this.w, this.dayFrac, this.w.player.sys);
      this.dayFrac = 0;
    }
    // ensure chunks around the rover exist (generate progressively)
    const ccx = Math.floor(r.x / CHUNK), ccy = Math.floor(r.y / CHUNK);
    const viewTiles = Math.max(W, H) / (TPX * this.zoom) / 2 + CHUNK;
    const rad = Math.ceil(viewTiles / CHUNK);
    let budget = 2;
    for (let dy = -rad; dy <= rad && budget > 0; dy++)
      for (let dx = -rad; dx <= rad && budget > 0; dx++) {
        if (!this.chunks.has(ccx + dx + ',' + (ccy + dy))) {
          this.chunk(ccx + dx, ccy + dy);
          budget--;
        }
      }
    // controls (reuse flight controls on a fake ship-like object)
    const fake: any = { x: r.x, y: r.y, vx: Math.cos(r.angle) * r.speed, vy: Math.sin(r.angle) * r.speed, angle: r.angle, stats: { range: 10, turnRate: 2.6 }, energy: 100, thrust: 0, reverse: 0, boosting: false, firing: false, aimX: 0, aimY: 0,
      turnToward(target: number, dt2: number) { const d = wrapAngle(target - this.angle); const m = 2.6 * dt2; this.angle += Math.abs(d) < m ? d : Math.sign(d) * m; } };
    const cam = { toWorld: (sx: number, sy: number) => this.toWorld(sx, sy), toScreen: (x: number, y: number) => this.toScreen(x, y), tilt: 1, zoom: this.zoom } as any;
    if (!this.mining) this.controls.apply(fake, cam, dt, () => this.nearestHostile(), false);
    r.angle = fake.angle;
    const kind = this.kindAt(r.x, r.y) ?? 'rock';
    const hover = this.w.player.roverUpgrades.includes('hover');
    const terrainK = hover && (kind === 'water') ? 1 : kindSpeed(kind);
    const target = (fake.thrust - fake.reverse * 0.6) * 7.5 * terrainK * (fake.boosting ? 1.5 : 1);
    r.speed += (target - r.speed) * Math.min(1, dt * 3);
    const nx = r.x + Math.cos(r.angle) * r.speed * dt, ny = r.y + Math.sin(r.angle) * r.speed * dt;
    const nk = this.kindAt(nx, ny);
    if (nk && (kindPassable(nk) || (hover && nk === 'deepwater'))) {
      r.x = nx;
      r.y = ny;
    } else r.speed *= -0.3;
    if (kind === 'lava') r.hp -= 12 * dt;
    // hazards
    r.life = Math.max(0, r.life - this.hazard * dt * 0.6);
    if (dist(r.x, r.y, this.lander.x, this.lander.y) < 4) r.life = Math.min(100, r.life + 25 * dt);
    if (r.life <= 0) r.hp -= 4 * dt;
    // shooting
    r.cd -= dt;
    const hostile = this.nearestHostile();
    if (fake.firing && r.cd <= 0) {
      r.cd = 0.35;
      const tx = hostile ? hostile.x : fake.aimX, ty = hostile ? hostile.y : fake.aimY;
      const a = Math.atan2(ty - r.y, tx - r.x);
      const dmg = this.w.player.roverUpgrades.includes('cannon') ? 22 : 11;
      this.bullets.push({ x: r.x, y: r.y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, life: 0.5, enemy: false, dmg });
      audio.play('pulse', 0.2);
    }
    // mining
    if (this.mining) {
      const e = this.mining;
      if (dist(e.x, e.y, r.x, r.y) > 3 || fake.thrust > 0.2) this.mining = null;
      else {
        this.mineT += dt * (this.w.player.roverUpgrades.includes('drill') ? 2 : 1) * (1 + this.w.player.skills.science * 0.1);
        if (Math.random() < dt * 10) this.particles.sparks(e.x, e.y, 2, '#ffd080', 3);
        if (this.mineT >= 0.6) {
          this.mineT = 0;
          const c = e.kind === 'ore' ? C.ore : e.kind === 'crystal' ? C.crys : e.kind === 'ice' ? C.ice : C.food;
          const got = this.addCargo(c, 1);
          if (!got) this.mining = null;
          e.amount -= 1;
          if (e.amount <= 0) {
            this.removed.add(e.id);
            this.entities.delete(e.id);
            this.mining = null;
            addXp(this.w.player, 5);
          }
        }
      }
    }
    this.updateEntities(dt);
    this.updateBullets(dt);
    this.particles.update(dt);
    if (input.hit('KeyE', 'KeyF') && this.actions[0]) this.actions[0].fn();
    if (r.hp <= 0) {
      r.hp = r.maxHp * 0.5;
      r.x = this.lander.x;
      r.y = this.lander.y;
      r.cargo.fill(0);
      r.life = 100;
      this.w.player.credits = Math.max(0, this.w.player.credits - 800);
      toast('Rover disabled! Recovered to the lander (cargo lost, 800 cr repairs).', 'bad', 4000);
    }
    // camera
    const z = (f: number) => (this.zoom = clamp(this.zoom * f, 1.2, 7));
    if (input.wheel) z(Math.pow(0.88, input.wheel));
    if (input.pinch !== 1) z(input.pinch);
    this.camX += (r.x - this.camX) * Math.min(1, dt * 6);
    this.camY += (r.y - this.camY) * Math.min(1, dt * 6);
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.15;
      this.updateHud();
    }
  }

  private nearestHostile(): any {
    let best: SurfaceEntity | null = null, bd = 14 * 14;
    for (const e of this.entities.values()) {
      if (e.kind !== 'sentinel' && !(e.kind === 'creature' && e.data?.predator)) continue;
      const d = dist2(e.x, e.y, this.rover.x, this.rover.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { x: best.x, y: best.y, vx: 0, vy: 0, radius: 1 } : null;
  }

  private updateEntities(dt: number): void {
    const r = this.rover;
    for (const e of this.entities.values()) {
      const d = dist(e.x, e.y, r.x, r.y);
      if (d > 60) continue;
      if (e.kind === 'creature') {
        const data = e.data;
        if (data.predator && d < 12) {
          data.dir = Math.atan2(r.y - e.y, r.x - e.x);
          const sp = 5.5 * data.size;
          const nx = e.x + Math.cos(data.dir) * sp * dt, ny = e.y + Math.sin(data.dir) * sp * dt;
          if (kindPassable(this.kindAt(nx, ny) ?? 'mountain')) { e.x = nx; e.y = ny; }
          data.cd -= dt;
          if (d < 1.2 && data.cd <= 0) {
            data.cd = 1;
            r.hp -= 8 * data.size;
            this.particles.sparks(r.x, r.y, 4, '#ff6060', 4);
            audio.play('hit', 0.4);
          }
        } else {
          if (Math.random() < dt * 0.5) data.dir += (Math.random() - 0.5) * 2;
          const flee = !data.predator && d < 6;
          if (flee) data.dir = Math.atan2(e.y - r.y, e.x - r.x);
          const sp = (flee ? 4 : 1.2) * data.size;
          const nx = e.x + Math.cos(data.dir) * sp * dt, ny = e.y + Math.sin(data.dir) * sp * dt;
          const k = this.kindAt(nx, ny);
          if (k && kindPassable(k) && k !== 'water' && k !== 'lava') { e.x = nx; e.y = ny; } else data.dir += Math.PI / 2;
        }
      } else if (e.kind === 'sentinel') {
        e.data.cd -= dt;
        if (d < 14 && e.data.cd <= 0) {
          e.data.cd = 1.3;
          const a = Math.atan2(r.y - e.y, r.x - e.x) + (Math.random() - 0.5) * 0.1;
          this.bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 18, vy: Math.sin(a) * 18, life: 1, enemy: true, dmg: 9 });
          audio.play('laser', 0.2);
        }
      }
    }
  }

  private updateBullets(dt: number): void {
    const r = this.rover;
    for (const b of this.bullets) {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.enemy) {
        if (dist2(b.x, b.y, r.x, r.y) < 0.8) {
          r.hp -= b.dmg;
          b.life = 0;
          this.particles.sparks(b.x, b.y, 5, '#ff5050', 5);
        }
        continue;
      }
      for (const e of this.entities.values()) {
        if (e.kind !== 'creature' && e.kind !== 'sentinel') continue;
        if (dist2(b.x, b.y, e.x, e.y) < 1) {
          e.hp -= b.dmg;
          b.life = 0;
          this.particles.sparks(b.x, b.y, 4, '#ffd060', 4);
          if (e.hp <= 0) {
            this.removed.add(e.id);
            this.entities.delete(e.id);
            this.particles.explosion(e.x, e.y, 2, e.kind === 'sentinel' ? '#80c0ff' : '#ff8060');
            if (e.kind === 'sentinel') {
              this.addCargo(C.elec, 3);
              if (Math.random() < 0.5) this.addCargo(C.art, 1);
              addXp(this.w.player, 40);
              toast('Sentinel destroyed. Salvaged its core.', 'good');
            } else {
              this.addCargo(C.food, 3);
              addXp(this.w.player, 8);
            }
          }
          break;
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  // ------------------------------------------------------------------ render
  toScreen(x: number, y: number): [number, number] {
    const s = TPX * this.zoom;
    return [(x - this.camX) * s + this.game.width / 2, (y - this.camY) * s + this.game.height / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    const s = TPX * this.zoom;
    return [(sx - this.game.width / 2) / s + this.camX, (sy - this.game.height / 2) / s + this.camY];
  }

  render(g: CanvasRenderingContext2D): void {
    const W = this.game.width, H = this.game.height;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const s = TPX * this.zoom;
    const [wx0, wy0] = this.toWorld(0, 0);
    const [wx1, wy1] = this.toWorld(W, H);
    g.imageSmoothingEnabled = true;
    for (let cy = Math.floor(wy0 / CHUNK); cy <= Math.floor(wy1 / CHUNK); cy++)
      for (let cx = Math.floor(wx0 / CHUNK); cx <= Math.floor(wx1 / CHUNK); cx++) {
        const c = this.chunks.get(cx + ',' + cy);
        if (!c) continue;
        const [sx, sy] = this.toScreen(cx * CHUNK - 0.5, cy * CHUNK - 0.5);
        const size = CHUNK * s;
        // sample tile centres so bilinear filtering blends across chunk borders using the margin
        g.drawImage(this.chunkCanvas(c), 0.5, 0.5, CHUNK + 1, CHUNK + 1, sx, sy, size + s, size + s);
        const [dx, dy] = this.toScreen(cx * CHUNK, cy * CHUNK);
        g.drawImage(this.chunkDetail(c), dx, dy, size, size);
      }
    // water shimmer
    // lander
    {
      const [lx, ly] = this.toScreen(this.lander.x, this.lander.y);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(lx - this.lightX * s, ly - this.lightY * s, s * 2.2, s * 1.4, 0, 0, 6.28);
      g.fill();
      g.fillStyle = '#b8c0cc';
      g.beginPath();
      g.arc(lx, ly, s * 1.6, 0, 6.28);
      g.fill();
      g.fillStyle = '#5a6a80';
      g.beginPath();
      g.arc(lx, ly, s * 0.9, 0, 6.28);
      g.fill();
      for (let i = 0; i < 3; i++) {
        const a = i * 2.094 + 0.5;
        g.strokeStyle = '#8a95a8';
        g.lineWidth = Math.max(1, s * 0.25);
        g.beginPath();
        g.moveTo(lx + Math.cos(a) * s * 1.4, ly + Math.sin(a) * s * 1.4);
        g.lineTo(lx + Math.cos(a) * s * 2.4, ly + Math.sin(a) * s * 2.4);
        g.stroke();
      }
      g.fillStyle = Math.floor(this.t * 2) % 2 ? '#46d0dc' : '#ffffff';
      g.fillRect(lx - 2, ly - 2, 4, 4);
    }
    // entities
    for (const e of this.entities.values()) {
      const [ex, ey] = this.toScreen(e.x, e.y);
      if (ex < -40 || ey < -40 || ex > W + 40 || ey > H + 40) continue;
      this.drawEntity(g, e, ex, ey, s);
    }
    // rover
    {
      const r = this.rover;
      const [rx, ry] = this.toScreen(r.x, r.y);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(rx - this.lightX * s * 0.6, ry - this.lightY * s * 0.6, s * 1.1, s * 0.8, r.angle, 0, 6.28);
      g.fill();
      g.save();
      g.translate(rx, ry);
      g.rotate(r.angle);
      g.fillStyle = '#2a2a30';
      g.fillRect(-s * 0.9, -s * 0.75, s * 0.5, s * 0.3);
      g.fillRect(-s * 0.9, s * 0.45, s * 0.5, s * 0.3);
      g.fillRect(s * 0.3, -s * 0.75, s * 0.5, s * 0.3);
      g.fillRect(s * 0.3, s * 0.45, s * 0.5, s * 0.3);
      g.fillStyle = this.w.player.design.colors[0];
      g.fillRect(-s * 0.8, -s * 0.5, s * 1.6, s);
      g.fillStyle = '#8ad8ff';
      g.fillRect(s * 0.25, -s * 0.3, s * 0.4, s * 0.6);
      g.fillStyle = '#c8d0da';
      g.fillRect(0, -s * 0.08, s * 1.1, s * 0.16);
      g.restore();
      if (this.mining) {
        const [mx, my] = this.toScreen(this.mining.x, this.mining.y);
        g.strokeStyle = 'rgba(120,255,150,0.8)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(rx, ry);
        g.lineTo(mx, my);
        g.stroke();
      }
    }
    // bullets
    for (const b of this.bullets) {
      const [bx, by] = this.toScreen(b.x, b.y);
      g.fillStyle = b.enemy ? '#ff5050' : '#ffe080';
      g.beginPath();
      g.arc(bx, by, Math.max(2, s * 0.2), 0, 6.28);
      g.fill();
    }
    this.particles.draw(g, (x, y) => this.toScreen(x, y), s, 1, W, H);
    // atmosphere haze + vignette
    g.fillStyle = this.haze;
    g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    // lander direction arrow when far
    const [lx, ly] = this.toScreen(this.lander.x, this.lander.y);
    if (lx < 0 || ly < 0 || lx > W || ly > H) {
      const a = Math.atan2(ly - H / 2, lx - W / 2);
      const ex = clamp(W / 2 + Math.cos(a) * W, 30, W - 30), ey = clamp(H / 2 + Math.sin(a) * H, 60, H - 30);
      g.fillStyle = '#46d0dc';
      g.save();
      g.translate(ex, ey);
      g.rotate(a);
      g.beginPath();
      g.moveTo(10, 0);
      g.lineTo(-6, 7);
      g.lineTo(-6, -7);
      g.fill();
      g.restore();
      g.font = '11px Roboto Mono, monospace';
      g.textAlign = 'center';
      g.fillText('LANDER', ex, ey + 18);
    }
  }

  private drawEntity(g: CanvasRenderingContext2D, e: SurfaceEntity, x: number, y: number, s: number): void {
    const shadow = () => {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.ellipse(x - this.lightX * s * 0.5, y - this.lightY * s * 0.5, s * 0.9, s * 0.6, 0, 0, 6.28);
      g.fill();
    };
    const pulse = 0.6 + Math.sin(this.t * 3 + e.x) * 0.4;
    switch (e.kind) {
      case 'ore':
      case 'crystal':
      case 'ice':
      case 'organics': {
        const col = e.kind === 'ore' ? '#d09a60' : e.kind === 'crystal' ? '#c080ff' : e.kind === 'ice' ? '#c0f0ff' : '#80e070';
        shadow();
        const grd = g.createRadialGradient(x, y, 0, x, y, s * 1.6);
        grd.addColorStop(0, col);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.35 * pulse;
        g.fillStyle = grd;
        g.fillRect(x - s * 1.6, y - s * 1.6, s * 3.2, s * 3.2);
        g.globalAlpha = 1;
        g.fillStyle = col;
        for (let i = 0; i < 4; i++) {
          const a = i * 1.7 + e.x;
          g.beginPath();
          g.moveTo(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5 - s * 0.6);
          g.lineTo(x + Math.cos(a) * s * 0.8, y + Math.sin(a) * s * 0.5);
          g.lineTo(x + Math.cos(a) * s * 0.2, y + Math.sin(a) * s * 0.5);
          g.fill();
        }
        break;
      }
      case 'ruin': {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x - s * 2 - this.lightX * s, y - s * 2 - this.lightY * s, s * 4, s * 4);
        g.fillStyle = '#6a6458';
        g.fillRect(x - s * 2, y - s * 2, s * 4, s * 4);
        g.fillStyle = '#4a463e';
        g.fillRect(x - s * 1.4, y - s * 1.4, s * 2.8, s * 2.8);
        g.fillStyle = `rgba(80,220,255,${0.4 + pulse * 0.5})`;
        for (let i = 0; i < 4; i++) g.fillRect(x - s * 1.2 + i * s * 0.7, y - s * 0.15, s * 0.35, s * 0.3);
        break;
      }
      case 'wreck':
        shadow();
        g.fillStyle = '#6a7078';
        g.save();
        g.translate(x, y);
        g.rotate(e.x);
        g.fillRect(-s * 1.2, -s * 0.4, s * 2.4, s * 0.8);
        g.fillStyle = '#3a3e44';
        g.fillRect(-s * 0.4, -s * 0.9, s * 0.8, s * 1.8);
        g.restore();
        break;
      case 'cache':
        shadow();
        g.fillStyle = '#c8a040';
        g.fillRect(x - s * 0.6, y - s * 0.6, s * 1.2, s * 1.2);
        g.strokeStyle = '#6a5020';
        g.strokeRect(x - s * 0.6, y - s * 0.6, s * 1.2, s * 1.2);
        break;
      case 'artifact':
        g.fillStyle = `rgba(255,176,64,${0.5 + pulse * 0.5})`;
        g.beginPath();
        g.moveTo(x, y - s);
        g.lineTo(x + s * 0.6, y);
        g.lineTo(x, y + s);
        g.lineTo(x - s * 0.6, y);
        g.fill();
        break;
      case 'creature': {
        const d = e.data;
        const [r, gg, b] = hsl(d.hue, 0.5, d.predator ? 0.4 : 0.55);
        const sz = s * 0.7 * d.size;
        shadow();
        g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        g.beginPath();
        g.ellipse(x, y, sz * 1.2, sz * 0.8, d.dir, 0, 6.28);
        g.fill();
        g.fillStyle = d.predator ? '#ff4040' : '#202020';
        g.beginPath();
        g.arc(x + Math.cos(d.dir) * sz, y + Math.sin(d.dir) * sz, sz * 0.25, 0, 6.28);
        g.fill();
        break;
      }
      case 'sentinel': {
        const bob = Math.sin(this.t * 2 + e.x) * s * 0.3;
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath();
        g.ellipse(x, y + s * 0.8, s * 0.8, s * 0.4, 0, 0, 6.28);
        g.fill();
        g.fillStyle = '#7a8898';
        g.beginPath();
        g.arc(x, y - s * 0.6 + bob, s * 0.8, 0, 6.28);
        g.fill();
        g.fillStyle = `rgba(255,60,60,${0.6 + pulse * 0.4})`;
        g.beginPath();
        g.arc(x, y - s * 0.6 + bob, s * 0.3, 0, 6.28);
        g.fill();
        break;
      }
    }

  }
}
