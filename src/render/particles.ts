// Pooled particle system (sparks, smoke, flames, debris) with typed arrays.
import { drawGlow } from './glow';

export enum PType {
  Spark = 0,
  Smoke = 1,
  Glow = 2,
  Debris = 3,
  Flame = 4,
  Ring = 5,
}

export class Particles {
  max: number;
  n = 0;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array;
  rot: Float32Array;
  type: Uint8Array;
  color: string[];
  quality = 1;

  constructor(max = 3000) {
    this.max = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.type = new Uint8Array(max);
    this.color = new Array(max).fill('#fff');
  }

  add(type: PType, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string): void {
    if (this.quality < 1 && Math.random() > this.quality && type !== PType.Ring) return;
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max);
    else this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.rot[i] = Math.random() * 6.28;
    this.type[i] = type;
    this.color[i] = color;
  }

  explosion(x: number, y: number, scale: number, color = '#ffb050'): void {
    const n = Math.min(60, 8 + scale * 0.8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = Math.random() * scale * 4 + 20;
      this.add(PType.Spark, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.3 + Math.random() * 0.6, 1 + Math.random() * 2, i % 3 ? color : '#ffffff');
    }
    for (let i = 0; i < n / 3; i++) {
      const a = Math.random() * 6.283, s = Math.random() * scale * 1.2;
      this.add(PType.Smoke, x, y, Math.cos(a) * s, Math.sin(a) * s, 1 + Math.random() * 1.5, scale * (0.4 + Math.random() * 0.5), '#403830');
    }
    this.add(PType.Glow, x, y, 0, 0, 0.35, scale * 2.2, color);
    this.add(PType.Ring, x, y, 0, 0, 0.5, scale * 2.5, color);
  }

  sparks(x: number, y: number, n: number, color: string, speed = 120): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = Math.random() * speed + 20;
      this.add(PType.Spark, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.15 + Math.random() * 0.3, 1 + Math.random(), color);
    }
  }

  debris(x: number, y: number, n: number, color: string, size: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = Math.random() * 60 + 10;
      this.add(PType.Debris, x, y, Math.cos(a) * s, Math.sin(a) * s, 2 + Math.random() * 3, size * (0.3 + Math.random() * 0.5), color);
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
        this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.size[i] = this.size[j]; this.rot[i] = this.rot[j];
        this.type[i] = this.type[j]; this.color[i] = this.color[j];
        continue;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      const t = this.type[i];
      const damp = t === PType.Smoke ? 0.6 : t === PType.Debris ? 0.15 : 1.5;
      this.vx[i] *= 1 - damp * dt;
      this.vy[i] *= 1 - damp * dt;
      if (t === PType.Debris) this.rot[i] += dt * 3;
      i++;
    }
  }

  /**
   * Draws particles. `proj` converts world->screen and returns scale. Uses
   * additive blending for glows.
   */
  draw(g: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number], zoom: number, tilt: number, vw: number, vh: number): void {
    g.save();
    for (let pass = 0; pass < 2; pass++) {
      g.globalCompositeOperation = pass === 0 ? 'source-over' : 'lighter';
      for (let i = 0; i < this.n; i++) {
        const t = this.type[i];
        const additive = t === PType.Spark || t === PType.Glow || t === PType.Flame || t === PType.Ring;
        if ((pass === 1) !== additive) continue;
        const [sx, sy] = toScreen(this.x[i], this.y[i]);
        const s = this.size[i] * zoom;
        if (sx < -s - 20 || sy < -s - 20 || sx > vw + s + 20 || sy > vh + s + 20) continue;
        if (s < 0.35 && t !== PType.Ring && t !== PType.Spark) continue;
        const k = this.life[i] / this.maxLife[i];
        g.globalAlpha = Math.min(1, k * 1.5);
        switch (t) {
          case PType.Spark: {
            g.strokeStyle = this.color[i];
            g.lineWidth = Math.max(1, s * 0.6);
            g.beginPath();
            g.moveTo(sx, sy);
            g.lineTo(sx - this.vx[i] * 0.03 * zoom, sy - this.vy[i] * 0.03 * zoom * tilt);
            g.stroke();
            break;
          }
          case PType.Smoke:
            g.globalAlpha = k * 0.35;
            g.fillStyle = this.color[i];
            g.beginPath();
            g.ellipse(sx, sy, s * (1.6 - k * 0.6), s * (1.6 - k * 0.6) * tilt, 0, 0, 6.283);
            g.fill();
            break;
          case PType.Glow:
          case PType.Flame: {
            const r = Math.max(1, s * (t === PType.Glow ? 1 - k * 0.3 : k));
            drawGlow(g, sx, sy, r, this.color[i]);
            break;
          }
          case PType.Ring:
            g.strokeStyle = this.color[i];
            g.lineWidth = 2 * k + 0.5;
            g.beginPath();
            g.ellipse(sx, sy, s * (1 - k) + 1, (s * (1 - k) + 1) * tilt, 0, 0, 6.283);
            g.stroke();
            break;
          case PType.Debris:
            g.save();
            g.translate(sx, sy);
            g.rotate(this.rot[i]);
            g.fillStyle = this.color[i];
            g.fillRect(-s / 2, -s / 2 * tilt, s, s * tilt);
            g.restore();
            break;
        }
      }
    }
    g.restore();
  }
}
