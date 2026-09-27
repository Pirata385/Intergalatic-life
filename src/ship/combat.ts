// Real-time combat simulation: ships, turrets, projectiles, beams, drones,
// missiles, point defense, loot, asteroids and station defenses.
import { Ship, newEvents, DamageEvents, WeaponState } from './ship';
import { AIController, CombatContext } from './ai';
import { Particles, PType } from '../render/particles';
import { wrapAngle, clamp, dist2, pointSegDist2 } from '../core/math';
import type { WeaponDef } from '../data/modules';
import { MODULE_MAP } from '../data/modules';

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  px: number;
  py: number;
  life: number;
  dmg: number;
  owner: number;
  faction: number;
  kind: WeaponDef['kind'];
  color: string;
  size: number;
  homing: number;
  target: Ship | null;
  splash: number;
  shieldMult: number;
  hullMult: number;
  armorPen: number;
  dot: number;
  hp: number;
  speed: number;
  dead: boolean;
}

export interface Loot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: 'cargo' | 'credits' | 'module' | 'ammo' | 'mission';
  c: number;
  id: string;
  qty: number;
  life: number;
  spin: number;
  color: string;
}

export interface Asteroid {
  x: number;
  y: number;
  r: number;
  kind: 'ore' | 'ice' | 'crys';
  amount: number;
  max: number;
  angle: number;
  spin: number;
  verts: number[];
  orbitR: number;
  orbitA: number;
  orbitSpeed: number;
  mined: number;
  hitT: number;
}

export interface StationEnt {
  id: string;
  x: number;
  y: number;
  r: number;
  faction: number;
  name: string;
  type: 'trade' | 'shipyard' | 'military' | 'pirate' | 'colony' | 'outpost';
  guns: number;
  cd: number;
  orbitBody: string;
  orbitR: number;
  orbitA: number;
  angle: number;
}

export interface Drone {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  owner: Ship;
  faction: number;
  target: Ship | null;
  cd: number;
  hp: number;
  dmg: number;
  color: string;
}

export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  life: number;
}

const HASH = 400;

export class CombatWorld implements CombatContext {
  ships: Ship[] = [];
  projectiles: Projectile[] = [];
  loot: Loot[] = [];
  asteroids: Asteroid[] = [];
  stations: StationEnt[] = [];
  drones: Drone[] = [];
  beams: Beam[] = [];
  particles = new Particles(2600);
  time = 0;
  edge = 20000;
  hostileFn: (a: number, b: number) => boolean;
  aggro = new Map<number, Set<number>>();
  grid = new Map<number, Ship[]>();
  player: Ship | null = null;
  playerDmgMult = 1;
  events: DamageEvents = newEvents();
  onDeath?: (ship: Ship, killer: Ship | null) => void;
  onPickup?: (loot: Loot, ship: Ship) => boolean;
  onMined?: (a: Asteroid, amount: number, by: Ship) => void;
  onJumpOutCb?: (s: Ship) => void;
  onAggro?: (victim: Ship, attacker: Ship) => void;
  onStationHit?: (st: StationEnt, attacker: Ship) => void;
  sfx?: (name: string, x: number, y: number, vol?: number) => void;
  autoAimPlayer = true;

  constructor(hostile: (a: number, b: number) => boolean) {
    this.hostileFn = hostile;
  }

  shipById(id: number): Ship | undefined {
    return this.ships.find((s) => s.id === id);
  }

  add(s: Ship): Ship {
    this.ships.push(s);
    return s;
  }

  isHostile(a: Ship, b: Ship): boolean {
    if (a === b || a.faction === b.faction) return false;
    if (this.hostileFn(a.faction, b.faction)) return true;
    return !!(this.aggro.get(a.id)?.has(b.faction) || this.aggro.get(b.id)?.has(a.faction));
  }

  onJumpOut(s: Ship): void {
    s.removed = true;
    this.particles.add(PType.Glow, s.x, s.y, 0, 0, 0.5, s.radius * 2, '#a0c8ff');
    this.particles.add(PType.Ring, s.x, s.y, 0, 0, 0.6, s.radius * 3, '#80b0ff');
    this.onJumpOutCb?.(s);
  }

  private hashKey(x: number, y: number): number {
    return (Math.floor(x / HASH) + 5000) * 10000 + (Math.floor(y / HASH) + 5000);
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const s of this.ships) {
      if (s.dead || s.removed) continue;
      const r = s.radius;
      const x0 = Math.floor((s.x - r) / HASH), x1 = Math.floor((s.x + r) / HASH);
      const y0 = Math.floor((s.y - r) / HASH), y1 = Math.floor((s.y + r) / HASH);
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++) {
          const k = (gx + 5000) * 10000 + (gy + 5000);
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(s);
        }
    }
  }

  shipsNear(x: number, y: number): Ship[] {
    return this.grid.get(this.hashKey(x, y)) ?? [];
  }

  update(dt: number): void {
    this.time += dt;
    this.events = newEvents();
    this.rebuildGrid();
    for (const s of this.ships) {
      if (s.dead || s.removed) continue;
      if (s.warpIn > 0) {
        s.warpIn -= dt;
        continue;
      }
      if (s.ai) s.ai.update(s, this, dt);
      s.update(dt);
      this.updateWeapons(s, dt);
      this.emitEngine(s);
    }
    this.separate();
    this.updateStations(dt);
    this.updateProjectiles(dt);
    this.updateDrones(dt);
    this.updateBeams(dt);
    this.processEvents();
    this.updateLoot(dt);
    this.updateAsteroids(dt);
    this.particles.update(dt);
    this.ships = this.ships.filter((s) => !s.removed);
  }

  // ------------------------------------------------------------------ weapons
  private updateWeapons(s: Ship, dt: number): void {
    const mult = s.isPlayer || s.faction === 0 ? this.playerDmgMult : 1;
    for (const w of s.weapons) {
      w.cd -= dt * s.crewEff;
      const def = w.mount.def;
      const wd = def.weapon!;
      const [mx, my] = s.weaponWorldPos(w);
      let ax = s.aimX, ay = s.aimY;
      let want = s.firing;
      if (wd.kind === 'pd') {
        const m = this.nearestMissile(s, mx, my, wd.range);
        if (m) { ax = m.x; ay = m.y; want = true; } else want = false;
      } else if (wd.kind === 'mining') {
        const a = this.nearestAsteroid(ax, ay, 400);
        if (a && dist2(mx, my, a.x, a.y) < (wd.range + a.r) ** 2) { ax = a.x; ay = a.y; }
      } else if (wd.kind === 'missile' || wd.kind === 'torpedo' || wd.kind === 'drone') {
        const t = s.target;
        if (t && !t.dead) { ax = t.x; ay = t.y; }
      }
      const desired = Math.atan2(ay - my, ax - mx) - s.angle;
      let rel = wrapAngle(desired);
      const half = wd.arc / 2;
      const off = wrapAngle(rel - w.mount.facing);
      let inArc = true;
      if (wd.arc < Math.PI * 1.95 && Math.abs(off) > half) {
        rel = w.mount.facing + Math.sign(off) * half;
        inArc = false;
      }
      const diff = wrapAngle(rel - w.angle);
      const step = wd.turnRate * dt;
      w.angle = wrapAngle(w.angle + (Math.abs(diff) < step ? diff : Math.sign(diff) * step));
      const aligned = Math.abs(wrapAngle(rel - w.angle)) < 0.12 || wd.kind === 'missile' || wd.kind === 'torpedo' || wd.kind === 'drone';
      const rangeOk = dist2(mx, my, ax, ay) <= (wd.range * 1.05) ** 2;
      w.wantFire = want;
      if (wd.kind === 'beam' || wd.kind === 'mining') {
        const on = want && inArc && aligned && rangeOk && s.energy > wd.energy * dt && !s.cloaked;
        w.beamOn = on;
        if (on) {
          s.energy -= wd.energy * dt;
          this.fireBeam(s, w, mx, my, wd, dt, mult);
        }
        continue;
      }
      if (!want || !inArc || !aligned || w.cd > 0 || s.cloaked) continue;
      if (!rangeOk && wd.kind !== 'missile' && wd.kind !== 'torpedo') continue;
      if (wd.energy > 0 && s.energy < wd.energy) continue;
      if (wd.ammo && s.ammo[wd.ammo] < 1) continue;
      if (wd.kind === 'drone') {
        const mine = this.drones.filter((d) => d.owner === s).length;
        if (mine >= (def.drones ?? 2) * s.weapons.filter((x) => x.mount.def.weapon!.kind === 'drone').length) continue;
        this.drones.push({ x: mx, y: my, vx: s.vx, vy: s.vy, angle: s.angle, owner: s, faction: s.faction, target: s.target, cd: 1, hp: 40, dmg: wd.damage * mult, color: wd.color });
        w.cd = 3;
        continue;
      }
      w.cd = 1 / wd.rof;
      s.energy -= wd.energy;
      if (wd.ammo) s.ammo[wd.ammo] -= 1;
      const count = wd.count ?? 1;
      const worldAng = s.angle + w.angle;
      for (let i = 0; i < count; i++) {
        const a = worldAng + (Math.random() - 0.5) * wd.spread * 2 + (count > 1 ? (i - (count - 1) / 2) * wd.spread : 0);
        const sp = wd.speed;
        this.projectiles.push({
          x: mx, y: my, px: mx, py: my, vx: Math.cos(a) * sp + s.vx * 0.5, vy: Math.sin(a) * sp + s.vy * 0.5,
          life: (wd.range / sp) * (wd.kind === 'missile' || wd.kind === 'torpedo' ? 1.6 : 1.1), dmg: wd.damage * mult, owner: s.id, faction: s.faction,
          kind: wd.kind, color: wd.color, size: wd.size, homing: wd.homing ?? 0, target: s.target, splash: wd.splash ?? 0, shieldMult: wd.shieldMult,
          hullMult: wd.hullMult, armorPen: wd.armorPen, dot: wd.dot ?? 0, hp: wd.kind === 'torpedo' ? 40 : 12, speed: sp, dead: false,
        });
      }
      this.particles.add(PType.Glow, mx, my, s.vx, s.vy, 0.08, wd.size * 2.5, wd.color);
      this.sfx?.(wd.sound, mx, my, s.isPlayer ? 0.5 : 0.25);
    }
  }

  private fireBeam(s: Ship, w: WeaponState, mx: number, my: number, wd: WeaponDef, dt: number, mult: number): void {
    const a = s.angle + w.angle;
    const ex = mx + Math.cos(a) * wd.range, ey = my + Math.sin(a) * wd.range;
    let best: { t: number; x: number; y: number; ship?: Ship; mi?: number; shield?: boolean; ast?: Asteroid } | null = null;
    // ships
    for (const o of this.ships) {
      if (o === s || o.dead || o.removed || o.warpIn > 0) continue;
      if (!this.canHit(s.faction, s, o)) continue;
      const r = o.radius * (o.shield > 1 ? 1.05 : 1);
      if (pointSegDist2(o.x, o.y, mx, my, ex, ey) > r * r) continue;
      const tc = ((o.x - mx) * Math.cos(a) + (o.y - my) * Math.sin(a));
      if (tc < 0) continue;
      if (o.shield > 1) {
        const entry = Math.max(0, tc - Math.sqrt(Math.max(0, r * r - pointSegDist2(o.x, o.y, mx, my, ex, ey))));
        if (!best || entry < best.t) best = { t: entry, x: mx + Math.cos(a) * entry, y: my + Math.sin(a) * entry, ship: o, shield: true };
      } else {
        const start = Math.max(0, tc - o.radius), end = Math.min(wd.range, tc + o.radius);
        const hit = o.raycast(mx + Math.cos(a) * start, my + Math.sin(a) * start, mx + Math.cos(a) * end, my + Math.sin(a) * end);
        if (hit) {
          const t = Math.hypot(hit.x - mx, hit.y - my);
          if (!best || t < best.t) best = { t, x: hit.x, y: hit.y, ship: o, mi: hit.mi };
        }
      }
    }
    for (const as of this.asteroids) {
      if (as.amount <= 0) continue;
      if (pointSegDist2(as.x, as.y, mx, my, ex, ey) > as.r * as.r) continue;
      const tc = (as.x - mx) * Math.cos(a) + (as.y - my) * Math.sin(a);
      if (tc < 0) continue;
      const t = Math.max(0, tc - as.r * 0.7);
      if (!best || t < best.t) best = { t, x: mx + Math.cos(a) * t, y: my + Math.sin(a) * t, ast: as };
    }
    const hx = best ? best.x : ex, hy = best ? best.y : ey;
    w.beamLen = best ? best.t : wd.range;
    w.beamHitX = hx;
    w.beamHitY = hy;
    this.beams.push({ x1: mx, y1: my, x2: hx, y2: hy, color: wd.color, width: wd.kind === 'mining' ? 1.5 : Math.min(5, 1 + wd.damage / 25), life: dt * 1.5 });
    if (!best) return;
    if (Math.random() < dt * 20) this.particles.sparks(hx, hy, 1, wd.color, 80);
    if (best.ast) {
      if (wd.kind === 'mining') {
        const amt = (s.moduleDef(w.mount.index).mining ?? 1) * dt * 1.2;
        best.ast.mined += amt;
        best.ast.hitT = 0.2;
        if (best.ast.mined >= 1) {
          const n = Math.floor(best.ast.mined);
          best.ast.mined -= n;
          best.ast.amount -= n;
          this.onMined?.(best.ast, n, s);
          if (best.ast.amount <= 0) {
            this.particles.explosion(best.ast.x, best.ast.y, best.ast.r * 0.6, '#c0a080');
            this.particles.debris(best.ast.x, best.ast.y, 8, '#6a5a4a', best.ast.r * 0.3);
          }
        }
      }
      return;
    }
    const o = best.ship!;
    const dmg = wd.damage * dt * mult;
    this.registerHit(o, s);
    if (best.shield) {
      o.shield = Math.max(0, o.shield - dmg * wd.shieldMult);
      o.shieldHit = 1;
    } else if (best.mi !== undefined) {
      o.damageModule(best.mi, dmg * wd.hullMult, wd.armorPen, true, this.events);
    }
  }

  private canHit(faction: number, shooter: Ship | null, o: Ship): boolean {
    if (o.faction === faction) return false;
    // Friendly-fire protection: player-side shots pass through neutrals unless deliberately targeted.
    if (shooter && (shooter.isPlayer || shooter.faction === 0)) return o.faction !== 0 && (this.isHostile(shooter, o) || (shooter.isPlayer && shooter.target === o));
    if (shooter) return this.isHostile(shooter, o);
    return this.hostileFn(faction, o.faction);
  }

  private registerHit(victim: Ship, attacker: Ship | null): void {
    if (!attacker) return;
    victim.lastHitBy = attacker.id;
    victim.lastHitFaction = attacker.faction;
    victim.lastHitTime = this.time;
    if (!this.isHostile(victim, attacker)) {
      // Unprovoked attack: victim and nearby allies retaliate.
      for (const s of this.ships) {
        if (s.faction !== victim.faction) continue;
        if (dist2(s.x, s.y, victim.x, victim.y) > 3500 * 3500) continue;
        let set = this.aggro.get(s.id);
        if (!set) this.aggro.set(s.id, (set = new Set()));
        set.add(attacker.faction);
      }
      for (const st of this.stations) if (st.faction === victim.faction) this.stationAggro.add(st.id + ':' + attacker.faction);
      this.onAggro?.(victim, attacker);
    }
  }

  private nearestMissile(s: Ship, x: number, y: number, range: number): Projectile | null {
    let best: Projectile | null = null, bd = range * range;
    for (const p of this.projectiles) {
      if ((p.kind !== 'missile' && p.kind !== 'torpedo') || p.dead) continue;
      if (p.faction === s.faction) continue;
      if (!this.hostileFn(p.faction, s.faction) && !(this.aggro.get(s.id)?.has(p.faction))) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  nearestAsteroid(x: number, y: number, r: number): Asteroid | null {
    let best: Asteroid | null = null, bd = r * r;
    for (const a of this.asteroids) {
      if (a.amount <= 0) continue;
      const d = dist2(x, y, a.x, a.y) - a.r * a.r;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // ------------------------------------------------------------------ projectiles
  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.dead = true;
        if (p.kind === 'missile' || p.kind === 'torpedo') this.particles.explosion(p.x, p.y, p.size * 2, p.color);
        continue;
      }
      if (p.homing > 0) {
        if (!p.target || p.target.dead || p.target.removed || p.target.cloaked) p.target = this.findTargetFor(p);
        if (p.target) {
          const want = Math.atan2(p.target.y - p.y, p.target.x - p.x);
          const cur = Math.atan2(p.vy, p.vx);
          const d = wrapAngle(want - cur);
          const na = cur + clamp(d, -p.homing * dt, p.homing * dt);
          const sp = Math.min(p.speed * 1.2, Math.hypot(p.vx, p.vy) + p.speed * dt);
          p.vx = Math.cos(na) * sp;
          p.vy = Math.sin(na) * sp;
        }
        if (Math.random() < 0.6) this.particles.add(PType.Smoke, p.x, p.y, -p.vx * 0.05, -p.vy * 0.05, 0.5, p.size * 0.8, '#8a8078');
      }
      p.px = p.x;
      p.py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'pd') {
        for (const m of this.projectiles) {
          if (m.dead || (m.kind !== 'missile' && m.kind !== 'torpedo') || m.faction === p.faction) continue;
          if (pointSegDist2(m.x, m.y, p.px, p.py, p.x, p.y) < (m.size + 4) ** 2) {
            m.hp -= p.dmg;
            p.dead = true;
            this.particles.sparks(m.x, m.y, 4, '#ffff80');
            if (m.hp <= 0) {
              m.dead = true;
              this.particles.explosion(m.x, m.y, m.size * 1.5, '#ffc060');
            }
            break;
          }
        }
        if (p.dead) continue;
      }
      // Ships
      const cands = this.shipsNear(p.x, p.y);
      for (const o of cands) {
        if (o.dead || o.removed || o.id === p.owner || o.warpIn > 0) continue;
        const shooter = this.shipById(p.owner) ?? null;
        if (!this.canHit(p.faction, shooter, o)) continue;
        const sr = o.radius * 1.05;
        if (pointSegDist2(o.x, o.y, p.px, p.py, p.x, p.y) > sr * sr) continue;
        if (o.shield > 1 && p.kind !== 'pd') {
          const absorb = p.dmg * p.shieldMult;
          this.registerHit(o, shooter);
          o.shieldHit = 1;
          p.dead = true;
          this.particles.sparks(p.x, p.y, 3, '#80c0ff', 90);
          if (o.shield >= absorb) {
            o.shield -= absorb;
            if (p.splash) this.particles.explosion(p.x, p.y, p.splash * 0.3, p.color);
            break;
          }
          const rem = (absorb - o.shield) / Math.max(0.1, p.shieldMult);
          o.shield = 0;
          const mi = o.raycast(p.px, p.py, p.x + p.vx * 0.05, p.y + p.vy * 0.05);
          if (mi) o.damageModule(mi.mi, rem * p.hullMult, p.armorPen, false, this.events);
          break;
        }
        const hit = o.raycast(p.px, p.py, p.x, p.y);
        if (!hit) continue;
        p.dead = true;
        this.registerHit(o, shooter);
        o.damageModule(hit.mi, p.dmg * p.hullMult, p.armorPen, false, this.events);
        if (p.dot) {
          o.dot = Math.max(o.dot, p.dot);
          o.dotTime = 3;
        }
        this.particles.sparks(hit.x, hit.y, 4, p.color, 110);
        this.sfx?.('hit', hit.x, hit.y, 0.2);
        if (p.splash > 0) {
          this.particles.explosion(hit.x, hit.y, p.splash * 0.5, p.color);
          this.splash(hit.x, hit.y, p.splash, p.dmg * 0.5, o, hit.mi);
        }
        break;
      }
      if (!p.dead && (p.kind === 'projectile' || p.kind === 'pd')) {
        // asteroids block shots
        for (const a of this.asteroids) {
          if (a.amount <= 0) continue;
          if (Math.abs(a.x - p.x) > a.r + 30 || Math.abs(a.y - p.y) > a.r + 30) continue;
          if (dist2(a.x, a.y, p.x, p.y) < a.r * a.r * 0.7) {
            p.dead = true;
            this.particles.sparks(p.x, p.y, 3, '#c8b090', 60);
            break;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  private findTargetFor(p: Projectile): Ship | null {
    let best: Ship | null = null, bd = 1400 * 1400;
    const shooter = this.shipById(p.owner) ?? null;
    for (const o of this.ships) {
      if (o.dead || o.removed || o.cloaked || !this.canHit(p.faction, shooter, o)) continue;
      if (shooter && shooter.isPlayer && !this.isHostile(shooter, o)) continue;
      const d = dist2(o.x, o.y, p.x, p.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  private splash(x: number, y: number, r: number, dmg: number, direct: Ship | null, skip = -1): void {
    for (const o of this.ships) {
      if (o.dead || dist2(o.x, o.y, x, y) > (r + o.radius) ** 2) continue;
      for (let i = 0; i < o.design.modules.length; i++) {
        if (!o.alive[i] || i === skip) continue;
        const m = o.design.modules[i];
        const [lx, ly] = o.cellToLocal(m.x, m.y);
        const [wx, wy] = o.localToWorld(lx, ly);
        const d2 = dist2(wx, wy, x, y);
        if (d2 < r * r) o.damageModule(i, dmg * (1 - Math.sqrt(d2) / r), 0, false, this.events);
      }
      void direct;
    }
  }

  // ------------------------------------------------------------------ drones & beams
  private updateDrones(dt: number): void {
    for (const d of this.drones) {
      if (d.owner.dead || d.owner.removed) d.hp = 0;
      if (d.hp <= 0) continue;
      if (!d.target || d.target.dead || d.target.removed) d.target = d.owner.target && !d.owner.target.dead ? d.owner.target : null;
      const tx = d.target ? d.target.x : d.owner.x + Math.cos(this.time + d.x) * 120;
      const ty = d.target ? d.target.y : d.owner.y + Math.sin(this.time + d.y) * 120;
      const want = Math.atan2(ty - d.y, tx - d.x);
      d.angle += clamp(wrapAngle(want - d.angle), -5 * dt, 5 * dt);
      const orbit = d.target ? 140 : 0;
      const dd = Math.hypot(tx - d.x, ty - d.y);
      const thrust = dd > orbit ? 420 : -100;
      d.vx += Math.cos(d.angle) * thrust * dt;
      d.vy += Math.sin(d.angle) * thrust * dt;
      d.vx *= 1 - 1.2 * dt;
      d.vy *= 1 - 1.2 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.cd -= dt;
      if (d.target && d.cd <= 0 && dd < 380) {
        d.cd = 0.45;
        const a = d.angle + (Math.random() - 0.5) * 0.08;
        this.projectiles.push({ x: d.x, y: d.y, px: d.x, py: d.y, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, life: 0.5, dmg: d.dmg, owner: d.owner.id, faction: d.faction,
          kind: 'projectile', color: d.color, size: 2, homing: 0, target: null, splash: 0, shieldMult: 1, hullMult: 1, armorPen: 0, dot: 0, hp: 1, speed: 900, dead: false });
      }
    }
    // Missiles/PD can hit drones too: approximate by projectiles aimed near them
    for (const p of this.projectiles) {
      if (p.dead || p.kind === 'missile' || p.kind === 'torpedo') continue;
      for (const d of this.drones) {
        if (d.hp <= 0 || d.faction === p.faction || !this.hostileFn(p.faction, d.faction)) continue;
        if (dist2(p.x, p.y, d.x, d.y) < 100) {
          d.hp -= p.dmg;
          p.dead = true;
          if (d.hp <= 0) this.particles.explosion(d.x, d.y, 10, d.color);
          break;
        }
      }
    }
    this.drones = this.drones.filter((d) => d.hp > 0);
  }

  private updateBeams(dt: number): void {
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
  }

  // ------------------------------------------------------------------ stations
  private updateStations(dt: number): void {
    for (const st of this.stations) {
      st.cd -= dt;
      if (st.cd > 0 || st.guns <= 0) continue;
      let best: Ship | null = null, bd = 900 * 900;
      for (const o of this.ships) {
        if (o.dead || o.removed || o.cloaked) continue;
        const hostile = this.hostileFn(st.faction, o.faction) || this.stationAggro.has(st.id + ':' + o.faction);
        if (!hostile) continue;
        const d = dist2(o.x, o.y, st.x, st.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) continue;
      st.cd = 0.6;
      const a = Math.atan2(best.y - st.y, best.x - st.x) + (Math.random() - 0.5) * 0.06;
      const sx = st.x + Math.cos(a) * st.r * 0.8, sy = st.y + Math.sin(a) * st.r * 0.8;
      this.projectiles.push({ x: sx, y: sy, px: sx, py: sy, vx: Math.cos(a) * 1100, vy: Math.sin(a) * 1100, life: 1, dmg: st.guns, owner: -1, faction: st.faction,
        kind: 'projectile', color: '#ffe060', size: 3, homing: 0, target: null, splash: 0, shieldMult: 1, hullMult: 1, armorPen: 2, dot: 0, hp: 1, speed: 1100, dead: false });
    }
  }

  stationAggro = new Set<string>();

  // ------------------------------------------------------------------ events
  private processEvents(): void {
    const ev = this.events;
    for (const b of ev.blocks) {
      this.particles.debris(b.x, b.y, b.detached ? 3 : 2, b.color, b.size * 0.8);
      this.particles.sparks(b.x, b.y, 5, '#ffb060', 150);
      if (b.detached) this.particles.add(PType.Debris, b.x, b.y, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 6, b.size, b.color);
    }
    for (const e of ev.explosions) {
      this.particles.explosion(e.x, e.y, e.r * 0.5, '#ffa040');
      this.sfx?.('explode', e.x, e.y, 0.5);
      this.splash(e.x, e.y, e.r, e.dmg * 0.5, null);
    }
    for (const s of ev.deaths) {
      const killer = s.lastHitBy >= 0 ? this.shipById(s.lastHitBy) ?? null : null;
      this.particles.explosion(s.x, s.y, s.radius * 1.2, '#ffb050');
      this.particles.debris(s.x, s.y, Math.min(30, 6 + s.aliveBlocks / 4), s.design.colors[0], 3);
      this.particles.add(PType.Glow, s.x, s.y, 0, 0, 0.8, s.radius * 4, '#ffe0a0');
      this.sfx?.('bigexplode', s.x, s.y, 0.8);
      this.onDeath?.(s, killer);
      s.removed = true;
    }
  }

  // ------------------------------------------------------------------ loot
  dropLoot(x: number, y: number, kind: Loot['kind'], c: number, id: string, qty: number, color: string): void {
    const a = Math.random() * Math.PI * 2, s = 20 + Math.random() * 50;
    this.loot.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, kind, c, id, qty, life: 120, spin: Math.random() * 6, color });
  }

  private updateLoot(dt: number): void {
    const p = this.player;
    for (const l of this.loot) {
      l.life -= dt;
      l.spin += dt;
      l.vx *= 1 - 0.8 * dt;
      l.vy *= 1 - 0.8 * dt;
      if (p && !p.dead) {
        const d2 = dist2(p.x, p.y, l.x, l.y);
        const tr = p.stats.tractor;
        if (d2 < tr * tr) {
          const d = Math.sqrt(d2) || 1;
          l.vx += ((p.x - l.x) / d) * 500 * dt;
          l.vy += ((p.y - l.y) / d) * 500 * dt;
        }
        if (d2 < (p.radius + 10) ** 2) {
          if (this.onPickup?.(l, p) !== false) l.life = 0;
          else {
            l.vx = (l.x - p.x) * 2;
            l.vy = (l.y - p.y) * 2;
          }
        }
      }
      l.x += l.vx * dt;
      l.y += l.vy * dt;
    }
    this.loot = this.loot.filter((l) => l.life > 0);
  }

  private updateAsteroids(dt: number): void {
    for (const a of this.asteroids) {
      a.angle += a.spin * dt;
      a.orbitA += a.orbitSpeed * dt;
      a.x = Math.cos(a.orbitA) * a.orbitR;
      a.y = Math.sin(a.orbitA) * a.orbitR;
      a.hitT = Math.max(0, a.hitT - dt);
    }
    this.asteroids = this.asteroids.filter((a) => a.amount > 0);
  }

  private emitEngine(s: Ship): void {
    const t = Math.max(s.thrust, s.boosting ? 1 : 0, s.cruise ? 1 : 0);
    if (t < 0.1 || s.exhausts.length === 0) return;
    const color = s.design.species === 'hive' ? '#b0ff60' : s.design.species === 'synod' ? '#d0b0ff' : s.design.species === 'automata' ? '#ff5040' : s.boosting ? '#ffa040' : '#60c0ff';
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    for (let i = 0; i < s.exhausts.length; i++) {
      if (Math.random() > 0.5 * this.particles.quality + 0.2) continue;
      const e = s.exhausts[i];
      const wx = s.x + e.lx * c - e.ly * sn, wy = s.y + e.lx * sn + e.ly * c;
      const sp = 60 + t * 80;
      this.particles.add(PType.Flame, wx, wy, s.vx - c * sp + (Math.random() - 0.5) * 20, s.vy - sn * sp + (Math.random() - 0.5) * 20, 0.18 + t * 0.12, e.size * 2.2 * (0.6 + t * 0.6), color);
    }
  }

  /** Gentle separation so hulls don't overlap. */
  private separate(): void {
    for (const arr of this.grid.values()) {
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const min = (a.radius + b.radius) * 0.55;
          const d2 = dx * dx + dy * dy;
          if (d2 > min * min || d2 < 0.01) continue;
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const ma = a.stats.mass, mb = b.stats.mass;
          const ka = mb / (ma + mb), kb = ma / (ma + mb);
          a.x -= (dx / d) * push * ka;
          a.y -= (dy / d) * push * ka;
          b.x += (dx / d) * push * kb;
          b.y += (dy / d) * push * kb;
        }
    }
  }
}

export function makeAI(mode: ConstructorParameters<typeof AIController>[0], behavior: ConstructorParameters<typeof AIController>[1], x: number, y: number, skill = 0.6): AIController {
  return new AIController(mode, behavior, { x, y }, skill);
}

export { MODULE_MAP };
