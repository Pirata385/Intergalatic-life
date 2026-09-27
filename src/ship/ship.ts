// Runtime ship entity: physics, per-block damage, shields, energy and ammo.
import { MODULE_MAP, AmmoType, ModuleDef } from '../data/modules';
import { ShipDesign, ShipStats, computeStats, buildGrid, footprint, disconnected, CELL, WeaponMount } from './design';
import { renderShipSprite, PX } from './render';
import { wrapAngle, clamp } from '../core/math';
import type { AIController } from './ai';

export interface WeaponState {
  mount: WeaponMount;
  cd: number;
  angle: number; // turret angle relative to ship
  beamOn: boolean;
  beamLen: number;
  beamHitX: number;
  beamHitY: number;
  drones: number;
  wantFire: boolean;
}

let nextShipId = 1;

export class Ship {
  id = nextShipId++;
  design: ShipDesign;
  stats: ShipStats;
  base: ShipStats;
  faction: number;
  name: string;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  angle = 0;
  hp: Float32Array;
  maxHp: Float32Array;
  alive: boolean[];
  grid: Int16Array;
  shield = 0;
  energy = 0;
  ammo: Record<AmmoType, number>;
  weapons: WeaponState[] = [];
  ai: AIController | null = null;
  isPlayer = false;
  fleetId = -1;
  fleetIndex = -1;
  fleetRef: { hp: number } | null = null;
  ambient = false;
  wasHostileToPlayer = false;
  role = '';
  target: Ship | null = null;
  dead = false;
  removed = false;
  thrust = 0; // 0..1 visual throttle
  reverse = 0;
  boosting = false;
  cruise = false;
  cloaked = false;
  shieldHit = 0;
  hitFlash = 0;
  dot = 0;
  dotTime = 0;
  lastHitBy = -1;
  lastHitFaction = -1;
  lastHitTime = 0;
  aimX = 0;
  aimY = 0;
  firing = false;
  cargo: { c: number; q: number }[] = [];
  credits = 0;
  bounty = 0;
  tag = '';
  wingmanId = '';
  missionId = '';
  sprite: HTMLCanvasElement | null = null;
  spriteDirty = true;
  totalHp = 0;
  aliveBlocks = 0;
  initialBlocks = 0;
  exhausts: { lx: number; ly: number; size: number }[] = [];
  crewEff = 1;
  dmgMult = 1;
  jumpingOut = 0;
  warpIn = 0;
  scanTimer = 0;
  docked = false;
  invuln = 0;

  constructor(design: ShipDesign, faction: number, name?: string, hpFrac?: number[]) {
    this.design = design;
    this.faction = faction;
    this.name = name ?? design.name;
    this.grid = buildGrid(design);
    this.maxHp = new Float32Array(design.modules.map((m) => MODULE_MAP[m.id]?.hp ?? 10));
    this.hp = new Float32Array(this.maxHp);
    this.alive = design.modules.map(() => true);
    if (hpFrac) hpFrac.forEach((f, i) => {
      if (i < this.hp.length) {
        this.hp[i] = this.maxHp[i] * f;
        if (f <= 0) this.alive[i] = false;
      }
    });
    this.base = computeStats(design);
    this.stats = this.base;
    this.recompute();
    this.shield = this.stats.shieldCap;
    this.energy = this.stats.battery;
    this.ammo = { ...this.stats.ammoCap };
    this.initialBlocks = this.base.blocks;
    this.weapons = this.stats.weapons.map((m) => ({ mount: m, cd: Math.random() * 0.5, angle: m.facing, beamOn: false, beamLen: 0, beamHitX: 0, beamHitY: 0, drones: 0, wantFire: false }));
  }

  get radius(): number {
    return this.stats.radius;
  }

  recompute(): void {
    const prevWeapons = this.weapons;
    this.stats = computeStats(this.design, this.alive);
    this.crewEff = this.stats.crewEff;
    this.totalHp = 0;
    this.aliveBlocks = this.stats.blocks;
    for (let i = 0; i < this.hp.length; i++) if (this.alive[i]) this.totalHp += this.hp[i];
    // keep turret states for surviving weapons
    const byIndex = new Map(prevWeapons.map((w) => [w.mount.index, w]));
    this.weapons = this.stats.weapons.map((m) => byIndex.get(m.index) ?? { mount: m, cd: 0.5, angle: m.facing, beamOn: false, beamLen: 0, beamHitX: 0, beamHitY: 0, drones: 0, wantFire: false });
    for (const w of this.weapons) w.mount = this.stats.weapons.find((m) => m.index === w.mount.index) ?? w.mount;
    this.exhausts = [];
    this.design.modules.forEach((m, i) => {
      if (!this.alive[i]) return;
      const def = MODULE_MAP[m.id];
      if (!def?.thrust || m.r !== 0) return;
      const [, fh] = footprint(def, m.r);
      const nozzles = def.id === 'engine_fusion' ? 3 : 1;
      for (let k = 0; k < nozzles; k++) {
        const gy = m.y + (fh / nozzles) * (k + 0.5) - 0.5;
        const [lx, ly] = this.cellToLocal(m.x, gy);
        this.exhausts.push({ lx: lx - CELL * 0.5, ly, size: (fh / nozzles) * ((def.thrust ?? 0) > 200 ? 1.3 : 0.9) });
      }
    });
    this.spriteDirty = true;
  }

  /** Local (ship space) centre of a grid cell. */
  cellToLocal(gx: number, gy: number): [number, number] {
    return [(gx + 0.5 - this.stats.cx) * CELL, (gy + 0.5 - this.stats.cy) * CELL];
  }

  localToWorld(lx: number, ly: number): [number, number] {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return [this.x + lx * c - ly * s, this.y + lx * s + ly * c];
  }

  worldToCell(wx: number, wy: number): [number, number] {
    const dx = wx - this.x, dy = wy - this.y;
    const c = Math.cos(-this.angle), s = Math.sin(-this.angle);
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    return [Math.floor(lx / CELL + this.stats.cx), Math.floor(ly / CELL + this.stats.cy)];
  }

  /** Module index occupying the world point or -1. */
  moduleAt(wx: number, wy: number): number {
    const [gx, gy] = this.worldToCell(wx, wy);
    if (gx < 0 || gy < 0 || gx >= this.design.w || gy >= this.design.h) return -1;
    const mi = this.grid[gy * this.design.w + gx];
    return mi >= 0 && this.alive[mi] ? mi : -1;
  }

  /** Marches a segment and returns the first alive module hit. */
  raycast(ax: number, ay: number, bx: number, by: number): { mi: number; x: number; y: number } | null {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const mi = this.moduleAt(x, y);
      if (mi >= 0) return { mi, x, y };
    }
    return null;
  }

  weaponWorldPos(w: WeaponState): [number, number] {
    const [lx, ly] = [(w.mount.cx - this.stats.cx) * CELL, (w.mount.cy - this.stats.cy) * CELL];
    return this.localToWorld(lx, ly);
  }

  hpFraction(): number {
    return this.base.hp > 0 ? this.totalHp / this.base.hp : 0;
  }

  hpFracArray(): number[] {
    return Array.from(this.hp, (h, i) => (this.alive[i] ? h / this.maxHp[i] : 0));
  }

  getSprite(): HTMLCanvasElement {
    if (!this.sprite || this.spriteDirty) {
      const damaged = this.alive.some((a) => !a) || this.hp.some((h, i) => h < this.maxHp[i] * 0.999);
      this.sprite = renderShipSprite(this.design, damaged ? { alive: this.alive, hpFrac: this.hpFracArray() } : {});
      this.spriteDirty = false;
    }
    return this.sprite;
  }

  /**
   * Applies damage to a module. Returns info about destroyed modules for effects.
   */
  damageModule(mi: number, amount: number, armorPen: number, beam: boolean, events: DamageEvents): void {
    if (mi < 0 || !this.alive[mi] || this.dead || this.invuln > 0) return;
    const def = MODULE_MAP[this.design.modules[mi].id];
    let dmg = Math.max(amount * 0.25, amount - Math.max(0, def.armor - armorPen));
    if (beam && def.beamResist) dmg *= 1 - def.beamResist;
    this.hp[mi] -= dmg;
    this.totalHp -= Math.min(dmg, this.hp[mi] + dmg);
    this.hitFlash = 0.08;
    if (this.hp[mi] <= 0) this.destroyModule(mi, events);
    else if (this.totalHp < this.base.hp * 0.3) this.kill(events);
    else if (Math.random() < 0.25) this.spriteDirty = true;
  }

  destroyModule(mi: number, events: DamageEvents): void {
    if (!this.alive[mi]) return;
    const m = this.design.modules[mi];
    const def = MODULE_MAP[m.id];
    this.alive[mi] = false;
    this.hp[mi] = 0;
    const [fw, fh] = footprint(def, m.r);
    const [lx, ly] = this.cellToLocal(m.x + fw / 2 - 0.5, m.y + fh / 2 - 0.5);
    const [wx, wy] = this.localToWorld(lx, ly);
    events.blocks.push({ ship: this, x: wx, y: wy, size: Math.max(fw, fh) * CELL, color: this.design.colors[0], def });
    if (def.explosive) {
      events.explosions.push({ x: wx, y: wy, r: def.explosive * 0.9, dmg: def.explosive, owner: this });
      // chain damage to neighbouring blocks
      const rCells = Math.ceil(def.explosive / 60);
      for (let y = m.y - rCells; y < m.y + fh + rCells; y++)
        for (let x = m.x - rCells; x < m.x + fw + rCells; x++) {
          if (x < 0 || y < 0 || x >= this.design.w || y >= this.design.h) continue;
          const o = this.grid[y * this.design.w + x];
          if (o >= 0 && o !== mi && this.alive[o]) {
            this.hp[o] -= def.explosive * 0.5;
            if (this.hp[o] <= 0) this.destroyModule(o, events);
          }
        }
    }
    // Detach any blocks no longer connected to a command module.
    const hasCommand = this.design.modules.some((mm, i) => this.alive[i] && MODULE_MAP[mm.id]?.command);
    let hpLeft = 0;
    for (let i = 0; i < this.hp.length; i++) if (this.alive[i]) hpLeft += Math.max(0, this.hp[i]);
    if (!hasCommand || this.aliveBlocks - fw * fh < this.initialBlocks * 0.45 || hpLeft < this.base.hp * 0.3) {
      this.kill(events);
      return;
    }
    const disc = disconnected(this.design, this.alive);
    for (const d of disc) {
      if (!this.alive[d]) continue;
      this.alive[d] = false;
      const dm = this.design.modules[d];
      const dd = MODULE_MAP[dm.id];
      const [dfw, dfh] = footprint(dd, dm.r);
      const [dlx, dly] = this.cellToLocal(dm.x + dfw / 2 - 0.5, dm.y + dfh / 2 - 0.5);
      const [dwx, dwy] = this.localToWorld(dlx, dly);
      events.blocks.push({ ship: this, x: dwx, y: dwy, size: Math.max(dfw, dfh) * CELL, color: this.design.colors[0], def: dd, detached: true });
    }
    this.recompute();
    this.shield = Math.min(this.shield, this.stats.shieldCap);
    this.energy = Math.min(this.energy, this.stats.battery);
  }

  kill(events: DamageEvents): void {
    if (this.dead) return;
    this.dead = true;
    events.deaths.push(this);
  }

  /** Physics & systems update. Control inputs are set by player or AI beforehand. */
  update(dt: number): void {
    if (this.dead) return;
    const st = this.stats;
    if (this.invuln > 0) this.invuln -= dt;
    // energy
    const drain = st.powerUse + (this.thrust > 0.05 || this.reverse > 0.05 ? st.enginePower * Math.max(this.thrust, this.reverse) : 0) + (this.cloaked ? 8 : 0);
    this.energy = clamp(this.energy + (st.powerGen - drain) * dt, 0, st.battery);
    if (this.energy <= 0 && this.cloaked) this.cloaked = false;
    // shields
    if (st.shieldCap > 0) {
      const regen = this.energy > 1 ? st.shieldRegen * this.crewEff * (this.dmgMult) : st.shieldRegen * 0.2;
      this.shield = Math.min(st.shieldCap, this.shield + regen * dt);
    }
    // repair & regen
    const heal = (st.repair + st.regen) * dt;
    if (heal > 0) {
      let budget = heal * 3;
      for (let i = 0; i < this.hp.length && budget > 0; i++) {
        if (!this.alive[i] || this.hp[i] >= this.maxHp[i]) continue;
        const add = Math.min(budget, this.maxHp[i] - this.hp[i]);
        this.hp[i] += add;
        this.totalHp += add;
        budget -= add;
      }
      if (Math.random() < dt * 0.5) this.spriteDirty = true;
    }
    // acid
    if (this.dotTime > 0) {
      this.dotTime -= dt;
      const alive = this.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
      if (alive.length) {
        const mi = alive[Math.floor(Math.random() * alive.length)];
        this.hp[mi] -= this.dot * dt * 3;
        if (this.hp[mi] <= 0) this.hp[mi] = 1;
      }
    }
    this.shieldHit = Math.max(0, this.shieldHit - dt * 2);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    // thrust
    let maxSpd = st.maxSpeed * (this.boosting ? 1.55 : 1);
    let acc = st.accel * (this.boosting ? 1.8 : 1);
    if (this.cruise) {
      maxSpd = st.maxSpeed * 9;
      acc = st.accel * 6;
    }
    if (this.boosting) this.energy = Math.max(0, this.energy - 6 * dt);
    const fx = Math.cos(this.angle), fy = Math.sin(this.angle);
    if (this.thrust > 0) {
      this.vx += fx * acc * this.thrust * dt;
      this.vy += fy * acc * this.thrust * dt;
    }
    if (this.reverse > 0) {
      const rev = (st.reverse + st.thrust * 0.35) / Math.max(1, st.mass) * 32;
      this.vx -= fx * rev * this.reverse * dt;
      this.vy -= fy * rev * this.reverse * dt;
    }
    // soft drag keeps ships controllable
    const drag = this.thrust > 0.05 ? 0.25 : 0.55;
    this.vx *= 1 - drag * dt;
    this.vy *= 1 - drag * dt;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > maxSpd) {
      const k = maxSpd / sp;
      const blend = Math.min(1, dt * 3);
      this.vx = this.vx * (1 - blend) + this.vx * k * blend;
      this.vy = this.vy * (1 - blend) + this.vy * k * blend;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  turnToward(target: number, dt: number, mult = 1): void {
    const d = wrapAngle(target - this.angle);
    const max = this.stats.turnRate * dt * mult;
    this.angle += Math.abs(d) < max ? d : Math.sign(d) * max;
    this.angle = wrapAngle(this.angle);
  }

  applyDamage(amount: number): void {
    // generic damage (collisions / splash without a position): hit random module
    const idx = this.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return;
    this.hp[idx[Math.floor(Math.random() * idx.length)]] -= amount;
  }

  moduleDef(i: number): ModuleDef {
    return MODULE_MAP[this.design.modules[i].id];
  }

  spriteScale(): number {
    return CELL / PX;
  }
}

export interface DamageEvents {
  blocks: { ship: Ship; x: number; y: number; size: number; color: string; def: ModuleDef; detached?: boolean }[];
  explosions: { x: number; y: number; r: number; dmg: number; owner: Ship }[];
  deaths: Ship[];
}

export function newEvents(): DamageEvents {
  return { blocks: [], explosions: [], deaths: [] };
}
