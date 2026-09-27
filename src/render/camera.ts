// 2.5D camera: world plane viewed at an angle. The Y axis is compressed by
// `tilt` so orbits become ellipses while spheres stay round.

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  tilt = 0.62;
  vw = 800;
  vh = 600;
  shake = 0;
  sx = 0;
  sy = 0;

  toScreen(x: number, y: number): [number, number] {
    return [(x - this.x) * this.zoom + this.vw / 2 + this.sx, (y - this.y) * this.zoom * this.tilt + this.vh / 2 + this.sy];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.vw / 2 - this.sx) / this.zoom + this.x, (sy - this.vh / 2 - this.sy) / (this.zoom * this.tilt) + this.y];
  }

  visible(x: number, y: number, r: number): boolean {
    const [sx, sy] = this.toScreen(x, y);
    const rr = r * this.zoom;
    return sx > -rr - 50 && sy > -rr - 50 && sx < this.vw + rr + 50 && sy < this.vh + rr + 50;
  }

  updateShake(dt: number): void {
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 25);
      this.sx = (Math.random() - 0.5) * this.shake;
      this.sy = (Math.random() - 0.5) * this.shake;
    } else {
      this.sx = 0;
      this.sy = 0;
    }
  }
}
