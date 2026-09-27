// Procedural pixel-art rendering of voxel ship designs.
import { MODULE_MAP, ModuleDef } from '../data/modules';
import { shade } from '../core/math';
import type { ShipDesign, PlacedModule } from './design';
import { footprint } from './design';

export const PX = 12; // sprite pixels per grid cell

type Ctx = CanvasRenderingContext2D;

interface Pal {
  c0: string; // hull
  c1: string; // dark metal
  c2: string; // accent / glow
  light: string;
  dark: string;
  darker: string;
  glass: string;
  species: string;
}

function bevel(g: Ctx, x: number, y: number, w: number, h: number, base: string, b = 1): void {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.fillStyle = shade(base, 0.28);
  g.fillRect(x, y, w, b);
  g.fillRect(x, y, b, h);
  g.fillStyle = shade(base, -0.35);
  g.fillRect(x, y + h - b, w, b);
  g.fillRect(x + w - b, y, b, h);
}

function circle(g: Ctx, x: number, y: number, r: number, fill: string, stroke?: string, lw = 1): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.lineWidth = lw;
    g.strokeStyle = stroke;
    g.stroke();
  }
}

function glowDot(g: Ctx, x: number, y: number, r: number, color: string): void {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.35, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

const SLOPE_VERTS: [number, number][][] = [
  [[0, 0], [0, 1], [1, 1]], // r0 cut top-right
  [[0, 0], [1, 0], [0, 1]], // r1 cut bottom-right
  [[0, 0], [1, 0], [1, 1]], // r2 cut bottom-left
  [[1, 0], [1, 1], [0, 1]], // r3 cut top-left
];

function slope(g: Ctx, x: number, y: number, s: number, r: number, base: string, edge: string): void {
  const v = SLOPE_VERTS[r];
  g.beginPath();
  g.moveTo(x + v[0][0] * s, y + v[0][1] * s);
  g.lineTo(x + v[1][0] * s, y + v[1][1] * s);
  g.lineTo(x + v[2][0] * s, y + v[2][1] * s);
  g.closePath();
  g.fillStyle = base;
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = edge;
  g.stroke();
}

/** Draws a module whose local frame is unrotated w x h cells, centred at origin. */
function drawModuleLocal(g: Ctx, def: ModuleDef, m: PlacedModule, pal: Pal, barrels: boolean): void {
  const w = def.w * PX, h = def.h * PX;
  const x = -w / 2, y = -h / 2;
  const cx = 0, cy = 0;
  const c0 = m.p === 1 ? pal.c1 : m.p === 2 ? pal.c2 : pal.c0;
  const art = def.art;
  const bio = art.startsWith('bio_'), crys = art.startsWith('crys_'), mech = art.startsWith('mech_');

  const turretBase = (r: number, color = pal.c1) => {
    bevel(g, x + 1, y + 1, w - 2, h - 2, shade(c0, -0.1));
    circle(g, cx, cy, r, color, shade(color, 0.4), 1);
    circle(g, cx, cy, r * 0.45, shade(color, -0.3));
  };
  const barrel = (len: number, thick: number, color = '#b8c0cc', n = 1, gap = 3) => {
    if (!barrels) return;
    for (let i = 0; i < n; i++) {
      const oy = (i - (n - 1) / 2) * gap;
      g.fillStyle = color;
      g.fillRect(cx, cy + oy - thick / 2, len, thick);
      g.fillStyle = shade(color, -0.4);
      g.fillRect(cx + len - 2, cy + oy - thick / 2, 2, thick);
    }
  };

  if (bio) {
    // organic blobby modules
    const base = def.cat === 'armor' ? pal.c0 : pal.c1;
    g.fillStyle = shade(base, -0.2);
    g.beginPath();
    if (def.shape === 'slope') {
      const v = SLOPE_VERTS[0];
      g.moveTo(x + v[0][0] * w, y + v[0][1] * h);
      g.quadraticCurveTo(x + w * 0.6, y + h * 0.4, x + v[2][0] * w, y + v[2][1] * h);
      g.lineTo(x + v[1][0] * w, y + v[1][1] * h);
      g.closePath();
      g.fillStyle = base;
      g.fill();
      return;
    }
    const rr = Math.min(w, h) * 0.45;
    g.roundRect ? g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, rr) : g.rect(x, y, w, h);
    g.fill();
    const grd = g.createRadialGradient(cx - w * 0.15, cy - h * 0.15, 1, cx, cy, Math.max(w, h) * 0.7);
    grd.addColorStop(0, shade(base, 0.35));
    grd.addColorStop(1, shade(base, -0.3));
    g.fillStyle = grd;
    g.fill();
    g.strokeStyle = shade(pal.c2, -0.2);
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x + 2, cy);
    g.bezierCurveTo(x + w * 0.3, y + 2, x + w * 0.6, y + h - 2, x + w - 2, cy);
    g.stroke();
    if (art === 'bio_heart' || art === 'bio_engine' || art === 'bio_shield' || art === 'bio_launcher') glowDot(g, cx, cy, Math.min(w, h) * 0.35, pal.c2);
    if (art === 'bio_engine') { g.fillStyle = shade(pal.c2, 0.2); g.fillRect(x, cy - 3, 3, 6); }
    if (art === 'bio_gun' || art === 'bio_launcher') { circle(g, cx, cy, Math.min(w, h) * 0.22, shade(pal.c2, -0.3)); barrel(w * 0.45, 3, pal.c2); }
    return;
  }

  if (crys) {
    const base = def.cat === 'armor' ? pal.c0 : pal.c1;
    if (def.shape === 'slope') {
      slope(g, x, y, w, 0, base, shade(pal.c2, 0.2));
      return;
    }
    g.fillStyle = shade(base, -0.25);
    g.fillRect(x, y, w, h);
    g.beginPath();
    g.moveTo(cx, y + 1);
    g.lineTo(x + w - 1, cy);
    g.lineTo(cx, y + h - 1);
    g.lineTo(x + 1, cy);
    g.closePath();
    const grd = g.createLinearGradient(x, y, x + w, y + h);
    grd.addColorStop(0, shade(pal.c2, 0.3));
    grd.addColorStop(0.5, base);
    grd.addColorStop(1, shade(base, -0.4));
    g.fillStyle = grd;
    g.fill();
    g.strokeStyle = shade(pal.c2, 0.5);
    g.lineWidth = 0.7;
    g.stroke();
    if (art !== 'crys_armor') glowDot(g, cx, cy, Math.min(w, h) * 0.3, pal.c2);
    if (art === 'crys_lance') { g.fillStyle = shade(pal.c2, 0.4); g.fillRect(cx, cy - 1.5, w / 2, 3); }
    if (art === 'crys_engine') { g.fillStyle = pal.c2; g.fillRect(x, cy - 4, 2, 8); }
    if (art === 'crys_prism' && barrels) { g.fillStyle = pal.c2; g.fillRect(cx, cy - 1, w * 0.45, 2); }
    return;
  }

  if (mech) {
    const base = def.cat === 'armor' ? pal.c0 : pal.c1;
    if (def.shape === 'slope') {
      slope(g, x, y, w, 0, base, shade(base, 0.3));
      g.fillStyle = pal.c2;
      g.fillRect(x + 2, y + h - 3, 2, 1);
      return;
    }
    bevel(g, x, y, w, h, base, 1);
    g.fillStyle = shade(base, -0.3);
    g.fillRect(x + 2, y + 2, w - 4, h - 4);
    g.fillStyle = shade(base, 0.1);
    g.fillRect(x + 3, y + 3, w - 6, 2);
    if (art === 'mech_armor') { g.fillStyle = pal.c2; g.fillRect(x + w - 4, y + h - 4, 2, 2); return; }
    glowDot(g, cx, cy, Math.min(w, h) * 0.3, pal.c2);
    if (art === 'mech_engine') { g.fillStyle = '#ff6040'; g.fillRect(x, cy - 5, 3, 10); }
    if (art === 'mech_gun') barrel(w * 0.5, 4, '#6a6a72', 2, 5);
    return;
  }

  switch (art) {
    case 'hull':
      bevel(g, x, y, w, h, shade(c0, -0.18));
      g.fillStyle = shade(c0, -0.35);
      g.fillRect(x + 2, y + 2, 1, 1);
      g.fillRect(x + w - 3, y + h - 3, 1, 1);
      break;
    case 'armor':
      bevel(g, x, y, w, h, c0, 1);
      g.fillStyle = shade(c0, -0.12);
      g.fillRect(x + 3, y + 3, w - 6, h - 6);
      break;
    case 'armor_heavy':
      bevel(g, x, y, w, h, shade(c0, -0.08), 2);
      g.strokeStyle = shade(c0, -0.35);
      g.lineWidth = 1;
      g.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
      break;
    case 'armor_reactive':
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) bevel(g, x + i * w / 2, y + j * h / 2, w / 2, h / 2, shade(c0, -0.05 - (i + j) * 0.04), 1);
      break;
    case 'armor_nano':
      bevel(g, x, y, w, h, shade(c0, -0.1), 1);
      g.strokeStyle = shade(pal.c2, -0.2);
      g.lineWidth = 0.6;
      g.beginPath();
      for (let i = 0; i < 3; i++) { g.moveTo(x + 2 + i * 4, y + 2); g.lineTo(x + i * 4, y + h - 2); }
      g.stroke();
      break;
    case 'slope':
      slope(g, x, y, w, 0, c0, shade(c0, 0.3));
      break;
    case 'slope_heavy':
      slope(g, x, y, w, 0, shade(c0, -0.08), shade(c0, 0.35));
      g.fillStyle = shade(c0, -0.3);
      g.fillRect(x + 2, y + h - 4, 3, 2);
      break;
    case 'fin':
      g.beginPath();
      g.moveTo(x, y + h);
      g.lineTo(x + w, y + h);
      g.lineTo(x + 2, y + 1);
      g.closePath();
      g.fillStyle = pal.c2;
      g.fill();
      break;
    case 'cockpit': {
      bevel(g, x, y, w, h, c0, 1);
      g.fillStyle = pal.c1;
      g.fillRect(x + 3, y + 3, w - 6, h - 6);
      const grd = g.createLinearGradient(x, y, x + w, y);
      grd.addColorStop(0, '#20344a');
      grd.addColorStop(1, pal.glass);
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x + w * 0.35, y + 5);
      g.lineTo(x + w - 3, cy - 2);
      g.lineTo(x + w - 3, cy + 2);
      g.lineTo(x + w * 0.35, y + h - 5);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(x + w * 0.5, y + 7, 4, 1);
      break;
    }
    case 'bridge':
    case 'command': {
      bevel(g, x, y, w, h, c0, 2);
      g.fillStyle = pal.c1;
      g.fillRect(x + 4, y + 4, w - 8, h - 8);
      for (let i = 0; i < (art === 'command' ? 4 : 3); i++) {
        g.fillStyle = pal.glass;
        g.fillRect(x + w - 8, y + 6 + i * ((h - 12) / (art === 'command' ? 4 : 3)), 4, 4);
      }
      circle(g, cx - 3, cy, 6, shade(pal.c1, 0.2), shade(c0, 0.3));
      circle(g, cx - 3, cy, 2.5, pal.c2);
      if (art === 'command') { g.strokeStyle = pal.c2; g.lineWidth = 1; g.beginPath(); g.arc(cx - 3, cy, 10, 0, Math.PI * 2); g.stroke(); }
      break;
    }
    case 'thruster':
      bevel(g, x, y, w, h, pal.c1);
      g.fillStyle = '#1a1a1e';
      g.fillRect(x, y + 3, 4, h - 6);
      g.fillStyle = pal.c2;
      g.fillRect(x, y + 4, 1, h - 8);
      break;
    case 'maneuver':
      bevel(g, x + 2, y + 2, w - 4, h - 4, pal.c1);
      g.fillStyle = '#1a1a1e';
      g.fillRect(cx - 1, y, 2, 2); g.fillRect(cx - 1, y + h - 2, 2, 2); g.fillRect(x, cy - 1, 2, 2); g.fillRect(x + w - 2, cy - 1, 2, 2);
      circle(g, cx, cy, 1.5, pal.c2);
      break;
    case 'engine':
    case 'engine_big':
    case 'afterburner': {
      bevel(g, x, y, w, h, pal.c1, 1);
      g.fillStyle = shade(c0, -0.1);
      g.fillRect(x + w * 0.45, y + 2, w * 0.55 - 2, h - 4);
      const nz = art === 'afterburner' ? 1 : def.h > 2 ? 3 : 1;
      for (let i = 0; i < nz; i++) {
        const ny = y + (h / nz) * i;
        const nh = h / nz;
        g.fillStyle = '#18181c';
        g.beginPath();
        g.moveTo(x, ny + 2);
        g.lineTo(x + w * 0.4, ny + nh * 0.25);
        g.lineTo(x + w * 0.4, ny + nh * 0.75);
        g.lineTo(x, ny + nh - 2);
        g.closePath();
        g.fill();
        g.fillStyle = art === 'afterburner' ? '#ff9a40' : pal.c2;
        g.fillRect(x, ny + 4, 2, nh - 8);
      }
      g.fillStyle = shade(pal.c1, 0.3);
      g.fillRect(x + w * 0.5, cy - 1, w * 0.4, 2);
      break;
    }
    case 'reactor_s':
    case 'reactor':
    case 'reactor_l':
    case 'reactor_am': {
      bevel(g, x, y, w, h, pal.c1, art === 'reactor_s' ? 1 : 2);
      const r = Math.min(w, h) * 0.34;
      circle(g, cx, cy, r + 1.5, shade(pal.c1, -0.4), shade(c0, 0.2), 1);
      glowDot(g, cx, cy, r * 1.1, art === 'reactor_am' ? '#ff60ff' : art === 'reactor_l' ? '#80d0ff' : '#ffd060');
      if (art !== 'reactor_s') {
        g.fillStyle = shade(c0, -0.15);
        g.fillRect(x + 2, y + 2, 3, 3); g.fillRect(x + w - 5, y + 2, 3, 3); g.fillRect(x + 2, y + h - 5, 3, 3); g.fillRect(x + w - 5, y + h - 5, 3, 3);
      }
      break;
    }
    case 'battery':
      bevel(g, x, y, w, h, pal.c1);
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i < 3 ? '#60e080' : '#306040';
        g.fillRect(x + 3, y + 3 + i * (h - 6) / 4, w - 6, (h - 6) / 4 - 1);
      }
      break;
    case 'solar':
      bevel(g, x, y, w, h, '#2a3a5a');
      g.strokeStyle = '#6a8ac0';
      g.lineWidth = 0.6;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + (w / 4) * i, y); g.lineTo(x + (w / 4) * i, y + h); g.stroke(); }
      g.beginPath(); g.moveTo(x, cy); g.lineTo(x + w, cy); g.stroke();
      break;
    case 'turret':
      turretBase(PX * 0.34);
      barrel(PX * 0.62, 2.2, '#d0d8e0');
      circle(g, cx, cy, 1.4, '#ff4060');
      break;
    case 'turret_big':
      turretBase(PX * 0.7);
      barrel(PX * 1.1, 3.5, '#d0d8e0', 2, 5);
      circle(g, cx, cy, 2.5, '#ff3080');
      break;
    case 'cannon':
      turretBase(PX * 0.36);
      barrel(PX * 0.6, 3, '#9ac8e0');
      break;
    case 'cannon_big':
      turretBase(PX * 0.72, shade(pal.c1, 0.1));
      barrel(PX * 1.15, 3.5, '#a8c8e8', 2, 6);
      circle(g, cx, cy, 3, '#40c0ff');
      break;
    case 'gun':
      turretBase(PX * 0.34, '#4a4a50');
      barrel(PX * 0.7, 1.6, '#c8b890', 2, 2.6);
      break;
    case 'pd':
      turretBase(PX * 0.3, '#5a5a40');
      barrel(PX * 0.5, 1.4, '#ffff90', 2, 2.4);
      break;
    case 'ion':
      turretBase(PX * 0.7, '#3a3a6a');
      circle(g, cx, cy, 5, '#6060c0', '#a0a0ff', 1.5);
      barrel(PX * 1.1, 4, '#8080ff');
      break;
    case 'railgun':
      bevel(g, x, y, w, h, pal.c1);
      g.fillStyle = '#20242a';
      g.fillRect(x + 2, cy - 2, w - 2, 4);
      g.fillStyle = '#a0e0ff';
      g.fillRect(x + 4, cy - 0.5, w - 6, 1);
      for (let i = 0; i < 5; i++) { g.fillStyle = shade(c0, 0.1); g.fillRect(x + 4 + i * 6, y + 1, 2, h - 2); }
      break;
    case 'lance':
      bevel(g, x, y, w, h, pal.c1, 2);
      g.fillStyle = '#301830';
      g.fillRect(x + 6, cy - 4, w - 6, 8);
      glowDot(g, x + w * 0.4, cy, 8, '#ff80ff');
      g.fillStyle = '#ffb0ff';
      g.fillRect(x + w * 0.4, cy - 1, w * 0.6, 2);
      break;
    case 'launcher':
      bevel(g, x, y, w, h, pal.c1);
      for (let i = 0; i < 4; i++) {
        circle(g, x + 4 + i * ((w - 8) / 3), cy, 2.2, '#1a1a1a', '#ffa040', 0.8);
      }
      break;
    case 'torpedo':
      bevel(g, x, y, w, h, pal.c1, 2);
      for (let i = 0; i < 2; i++) {
        g.fillStyle = '#18181a';
        g.fillRect(x + 4, y + 4 + i * (h / 2 - 2), w - 6, h / 2 - 6);
        g.fillStyle = '#ff6040';
        g.fillRect(x + w - 5, y + 5 + i * (h / 2 - 2), 2, h / 2 - 8);
      }
      break;
    case 'mining':
    case 'mining_big':
      turretBase(art === 'mining' ? PX * 0.32 : PX * 0.65, '#3a5a40');
      circle(g, cx, cy, art === 'mining' ? 1.8 : 3.5, '#70ff90');
      barrel(art === 'mining' ? PX * 0.55 : PX * 1, art === 'mining' ? 2 : 3.5, '#90d0a0');
      break;
    case 'hangar':
      bevel(g, x, y, w, h, pal.c1, 2);
      g.fillStyle = '#101418';
      g.fillRect(x + 4, y + 4, w - 8, h - 8);
      g.fillStyle = '#e0c040';
      for (let i = 0; i < 4; i++) g.fillRect(x + 4 + i * 4, y + 4, 2, 2);
      circle(g, cx, cy, 3, '#80ffc0');
      break;
    case 'shield':
    case 'shield_big':
    case 'shield_cap': {
      bevel(g, x, y, w, h, pal.c1, 1);
      const r = Math.min(w, h) * 0.38;
      circle(g, cx, cy, r, '#1a2a4a', '#60a8ff', 1.5);
      glowDot(g, cx, cy, r * 0.8, '#60a8ff');
      break;
    }
    case 'jump':
    case 'jump2':
    case 'jump3': {
      bevel(g, x, y, w, h, pal.c1, 2);
      const r = Math.min(w, h) * 0.38;
      circle(g, cx, cy, r, '#1a1030', art === 'jump3' ? '#ff80ff' : '#b080ff', 2);
      g.strokeStyle = '#d0b0ff';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, r * 0.55, 0.3, 4.2);
      g.stroke();
      circle(g, cx, cy, 2, '#ffffff');
      break;
    }
    case 'cargo_s':
    case 'cargo':
    case 'cargo_l': {
      bevel(g, x, y, w, h, '#8a8a80', 1);
      g.fillStyle = '#6a6a62';
      g.fillRect(x + 2, y + 2, w - 4, h - 4);
      const n = art === 'cargo_s' ? 1 : art === 'cargo' ? 2 : 3;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const bx = x + 2 + i * ((w - 4) / n), by = y + 2 + j * ((h - 4) / n);
        bevel(g, bx + 1, by + 1, (w - 4) / n - 2, (h - 4) / n - 2, (i + j) % 2 ? '#c8a040' : '#a0a098');
      }
      break;
    }
    case 'fuel':
      bevel(g, x, y, w, h, pal.c1);
      g.fillStyle = '#d0d0c8';
      g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.fillStyle = '#f09020';
      g.fillRect(x + 2, cy - 2, w - 4, 4);
      break;
    case 'crew':
      bevel(g, x, y, w, h, c0, 1);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        g.fillStyle = (i + j) % 3 === 0 ? '#ffe8a0' : '#b8d8ff';
        g.fillRect(x + 4 + i * 6, y + 4 + j * 6, 3, 3);
      }
      break;
    case 'sensor':
      bevel(g, x, y, w, h, pal.c1);
      g.strokeStyle = '#e0e8f0';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx - 2, cy, 4, -1.2, 1.2);
      g.stroke();
      circle(g, cx - 2, cy, 1.2, pal.c2);
      break;
    case 'scanner':
      bevel(g, x, y, w, h, pal.c1);
      for (let i = 0; i < 4; i++) { g.fillStyle = '#60e0d0'; g.fillRect(x + 3 + i * 5, y + 3, 2, h - 6); }
      break;
    case 'tractor':
      bevel(g, x, y, w, h, pal.c1);
      circle(g, cx, cy, 3.5, '#103020', '#60ff90', 1.5);
      break;
    case 'repair':
      bevel(g, x, y, w, h, c0, 1);
      g.fillStyle = '#40d060';
      g.fillRect(cx - 7, cy - 2, 14, 4);
      g.fillRect(cx - 2, cy - 7, 4, 14);
      break;
    case 'magazine':
      bevel(g, x, y, w, h, '#5a5040');
      circle(g, cx, cy, 2.5, '#e04030');
      break;
    case 'cloak':
      bevel(g, x, y, w, h, '#201830', 1);
      glowDot(g, cx, cy, 9, '#8040c0');
      break;
    case 'colony': {
      bevel(g, x, y, w, h, c0, 2);
      const r = Math.min(w, h) * 0.4;
      circle(g, cx, cy, r, '#204030', '#a0ffc0', 2);
      for (let i = 0; i < 6; i++) circle(g, cx + Math.cos(i) * r * 0.5, cy + Math.sin(i * 1.7) * r * 0.5, 1.8, '#60c060');
      break;
    }
    case 'window':
      bevel(g, x, y, w, h, shade(c0, -0.1));
      g.fillStyle = pal.glass;
      g.fillRect(x + 3, y + 3, w - 6, h - 6);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(x + 3, y + 3, w - 6, 1);
      break;
    case 'light':
      bevel(g, x, y, w, h, shade(c0, -0.1));
      glowDot(g, cx, cy, 4, pal.c2);
      break;
    case 'antenna':
      g.fillStyle = shade(c0, -0.2);
      g.fillRect(x + 2, y + h - 4, w - 4, 3);
      g.fillStyle = '#c8d0d8';
      g.fillRect(cx - 0.5, y + 1, 1, h - 4);
      circle(g, cx, y + 2, 1.5, pal.c2);
      break;
    case 'stripe':
      bevel(g, x, y, w, h, pal.c2);
      g.fillStyle = shade(pal.c2, -0.3);
      g.fillRect(x, y + h / 2 - 1, w, 2);
      break;
    case 'vent':
      bevel(g, x, y, w, h, pal.c1);
      for (let i = 0; i < 3; i++) { g.fillStyle = '#ff8030'; g.fillRect(x + 2, y + 3 + i * 3, w - 4, 1); }
      break;
    case 'emblem':
      bevel(g, x, y, w, h, c0, 1);
      circle(g, cx, cy, 8, pal.c1, pal.c2, 1.5);
      g.fillStyle = pal.c2;
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
        g.lineTo(cx + Math.cos(a) * 5, cy + Math.sin(a) * 5);
      }
      g.closePath();
      g.fill();
      break;
    default:
      bevel(g, x, y, w, h, c0);
  }
}

function paletteFor(d: { colors: [string, string, string]; species: string }): Pal {
  return {
    c0: d.colors[0],
    c1: d.colors[1],
    c2: d.colors[2],
    light: shade(d.colors[0], 0.3),
    dark: shade(d.colors[0], -0.3),
    darker: shade(d.colors[0], -0.55),
    glass: '#8ad8ff',
    species: d.species,
  };
}

export function drawPlacedModule(g: Ctx, design: { colors: [string, string, string]; species: string }, m: PlacedModule, barrels = true, px = PX): void {
  const def = MODULE_MAP[m.id];
  if (!def) return;
  const [fw, fh] = footprint(def, m.r);
  const pal = paletteFor(design);
  g.save();
  g.translate((m.x + fw / 2) * px, (m.y + fh / 2) * px);
  g.scale(px / PX, px / PX);
  if (def.shape === 'slope') {
    // slopes: rotation selects which corner is cut, draw unrotated with r variant
    const s = PX;
    const base = m.p === 1 ? pal.c1 : m.p === 2 ? pal.c2 : pal.c0;
    if (def.art === 'fin') {
      g.rotate((m.r * Math.PI) / 2);
      drawModuleLocal(g, def, m, pal, barrels);
    } else if (def.art.startsWith('bio_') || def.art.startsWith('crys_') || def.art.startsWith('mech_')) {
      // alien slopes: rotate the r0 shape
      const rotFor = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      // r0 = cut top-right, r1 = cut bottom-right => rotate 90deg cw maps top-right cut to bottom-right cut
      g.rotate(rotFor[m.r]);
      drawModuleLocal(g, def, m, pal, barrels);
    } else {
      slope(g, -s / 2, -s / 2, s, m.r, def.art === 'slope_heavy' ? shade(base, -0.08) : base, shade(base, 0.32));
    }
  } else {
    g.rotate((m.r * Math.PI) / 2);
    drawModuleLocal(g, def, m, pal, barrels);
  }
  g.restore();
}

export interface SpriteOpts {
  barrels?: boolean;
  alive?: boolean[];
  hpFrac?: number[];
  px?: number;
  outline?: boolean;
}

export function renderShipSprite(d: ShipDesign, opts: SpriteOpts = {}): HTMLCanvasElement {
  const px = opts.px ?? PX;
  const c = document.createElement('canvas');
  c.width = Math.max(1, d.w * px);
  c.height = Math.max(1, d.h * px);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  drawShipInto(g, d, opts);
  return c;
}

export function drawShipInto(g: Ctx, d: ShipDesign, opts: SpriteOpts = {}): void {
  const px = opts.px ?? PX;
  const barrels = opts.barrels ?? false;
  // Order: structural first, then systems so turrets overlay armour seams.
  const order = d.modules.map((m, i) => i).sort((a, b) => {
    const ca = MODULE_MAP[d.modules[a].id]?.cat === 'weapon' ? 1 : 0;
    const cb = MODULE_MAP[d.modules[b].id]?.cat === 'weapon' ? 1 : 0;
    return ca - cb;
  });
  if (opts.outline !== false) {
    // subtle dark outline gives the pixel-art silhouette depth
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.45)';
    for (const i of order) {
      if (opts.alive && !opts.alive[i]) continue;
      const m = d.modules[i];
      const def = MODULE_MAP[m.id];
      if (!def || def.shape === 'slope') continue;
      const [fw, fh] = footprint(def, m.r);
      g.fillRect(m.x * px - 1, m.y * px - 1, fw * px + 2, fh * px + 2);
    }
    g.restore();
  }
  for (const i of order) {
    if (opts.alive && !opts.alive[i]) continue;
    drawPlacedModule(g, d, d.modules[i], barrels, px);
    if (opts.hpFrac && opts.hpFrac[i] < 0.999) {
      const m = d.modules[i];
      const def = MODULE_MAP[m.id];
      const [fw, fh] = footprint(def, m.r);
      const dmg = 1 - opts.hpFrac[i];
      g.fillStyle = `rgba(20,10,5,${(dmg * 0.65).toFixed(2)})`;
      g.fillRect(m.x * px, m.y * px, fw * px, fh * px);
      if (dmg > 0.5) {
        g.fillStyle = 'rgba(255,120,40,0.5)';
        g.fillRect(m.x * px + fw * px * 0.3, m.y * px + fh * px * 0.4, 2, 2);
      }
    }
  }
}

/** Small icon of a single module for UI palettes. */
export function moduleIcon(id: string, size = 40, colors: [string, string, string] = ['#c8782a', '#3a3a44', '#60d0ff']): HTMLCanvasElement {
  const def = MODULE_MAP[id];
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const scale = (size - 6) / (Math.max(def.w, def.h) * PX);
  g.translate(size / 2, size / 2);
  g.scale(scale, scale);
  g.translate((-def.w * PX) / 2, (-def.h * PX) / 2);
  const species = def.species;
  const cols: [string, string, string] =
    species === 'hive' ? ['#6a8a2a', '#3a4a1a', '#d4ff6a'] : species === 'synod' ? ['#6a5aa0', '#3a2a60', '#e8d4ff'] : species === 'automata' ? ['#5a5a62', '#34343a', '#ff4040'] : colors;
  drawPlacedModule(g, { colors: cols, species }, { id, x: 0, y: 0, r: 0 }, true);
  return c;
}
