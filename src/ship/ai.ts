// Combat and navigation AI for NPC ships in the real-time system view.
import type { Ship } from './ship';
import { wrapAngle, dist, clamp } from '../core/math';

export type AIMode = 'patrol' | 'attack' | 'flee' | 'trade' | 'escort' | 'hold' | 'mine' | 'leave' | 'guard' | 'dummy' | 'wander';
export type AIBehavior = 'normal' | 'swarm' | 'kite' | 'relentless' | 'coward' | 'trader';

export interface Point {
  x: number;
  y: number;
}

export interface CombatContext {
  ships: Ship[];
  time: number;
  edge: number;
  isHostile(a: Ship, b: Ship): boolean;
  stations: { x: number; y: number; faction: number; r: number; id: string }[];
  asteroids: { x: number; y: number; r: number; amount: number }[];
  shipById(id: number): Ship | undefined;
  onJumpOut(s: Ship): void;
}

export class AIController {
  mode: AIMode;
  behavior: AIBehavior;
  home: Point;
  waypoint: Point | null = null;
  leader: Ship | null = null;
  offset: Point = { x: 0, y: 0 };
  retarget = 0;
  strafeDir = Math.random() < 0.5 ? 1 : -1;
  strafeT = 0;
  holdT = 0;
  skill: number;
  fleeAt: number;
  guardRadius = 1800;
  aggressive = true;
  stationTarget: Point | null = null;
  mineTarget: { x: number; y: number; r: number; amount: number } | null = null;
  leaveAfter = -1;

  constructor(mode: AIMode, behavior: AIBehavior, home: Point, skill = 0.6) {
    this.mode = mode;
    this.behavior = behavior;
    this.home = { ...home };
    this.skill = skill;
    this.fleeAt = behavior === 'relentless' || behavior === 'swarm' ? 0 : behavior === 'coward' || behavior === 'trader' ? 0.55 : 0.22;
  }

  update(s: Ship, ctx: CombatContext, dt: number): void {
    s.firing = false;
    s.boosting = false;
    this.retarget -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 3 + Math.random() * 5;
      if (Math.random() < 0.4) this.strafeDir *= -1;
    }
    if (this.leaveAfter > 0 && ctx.time > this.leaveAfter && this.mode !== 'attack') this.mode = 'leave';

    // Acquire targets
    if (this.aggressive && this.retarget <= 0 && this.mode !== 'leave' && this.mode !== 'flee') {
      this.retarget = 0.8 + Math.random() * 0.6;
      const sensor = s.stats.sensor;
      let best: Ship | null = null, bd = 1e12;
      const anchor = this.mode === 'escort' && this.leader && !this.leader.dead ? this.leader : s;
      for (const o of ctx.ships) {
        if (o.dead || o === s || o.cloaked || !ctx.isHostile(s, o)) continue;
        const d = (o.x - anchor.x) ** 2 + (o.y - anchor.y) ** 2;
        const limit = this.mode === 'guard' || this.mode === 'escort' ? Math.min(sensor, this.guardRadius) : sensor;
        if (d > limit * limit) continue;
        let score = d;
        if (this.behavior === 'normal' && o.role === 'trade') score *= 1.5;
        if (o.isPlayer) score *= 0.85;
        if (s.target === o) score *= 0.6;
        if (score < bd) { bd = score; best = o; }
      }
      if (best && (this.mode !== 'trade' || this.behavior !== 'trader')) {
        s.target = best;
        if (this.mode !== 'escort' && this.mode !== 'dummy') this.mode = 'attack';
      } else if (best && this.behavior === 'trader') {
        s.target = best;
        this.mode = 'flee';
      }
    }
    if (s.target && (s.target.dead || s.target.removed)) s.target = null;

    if (this.fleeAt > 0 && s.hpFraction() < this.fleeAt && this.mode !== 'leave') this.mode = 'flee';

    switch (this.mode) {
      case 'attack':
        if (!s.target) { this.mode = this.leader ? 'escort' : this.stationTarget ? 'trade' : 'patrol'; break; }
        this.attack(s, s.target, ctx, dt);
        break;
      case 'flee': {
        const threat = s.target;
        let ax = s.x - (threat?.x ?? this.home.x), ay = s.y - (threat?.y ?? this.home.y);
        const l = Math.hypot(ax, ay) || 1;
        ax /= l; ay /= l;
        this.steer(s, s.x + ax * 2000, s.y + ay * 2000, dt, 0, 1);
        s.boosting = true;
        if (threat && dist(s.x, s.y, threat.x, threat.y) < s.stats.range) { s.aimX = threat.x; s.aimY = threat.y; s.firing = true; }
        if (Math.hypot(s.x, s.y) > ctx.edge * 0.95 || (threat && dist(s.x, s.y, threat.x, threat.y) > 3500)) this.jumpOut(s, ctx, dt);
        break;
      }
      case 'leave': {
        const l = Math.hypot(s.x, s.y) || 1;
        this.steer(s, (s.x / l) * ctx.edge * 1.1, (s.y / l) * ctx.edge * 1.1, dt, 0, 1);
        if (l > ctx.edge * 0.9 || s.jumpingOut > 0) this.jumpOut(s, ctx, dt);
        break;
      }
      case 'escort': {
        const L = this.leader;
        if (!L || L.dead) { this.leader = null; this.mode = 'patrol'; break; }
        if (L.target && !L.target.dead && ctx.isHostile(s, L.target) && dist(L.x, L.y, L.target.x, L.target.y) < 2500) {
          s.target = L.target;
          this.attack(s, L.target, ctx, dt);
          break;
        }
        if (s.target && !s.target.dead && dist(L.x, L.y, s.target.x, s.target.y) < this.guardRadius) {
          this.attack(s, s.target, ctx, dt);
          break;
        }
        const c = Math.cos(L.angle), sn = Math.sin(L.angle);
        const tx = L.x + this.offset.x * c - this.offset.y * sn;
        const ty = L.y + this.offset.x * sn + this.offset.y * c;
        const d = dist(s.x, s.y, tx, ty);
        if (d > 600) s.boosting = true;
        if (L.cruise && d > 300) s.cruise = true; else if (!L.cruise) s.cruise = false;
        this.steer(s, tx, ty, dt, 30, 1, L.angle);
        break;
      }
      case 'trade': {
        const st = this.stationTarget;
        if (!st) { this.mode = 'leave'; break; }
        const d = dist(s.x, s.y, st.x, st.y);
        if (d < 260) {
          this.holdT += dt;
          s.thrust = 0;
          s.reverse = Math.hypot(s.vx, s.vy) > 10 ? 0.6 : 0;
          if (this.holdT > 12 + Math.random() * 10) this.mode = 'leave';
        } else this.steer(s, st.x, st.y, dt, 200, 0.8);
        break;
      }
      case 'mine': {
        if (!this.mineTarget || this.mineTarget.amount <= 0) {
          let best = null as CombatContext['asteroids'][0] | null, bd = 1e12;
          for (const a of ctx.asteroids) {
            if (a.amount <= 0) continue;
            const d = (a.x - s.x) ** 2 + (a.y - s.y) ** 2;
            if (d < bd) { bd = d; best = a; }
          }
          this.mineTarget = best;
          if (!best) { this.mode = 'leave'; break; }
        }
        const a = this.mineTarget!;
        const d = dist(s.x, s.y, a.x, a.y);
        if (d > 220) this.steer(s, a.x, a.y, dt, 180, 0.8);
        else { s.thrust = 0; s.reverse = Math.hypot(s.vx, s.vy) > 8 ? 0.5 : 0; s.turnToward(Math.atan2(a.y - s.y, a.x - s.x), dt); }
        s.aimX = a.x; s.aimY = a.y;
        s.firing = d < 300;
        this.holdT += dt;
        if (this.holdT > 60) this.mode = 'leave';
        break;
      }
      case 'guard':
      case 'hold': {
        const d = dist(s.x, s.y, this.home.x, this.home.y);
        if (d > 300) this.steer(s, this.home.x, this.home.y, dt, 150, 0.7);
        else {
          s.thrust = 0;
          s.reverse = Math.hypot(s.vx, s.vy) > 10 ? 0.4 : 0;
          s.turnToward(s.angle + 0.2, dt, 0.1);
        }
        break;
      }
      case 'dummy': {
        const a = ctx.time * 0.2 + s.id;
        this.steer(s, this.home.x + Math.cos(a) * 300, this.home.y + Math.sin(a) * 300, dt, 50, 0.4);
        if (s.target && !s.target.dead && dist(s.x, s.y, s.target.x, s.target.y) < s.stats.range) {
          s.aimX = s.target.x; s.aimY = s.target.y; s.firing = true;
        }
        break;
      }
      case 'wander':
      case 'patrol':
      default: {
        if (!this.waypoint || dist(s.x, s.y, this.waypoint.x, this.waypoint.y) < 250) {
          const a = Math.random() * Math.PI * 2, r = 400 + Math.random() * 2200;
          this.waypoint = { x: this.home.x + Math.cos(a) * r, y: this.home.y + Math.sin(a) * r };
        }
        this.steer(s, this.waypoint.x, this.waypoint.y, dt, 200, 0.55);
        break;
      }
    }
  }

  private jumpOut(s: Ship, ctx: CombatContext, dt: number): void {
    s.jumpingOut += dt;
    s.boosting = true;
    if (s.jumpingOut > 2) ctx.onJumpOut(s);
  }

  attack(s: Ship, t: Ship, ctx: CombatContext, dt: number): void {
    const range = Math.max(250, s.stats.range);
    const d = dist(s.x, s.y, t.x, t.y);
    const want = range * (this.behavior === 'kite' ? 0.82 : this.behavior === 'swarm' ? 0.3 : this.behavior === 'relentless' ? 0.5 : 0.62);
    const fixedGuns = s.weapons.some((w) => w.mount.def.weapon!.arc < 1.2);
    // lead target
    const projSpeed = 900;
    const tt = d / projSpeed;
    const err = (1 - this.skill) * 60;
    s.aimX = t.x + t.vx * tt * this.skill + Math.sin(ctx.time * 1.3 + s.id) * err;
    s.aimY = t.y + t.vy * tt * this.skill + Math.cos(ctx.time * 1.1 + s.id) * err;
    s.firing = d < range * 1.05;
    if (d > want * 1.25) {
      this.steer(s, s.aimX, s.aimY, dt, 0, 1);
      if (d > range * 2 && this.behavior !== 'kite') s.boosting = true;
    } else if (this.behavior === 'kite' && d < want * 0.7) {
      // back off while keeping guns on target
      const ax = s.x - t.x, ay = s.y - t.y;
      this.steer(s, s.x + ax, s.y + ay, dt, 0, 1);
    } else {
      // orbit / strafe
      const ang = Math.atan2(s.y - t.y, s.x - t.x) + this.strafeDir * 0.55;
      const ox = t.x + Math.cos(ang) * want, oy = t.y + Math.sin(ang) * want;
      if (fixedGuns) {
        s.turnToward(Math.atan2(s.aimY - s.y, s.aimX - s.x), dt);
        const dd = dist(s.x, s.y, ox, oy);
        s.thrust = dd > 150 ? 0.6 : 0.15;
        s.reverse = 0;
      } else this.steer(s, ox, oy, dt, 60, 0.9);
    }
  }

  /** Point-to steering with arrival braking. */
  steer(s: Ship, tx: number, ty: number, dt: number, arrive: number, throttle: number, finalAngle?: number): void {
    const dx = tx - s.x, dy = ty - s.y;
    const d = Math.hypot(dx, dy);
    const sp = Math.hypot(s.vx, s.vy);
    if (d < arrive) {
      s.thrust = 0;
      s.reverse = sp > 20 ? 0.8 : 0;
      if (finalAngle !== undefined) s.turnToward(finalAngle, dt);
      return;
    }
    const desired = Math.atan2(dy, dx);
    s.turnToward(desired, dt);
    const diff = Math.abs(wrapAngle(desired - s.angle));
    const stopDist = (sp * sp) / (2 * Math.max(20, s.stats.accel)) + arrive;
    if (d < stopDist && sp > 40) {
      s.thrust = 0;
      s.reverse = 0.7;
    } else {
      s.thrust = diff < 0.5 ? throttle : diff < 1.2 ? throttle * 0.35 : 0;
      s.reverse = 0;
    }
    s.thrust = clamp(s.thrust, 0, 1);
  }
}
