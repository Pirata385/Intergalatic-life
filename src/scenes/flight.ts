// Player flight controls: keyboard + mouse, and a virtual joystick with touch
// buttons for mobile. Converts input into ship control signals.
import type { Game } from '../game';
import type { Ship } from '../ship/ship';
import type { Camera } from '../render/camera';
import { input } from '../input/input';
import { h } from '../ui/dom';
import { wrapAngle, dist } from '../core/math';

export interface FlightCallbacks {
  onAction?: () => void;
  onTarget?: () => void;
  onCruise?: () => void;
}

export class FlightControls {
  game: Game;
  root: HTMLElement;
  joy = { active: false, id: -1, cx: 0, cy: 0, dx: 0, dy: 0 };
  fireHeld = false;
  boostHeld = false;
  autoFire = true;
  knob: HTMLElement;
  joyEl: HTMLElement;
  actionBtn: HTMLElement;
  cruiseBtn: HTMLElement;
  autoBtn: HTMLElement;
  cb: FlightCallbacks;

  constructor(game: Game, parent: HTMLElement, cb: FlightCallbacks = {}) {
    this.game = game;
    this.cb = cb;
    this.knob = h('div', { class: 'knob' });
    const side = game.settings.joystickSide;
    this.joyEl = h('div', { class: `joystick ${side === 'right' ? 'right' : ''}` }, this.knob);
    const hold = (el: HTMLElement, set: (v: boolean) => void) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); set(true); el.classList.add('pressed'); el.setPointerCapture?.(e.pointerId); });
      const up = () => { set(false); el.classList.remove('pressed'); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    };
    const fire = h('div', { class: 'tbtn big' }, 'FIRE');
    hold(fire, (v) => (this.fireHeld = v));
    const boost = h('div', { class: 'tbtn' }, 'BOOST');
    hold(boost, (v) => (this.boostHeld = v));
    this.cruiseBtn = h('div', { class: 'tbtn' }, 'CRUISE');
    this.cruiseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); cb.onCruise?.(); });
    this.actionBtn = h('div', { class: 'tbtn', style: 'display:none' }, 'ACT');
    this.actionBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); cb.onAction?.(); });
    const target = h('div', { class: 'tbtn' }, 'TARGET');
    target.addEventListener('pointerdown', (e) => { e.stopPropagation(); cb.onTarget?.(); });
    this.autoBtn = h('div', { class: `tbtn ${this.autoFire ? 'on' : ''}` }, 'AUTO');
    this.autoBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.autoFire = !this.autoFire;
      this.autoBtn.classList.toggle('on', this.autoFire);
    });
    this.root = h('div', { class: `touchbtns ${side === 'right' ? 'left' : ''}` },
      h('div', { class: 'tcol' }, this.autoBtn, target, this.cruiseBtn),
      h('div', { class: 'tcol' }, this.actionBtn, boost, fire));
    parent.append(this.joyEl, this.root);
    this.joyEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const r = this.joyEl.getBoundingClientRect();
      const [lx, ly] = input.toLocal(e.clientX, e.clientY);
      const [cx, cy] = input.toLocal(r.left + r.width / 2, r.top + r.height / 2);
      this.joy = { active: true, id: e.pointerId, cx, cy, dx: lx - cx, dy: ly - cy };
      this.joyEl.setPointerCapture?.(e.pointerId);
      this.updateKnob();
    });
    this.joyEl.addEventListener('pointermove', (e) => {
      if (!this.joy.active || e.pointerId !== this.joy.id) return;
      const [lx, ly] = input.toLocal(e.clientX, e.clientY);
      this.joy.dx = lx - this.joy.cx;
      this.joy.dy = ly - this.joy.cy;
      this.updateKnob();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.active = false;
      this.joy.dx = this.joy.dy = 0;
      this.updateKnob();
    };
    this.joyEl.addEventListener('pointerup', end);
    this.joyEl.addEventListener('pointercancel', end);
  }

  private radius(): number {
    return this.joyEl.clientWidth / 2 || 60;
  }

  private updateKnob(): void {
    const r = this.radius();
    let { dx, dy } = this.joy;
    const l = Math.hypot(dx, dy);
    if (l > r) { dx = (dx / l) * r; dy = (dy / l) * r; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  setAction(label: string | null): void {
    if (!label) this.actionBtn.style.display = 'none';
    else {
      this.actionBtn.style.display = 'flex';
      this.actionBtn.textContent = label.toUpperCase();
    }
  }

  setCruise(on: boolean): void {
    this.cruiseBtn.classList.toggle('on', on);
  }

  /**
   * Applies input to the player ship.
   * autoTarget: returns a ship to aim at when using touch / aim assist.
   */
  apply(s: Ship, cam: Camera, dt: number, autoTarget: () => Ship | null, uiBlocked: boolean): void {
    s.thrust = 0;
    s.reverse = 0;
    s.boosting = false;
    s.firing = false;
    const touch = this.game.isTouch();
    // --- steering
    const kThrust = input.down('KeyW', 'ArrowUp');
    const kRev = input.down('KeyS', 'ArrowDown');
    const kLeft = input.down('KeyA', 'ArrowLeft');
    const kRight = input.down('KeyD', 'ArrowRight');
    if (kThrust) s.thrust = 1;
    if (kRev) s.reverse = 1;
    if (kLeft) s.turnToward(s.angle - 1, dt);
    if (kRight) s.turnToward(s.angle + 1, dt);
    const [mwx, mwy] = cam.toWorld(input.mouseX, input.mouseY);
    if (input.rightDown && !touch) {
      const a = Math.atan2(mwy - s.y, mwx - s.x);
      s.turnToward(a, dt);
      const diff = Math.abs(wrapAngle(a - s.angle));
      s.thrust = Math.max(s.thrust, diff < 0.6 ? 1 : 0.15);
    }
    if (this.joy.active) {
      const r = this.radius();
      const mag = Math.min(1, Math.hypot(this.joy.dx, this.joy.dy) / (r * 0.85));
      if (mag > 0.15) {
        const a = Math.atan2(this.joy.dy / cam.tilt, this.joy.dx);
        s.turnToward(a, dt);
        const diff = Math.abs(wrapAngle(a - s.angle));
        s.thrust = diff < 0.7 ? mag : diff < 1.6 ? mag * 0.25 : 0;
        if (diff > 2.4 && Math.hypot(s.vx, s.vy) > 30) s.reverse = 0.5 * mag;
      }
    }
    s.boosting = input.down('ShiftLeft', 'ShiftRight') || this.boostHeld;
    if (s.boosting && s.energy < 5) s.boosting = false;
    // --- aiming
    const tgt = autoTarget();
    const lead = (t: Ship) => {
      const d = dist(s.x, s.y, t.x, t.y);
      const tt = d / 950;
      return [t.x + (t.vx - s.vx * 0.5) * tt, t.y + (t.vy - s.vy * 0.5) * tt] as [number, number];
    };
    if (touch || input.lastType === 'key') {
      if (tgt) [s.aimX, s.aimY] = lead(tgt);
      else {
        s.aimX = s.x + Math.cos(s.angle) * 500;
        s.aimY = s.y + Math.sin(s.angle) * 500;
      }
    } else {
      s.aimX = mwx;
      s.aimY = mwy;
      if (this.game.settings.aimAssist && tgt) {
        const [tx, ty] = cam.toScreen(tgt.x, tgt.y);
        if (Math.hypot(tx - input.mouseX, ty - input.mouseY) < 90 + tgt.radius * cam.zoom) [s.aimX, s.aimY] = lead(tgt);
      }
    }
    // --- firing
    const mouseFire = !touch && input.mouseDown && !uiBlocked;
    s.firing = mouseFire || input.down('Space') || this.fireHeld;
    if (!s.firing && touch && this.autoFire && tgt && dist(s.x, s.y, tgt.x, tgt.y) < s.stats.range * 1.02) s.firing = true;
  }
}
