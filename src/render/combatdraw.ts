// Drawing of combat entities in the 2.5D view.
import type { CombatWorld } from '../ship/combat';
import type { Ship } from '../ship/ship';
import type { Camera } from './camera';
import { CELL } from '../ship/design';
import { asteroidSprite } from './sprites';
import { COMMODITIES } from '../data/commodities';
import { drawGlow } from './glow';

export function drawAsteroids(g: CanvasRenderingContext2D, cw: CombatWorld, cam: Camera): void {
  for (const a of cw.asteroids) {
    if (!cam.visible(a.x, a.y, a.r)) continue;
    const [sx, sy] = cam.toScreen(a.x, a.y);
    const s = a.r * cam.zoom * 2.3;
    if (s < 1.2) {
      g.fillStyle = '#6a5a4a';
      g.fillRect(sx, sy, 1, 1);
      continue;
    }
    const spr = asteroidSprite(a.kind, a.verts[0] | 0);
    g.save();
    g.translate(sx, sy);
    g.rotate(a.angle);
    g.scale(1, 0.75 + cam.tilt * 0.25);
    if (a.hitT > 0) g.filter = 'brightness(1.6)';
    g.drawImage(spr, -s / 2, -s / 2, s, s);
    g.restore();
  }
}

export function drawShip(g: CanvasRenderingContext2D, s: Ship, cam: Camera, t: number, highlight = false): void {
  if (!cam.visible(s.x, s.y, s.radius + 20)) return;
  const [sx, sy] = cam.toScreen(s.x, s.y);
  const z = cam.zoom;
  const d = s.design;
  const spr = s.getSprite();
  g.save();
  g.translate(sx, sy);
  g.scale(z, z * cam.tilt);
  g.rotate(s.angle);
  let alpha = 1;
  if (s.cloaked) alpha = s.isPlayer ? 0.35 : 0.08;
  if (s.warpIn > 0) alpha = Math.max(0, 1 - s.warpIn);
  if (s.jumpingOut > 0) alpha = Math.max(0, 1 - s.jumpingOut / 2);
  g.globalAlpha = alpha;
  // soft drop glow under hull for depth
  const ox = -s.stats.cx * CELL, oy = -s.stats.cy * CELL;
  if (z * s.radius > 3) {
    g.drawImage(spr, ox, oy, d.w * CELL, d.h * CELL);
    // turret barrels
    for (const w of s.weapons) {
      const wd = w.mount.def.weapon!;
      if (wd.kind === 'pd' || wd.kind === 'drone') continue;
      const lx = (w.mount.cx - s.stats.cx) * CELL, ly = (w.mount.cy - s.stats.cy) * CELL;
      const big = w.mount.def.w >= 2 && w.mount.def.h >= 2;
      if (wd.arc < 1.2) continue; // spinal mounts are drawn in the sprite
      g.save();
      g.translate(lx, ly);
      g.rotate(w.angle);
      g.fillStyle = s.design.species === 'hive' ? '#a0d050' : s.design.species === 'synod' ? '#d8c0ff' : '#c8d0da';
      const len = big ? CELL * 1.6 : CELL * 0.95;
      const th = big ? CELL * 0.32 : CELL * 0.2;
      if (big) {
        g.fillRect(0, -th * 1.4, len, th);
        g.fillRect(0, th * 0.4, len, th);
      } else g.fillRect(0, -th / 2, len, th);
      g.restore();
    }
    if (s.hitFlash > 0) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = s.hitFlash * 3;
      g.drawImage(spr, ox, oy, d.w * CELL, d.h * CELL);
      g.globalCompositeOperation = 'source-over';
    }
  } else {
    g.fillStyle = d.colors[2];
    g.fillRect(-2 / z, -2 / z, 4 / z, 4 / z);
  }
  g.restore();
  // shield bubble
  if (s.shield > 1 && (s.shieldHit > 0 || highlight)) {
    const a = Math.max(s.shieldHit * 0.5, highlight ? 0.08 : 0);
    const r = s.radius * 1.05 * z;
    const grd = g.createRadialGradient(sx, sy, r * 0.6, sx, sy, r);
    const col = s.design.species === 'hive' ? '150,255,90' : s.design.species === 'synod' ? '200,160,255' : s.design.species === 'automata' ? '255,80,70' : '90,170,255';
    grd.addColorStop(0, `rgba(${col},0)`);
    grd.addColorStop(0.85, `rgba(${col},${(a * 0.5).toFixed(3)})`);
    grd.addColorStop(1, `rgba(${col},${a.toFixed(3)})`);
    g.save();
    g.translate(sx, sy);
    g.scale(1, cam.tilt);
    g.translate(-sx, -sy);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(sx, sy, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  if (s.jumpingOut > 0 || s.warpIn > 0) {
    const k = s.jumpingOut > 0 ? s.jumpingOut / 2 : s.warpIn;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(150,200,255,${(0.6 * k).toFixed(3)})`;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(sx - Math.cos(s.angle) * s.radius * z * 6 * k, sy - Math.sin(s.angle) * s.radius * z * 6 * k * cam.tilt);
    g.lineTo(sx, sy);
    g.stroke();
    g.restore();
  }
  void t;
}

export function drawProjectiles(g: CanvasRenderingContext2D, cw: CombatWorld, cam: Camera): void {
  g.save();
  g.globalCompositeOperation = 'lighter';
  const z = cam.zoom;
  for (const b of cw.beams) {
    const [x1, y1] = cam.toScreen(b.x1, b.y1);
    const [x2, y2] = cam.toScreen(b.x2, b.y2);
    g.strokeStyle = b.color;
    g.globalAlpha = 0.35;
    g.lineWidth = Math.max(2, b.width * z * 2.2);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    g.globalAlpha = 1;
    g.strokeStyle = '#ffffff';
    g.lineWidth = Math.max(1, b.width * z * 0.6);
    g.stroke();
    drawGlow(g, x2, y2, Math.max(3, b.width * z * 3), b.color);
  }
  for (const p of cw.projectiles) {
    if (!cam.visible(p.x, p.y, 20)) continue;
    const [sx, sy] = cam.toScreen(p.x, p.y);
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const dx = p.vx / sp, dy = (p.vy / sp) * cam.tilt;
    if (p.kind === 'missile' || p.kind === 'torpedo') {
      const len = p.size * z * 2.2;
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = '#d8d8d8';
      g.lineWidth = Math.max(1.5, p.size * z * 0.6);
      g.beginPath();
      g.moveTo(sx - dx * len, sy - dy * len);
      g.lineTo(sx + dx * len * 0.5, sy + dy * len * 0.5);
      g.stroke();
      g.globalCompositeOperation = 'lighter';
      drawGlow(g, sx - dx * len, sy - dy * len, Math.max(3, p.size * z * 1.6), p.color);
      continue;
    }
    const len = Math.max(4, Math.min(40, sp * 0.02 * z * (p.kind === 'pd' ? 0.6 : 1)));
    g.strokeStyle = p.color;
    g.lineWidth = Math.max(1.2, p.size * z * 0.9);
    g.globalAlpha = 0.9;
    g.beginPath();
    g.moveTo(sx - dx * len, sy - dy * len);
    g.lineTo(sx, sy);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.fillRect(sx - 1, sy - 1, 2, 2);
  }
  for (const d of cw.drones) {
    if (!cam.visible(d.x, d.y, 20)) continue;
    const [sx, sy] = cam.toScreen(d.x, d.y);
    g.fillStyle = d.color;
    g.globalAlpha = 0.9;
    g.beginPath();
    const s = Math.max(2, 5 * z);
    g.moveTo(sx + Math.cos(d.angle) * s, sy + Math.sin(d.angle) * s * cam.tilt);
    g.lineTo(sx + Math.cos(d.angle + 2.5) * s * 0.7, sy + Math.sin(d.angle + 2.5) * s * 0.7 * cam.tilt);
    g.lineTo(sx + Math.cos(d.angle - 2.5) * s * 0.7, sy + Math.sin(d.angle - 2.5) * s * 0.7 * cam.tilt);
    g.fill();
  }
  g.restore();
}

export function drawLoot(g: CanvasRenderingContext2D, cw: CombatWorld, cam: Camera, t: number): void {
  for (const l of cw.loot) {
    if (!cam.visible(l.x, l.y, 20)) continue;
    const [sx, sy] = cam.toScreen(l.x, l.y);
    const s = Math.max(4, 7 * cam.zoom);
    const pulse = 0.6 + Math.sin(t * 5 + l.spin) * 0.4;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.5 * pulse;
    drawGlow(g, sx, sy, s * 2.5, l.color, false);
    g.restore();
    g.save();
    g.translate(sx, sy);
    g.rotate(l.spin);
    g.fillStyle = l.kind === 'module' ? '#c07aff' : l.kind === 'credits' ? '#ffd040' : l.kind === 'ammo' ? '#ff8040' : l.kind === 'mission' ? '#40ffb0' : '#9aa4b0';
    g.fillRect(-s / 2, -s / 2, s, s);
    g.strokeStyle = l.color;
    g.lineWidth = 1.5;
    g.strokeRect(-s / 2, -s / 2, s, s);
    g.restore();
    if (l.life < 10 && Math.floor(t * 6) % 2 === 0) continue;
  }
}

export function lootLabel(l: { kind: string; c: number; id: string; qty: number }): string {
  if (l.kind === 'cargo') return `${l.qty} ${COMMODITIES[l.c]?.name ?? 'cargo'}`;
  if (l.kind === 'credits') return `${l.qty} credits`;
  if (l.kind === 'module') return `Module: ${l.id}`;
  if (l.kind === 'ammo') return `${l.qty} ${l.id}`;
  return l.id;
}
