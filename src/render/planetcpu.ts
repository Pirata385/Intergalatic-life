// CPU sphere renderer: projects an equirectangular texture onto a lit sphere.
// Used for planet sprites in the system view, galaxy previews and as a
// fallback when WebGL is unavailable.
import type { PlanetTexture } from '../gen/planet';

interface Lookup {
  size: number;
  idx: Int32Array; // pixel index inside disc, -1 outside
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  lat: Float32Array;
  lon: Float32Array;
  edge: Float32Array;
}

const lookups = new Map<number, Lookup>();

function getLookup(size: number): Lookup {
  let L = lookups.get(size);
  if (L) return L;
  const n = size * size;
  L = { size, idx: new Int32Array(n), nx: new Float32Array(n), ny: new Float32Array(n), nz: new Float32Array(n), lat: new Float32Array(n), lon: new Float32Array(n), edge: new Float32Array(n) };
  const r = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (x + 0.5 - r) / r, dy = (y + 0.5 - r) / r;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) { L.idx[i] = -1; continue; }
      const dz = Math.sqrt(1 - d2);
      L.idx[i] = i;
      L.nx[i] = dx; L.ny[i] = dy; L.nz[i] = dz;
      L.lat[i] = Math.asin(-dy);
      L.lon[i] = Math.atan2(dx, dz);
      L.edge[i] = Math.sqrt(d2);
    }
  lookups.set(size, L);
  return L;
}

export interface SphereOpts {
  rotation: number; // radians of spin
  lightX: number; // light direction (screen space, normalised)
  lightY: number;
  lightZ: number;
  atmo?: [number, number, number];
  atmoStrength?: number;
  cloudRot?: number;
  ambient?: number;
  emissive?: boolean;
}

export function renderSphere(tex: PlanetTexture, size: number, o: SphereOpts, out?: HTMLCanvasElement): HTMLCanvasElement {
  const pad = Math.ceil(size * 0.12);
  const full = size + pad * 2;
  const c = out ?? document.createElement('canvas');
  if (c.width !== full) { c.width = full; c.height = full; }
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const data = img.data;
  const L = getLookup(size);
  const { w, h, color, clouds, emissive } = tex;
  const TAU = Math.PI * 2;
  const amb = o.ambient ?? 0.04;
  const atmo = o.atmo ?? tex.pal.atmo;
  const atmoS = o.atmoStrength ?? tex.pal.atmoStrength;
  const cr = o.cloudRot ?? o.rotation * 1.3;
  const n = size * size;
  for (let i = 0; i < n; i++) {
    if (L.idx[i] < 0) continue;
    const nx = L.nx[i], ny = L.ny[i], nz = L.nz[i];
    let lon = L.lon[i] + o.rotation;
    lon = ((lon % TAU) + TAU) % TAU;
    const u = Math.floor((lon / TAU) * w) % w;
    const v = Math.min(h - 1, Math.floor(((L.lat[i] + Math.PI / 2) / Math.PI) * h));
    const ti = (v * w + u) * 4;
    let r = color[ti], gg = color[ti + 1], b = color[ti + 2];
    if (clouds) {
      let lc = L.lon[i] + cr;
      lc = ((lc % TAU) + TAU) % TAU;
      const cu = Math.floor((lc / TAU) * w) % w;
      const ci = (v * w + cu) * 4;
      const a = clouds[ci + 3] / 255;
      r += (clouds[ci] - r) * a; gg += (clouds[ci + 1] - gg) * a; b += (clouds[ci + 2] - b) * a;
    }
    const lambert = nx * o.lightX + ny * o.lightY + nz * o.lightZ;
    const lit = Math.max(0, Math.min(1, lambert * 1.15 + 0.08));
    const light = amb + lit * (1 - amb);
    r *= light; gg *= light; b *= light;
    if (emissive && o.emissive !== false) {
      const night = 1 - Math.max(0, Math.min(1, lambert * 3 + 0.3));
      const e = emissive[ti + 3] / 255;
      if (e > 0) {
        const k = e * (night * 0.9 + 0.1);
        r += emissive[ti] * k; gg += emissive[ti + 1] * k; b += emissive[ti + 2] * k;
      }
    }
    // atmospheric rim
    const edge = L.edge[i];
    if (atmoS > 0.01) {
      const rim = Math.pow(edge, 6) * atmoS * Math.max(0.05, Math.min(1, lambert + 0.5));
      r += (atmo[0] - r) * rim; gg += (atmo[1] - gg) * rim; b += (atmo[2] - b) * rim;
    }
    const o4 = i * 4;
    data[o4] = r; data[o4 + 1] = gg; data[o4 + 2] = b;
    data[o4 + 3] = edge > 0.985 ? 255 * (1 - (edge - 0.985) / 0.015) : 255;
  }
  g.clearRect(0, 0, full, full);
  // outer atmosphere glow
  if (atmoS > 0.05) {
    const cx = full / 2;
    const grd = g.createRadialGradient(cx, cx, size / 2 * 0.95, cx, cx, size / 2 + pad);
    grd.addColorStop(0, `rgba(${atmo[0] | 0},${atmo[1] | 0},${atmo[2] | 0},${(0.45 * atmoS).toFixed(3)})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, full, full);
  }
  const tmp = scratch(size);
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  g.drawImage(tmp, pad, pad);
  return c;
}

const scratchMap = new Map<number, HTMLCanvasElement>();
function scratch(size: number): HTMLCanvasElement {
  let c = scratchMap.get(size);
  if (!c) {
    c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    scratchMap.set(size, c);
  }
  return c;
}

/** Rings for gas giants, drawn as a tilted ellipse band (back half & front half). */
export function drawRings(g: CanvasRenderingContext2D, x: number, y: number, r: number, tilt: number, color: string, front: boolean, angle = -0.35): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(1, tilt * 0.45);
  g.beginPath();
  if (front) g.arc(0, 0, r * 2.1, 0, Math.PI);
  else g.arc(0, 0, r * 2.1, Math.PI, Math.PI * 2);
  g.lineWidth = r * 0.55;
  g.strokeStyle = color;
  g.globalAlpha = 0.45;
  g.stroke();
  g.lineWidth = r * 0.12;
  g.globalAlpha = 0.6;
  g.beginPath();
  if (front) g.arc(0, 0, r * 1.75, 0, Math.PI);
  else g.arc(0, 0, r * 1.75, Math.PI, Math.PI * 2);
  g.stroke();
  g.restore();
}
