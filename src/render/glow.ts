// Cached radial glow sprites (much cheaper than per-draw gradients).
const cache = new Map<string, HTMLCanvasElement>();

export function glowSprite(color: string, hot = true): HTMLCanvasElement {
  const key = color + (hot ? '1' : '0');
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hot) grd.addColorStop(0, '#ffffff');
  grd.addColorStop(hot ? 0.3 : 0, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  cache.set(key, c);
  return c;
}

export function drawGlow(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, hot = true): void {
  if (r < 0.5) return;
  g.drawImage(glowSprite(color, hot), x - r, y - r, r * 2, r * 2);
}
