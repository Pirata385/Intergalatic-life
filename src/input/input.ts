// Unified keyboard / mouse / touch input. Pointer coordinates are converted to
// the game container's local frame so forced-orientation rotation works.

interface PointerInfo {
  id: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
  button: number;
  type: string;
  moved: boolean;
}

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  pointers = new Map<number, PointerInfo>();
  mouseX = -1;
  mouseY = -1;
  mouseDown = false;
  rightDown = false;
  wheel = 0;
  taps: { x: number; y: number; button: number }[] = [];
  dragX = 0;
  dragY = 0;
  dragging = false;
  pinch = 1;
  pinchX = 0;
  pinchY = 0;
  lastType: 'mouse' | 'touch' | 'key' = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? 'touch' : 'mouse';
  virtual = { mx: 0, my: 0, active: false, fire: false, boost: false, aimX: 0, aimY: 0, aim: false };
  toLocal: (cx: number, cy: number) => [number, number] = (x, y) => [x, y];
  private pinchDist = 0;

  attach(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e, true));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 60 + 0.5);
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.lastType = 'key';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.rightDown = false;
      this.pointers.clear();
    });
  }

  private onDown(e: PointerEvent): void {
    const [x, y] = this.toLocal(e.clientX, e.clientY);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { id: e.pointerId, x, y, sx: x, sy: y, t: performance.now(), button: e.button, type: e.pointerType, moved: false });
    this.lastType = e.pointerType === 'touch' ? 'touch' : 'mouse';
    if (e.pointerType !== 'touch') {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.rightDown = true;
    }
    this.mouseX = x;
    this.mouseY = y;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  private onMove(e: PointerEvent): void {
    const [x, y] = this.toLocal(e.clientX, e.clientY);
    const p = this.pointers.get(e.pointerId);
    if (e.pointerType !== 'touch') {
      this.mouseX = x;
      this.mouseY = y;
    }
    if (!p) return;
    const dx = x - p.x, dy = y - p.y;
    p.x = x;
    p.y = y;
    if (Math.hypot(x - p.sx, y - p.sy) > 9) p.moved = true;
    if (this.pointers.size === 1 && p.moved) {
      this.dragX += dx;
      this.dragY += dy;
      this.dragging = true;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) this.pinch *= d / this.pinchDist;
      this.pinchDist = d;
      this.pinchX = (a.x + b.x) / 2;
      this.pinchY = (a.y + b.y) / 2;
      p.moved = true;
    }
  }

  private onUp(e: PointerEvent, cancel = false): void {
    const p = this.pointers.get(e.pointerId);
    if (e.pointerType !== 'touch') {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    }
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (!cancel && !p.moved && performance.now() - p.t < 450 && this.pointers.size === 0) this.taps.push({ x: p.x, y: p.y, button: p.button });
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.pointers.size === 0) this.dragging = false;
  }

  down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  hit(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  endFrame(): void {
    this.pressed.clear();
    this.taps.length = 0;
    this.wheel = 0;
    this.dragX = 0;
    this.dragY = 0;
    this.pinch = 1;
  }
}

export const input = new Input();
