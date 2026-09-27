// In-system flight & combat scene. Galaxy fleets present in the system become
// real ships; results are written back to the background simulation.
import type { Game, Scene } from '../game';
import type { World } from '../sim/world';
import type { SystemData, Body } from '../gen/system';
import { bodyPos, allBodies, PLANET_LABEL } from '../gen/system';
import type { SystemState, Fleet, Mission } from '../sim/types';
import { CombatWorld, StationEnt, Loot } from '../ship/combat';
import { Ship } from '../ship/ship';
import { AIController, AIBehavior } from '../ship/ai';
import { Camera } from '../render/camera';
import { drawStar } from '../render/sprites';
import { stationSprite } from '../render/sprites';
import { drawAsteroids, drawShip, drawProjectiles, drawLoot } from '../render/combatdraw';
import { drawRings } from '../render/planetcpu';
import { FlightControls } from './flight';
import { input } from '../input/input';
import { audio } from '../audio/audio';
import { h, clear, openModal, toast, bar, fmtCr, topModal, add } from '../ui/dom';
import { advanceTime, SECONDS_PER_DAY } from '../sim/simulation';
import { RNG, hash } from '../core/rng';
import { dist, dist2, clamp, hexToRgb } from '../core/math';
import { sysDist } from '../gen/galaxy';
import { fuelForJump } from './galaxy';
import { COMMODITIES, C } from '../data/commodities';
import { MODULE_MAP, AmmoType } from '../data/modules';
import { repTier, HOSTILE_REP } from '../data/factions';
import { changeRep, addXp, addMerit, cargoUsed, playerStats } from '../player/player';
import { missionsOnDock, missionsOnEnter, missionsOnScan, missionsOnFleetDestroyed, completeMission, abandonMission } from '../sim/missions';
import { openStation } from '../ui/station';
import { openJournal } from '../ui/journal';
import { openSettings } from '../ui/settingsui';
import { openSaveLoad } from '../ui/saveui';
import { bus } from '../core/events';
import { starterDesign } from '../ship/shipgen';
import { designValue, CELL } from '../ship/design';
import { FleetShip } from '../sim/types';

export interface SystemOpts {
  arrive: 'station' | 'edge' | 'jump' | 'resume' | 'planet';
  docked?: boolean;
  intro?: boolean;
  from?: number;
  jumpTo?: number;
  planetKey?: string;
}

type Sel =
  | { kind: 'ship'; ship: Ship }
  | { kind: 'body'; body: Body }
  | { kind: 'station'; st: StationEnt }
  | { kind: 'object'; obj: MissionObject }
  | null;

interface MissionObject {
  x: number;
  y: number;
  mission: string;
  kind: 'derelict' | 'pod' | 'anomaly' | 'wreck';
  label: string;
  done: boolean;
}

const EDGE = 16000;

export class SystemScene implements Scene {
  name = 'system';
  game: Game;
  w: World;
  sysId: number;
  sys: SystemData;
  st: SystemState;
  cw!: CombatWorld;
  cam = new Camera();
  player!: Ship;
  controls!: FlightControls;
  bodies: Body[];
  bodyXY = new Map<string, { x: number; y: number }>();
  fleetShips = new Map<number, Ship[]>();
  departed = new Map<number, Fleet>();
  sel: Sel = null;
  autopilot: { x: number; y: number; stop: number; label: string } | null = null;
  docked = false;
  dockStation: StationEnt | null = null;
  scan: { body: Body; t: number; dur: number } | null = null;
  jump: { to: number; t: number; dur: number } | null = null;
  objects: MissionObject[] = [];
  defend: { mission: Mission; wave: number; t: number; alive: Ship[] } | null = null;
  escort: Ship | null = null;
  ambientT = 20;
  initialized = false;
  hudT = 0;
  hostileNear = false;
  lastCombat = -99;
  t = 0;
  opts: SystemOpts;
  dead = false;
  planetRot = 0;
  lastTapT = 0;
  // HUD refs
  hudRefs: Record<string, HTMLElement> = {};
  radar!: HTMLCanvasElement;
  actionState: { label: string; fn: () => void }[] = [];
  actionKey = '';

  constructor(game: Game, opts: SystemOpts) {
    this.game = game;
    this.w = game.world!;
    this.opts = opts;
    this.sysId = this.w.player.sys;
    this.sys = this.w.sysData[this.sysId];
    this.st = this.w.systems[this.sysId];
    this.bodies = allBodies(this.sys);
  }

  // ================================================================== lifecycle
  enter(opts?: SystemOpts): void {
    const o = opts ?? this.opts;
    audio.setMood('calm');
    if (!this.initialized) this.init(o);
    else if ((this.game as any).systemNeedsRebuild || this.player.design !== this.w.player.design) {
      (this.game as any).systemNeedsRebuild = false;
      this.cw.stations = [];
      this.makeStations();
      this.rebuildPlayerShip();
      this.syncFleets();
    } else if (this.initialized && o.arrive === 'resume') this.syncFleets();
    this.buildHud();
    this.onResize();
    if (o.docked) {
      const s = this.dockStation ?? this.cw.stations[0];
      if (s) this.dockAt(s);
    }
    if (o.jumpTo !== undefined) this.startJump(o.jumpTo);
    if (o.intro) setTimeout(() => this.intro(), 400);
  }

  exit(): void {
    this.syncAll();
    this.game.hud.innerHTML = '';
  }

  syncBeforeSave(): void {
    this.syncAll();
  }

  onBack(): boolean {
    if (this.docked) return true;
    this.menu();
    return true;
  }

  onResize(): void {
    this.cam.vw = this.game.width;
    this.cam.vh = this.game.height;
    this.cam.tilt = this.game.settings.tilt;
  }

  private init(o: SystemOpts): void {
    this.initialized = true;
    const w = this.w;
    const p = w.player;
    this.st.visited = true;
    if (!p.discovered.includes(this.sysId)) {
      p.discovered.push(this.sysId);
      p.visitedCount++;
      addXp(p, 15);
    }
    this.cw = new CombatWorld((a, b) => w.hostile(a, b));
    this.cw.edge = EDGE;
    this.cw.particles.quality = this.game.settings.quality === 'low' ? 0.35 : this.game.settings.quality === 'medium' ? 0.65 : 1;
    this.cw.sfx = (name, x, y, vol = 0.4) => {
      const d = this.player ? dist(x, y, this.player.x, this.player.y) : 0;
      const v = vol * clamp(1 - d / 2500, 0, 1);
      if (v > 0.02) audio.play(name, v);
    };
    this.cw.onDeath = (s, k) => this.onShipDeath(s, k);
    this.cw.onPickup = (l, s) => this.onPickup(l, s);
    this.cw.onMined = (a, n, by) => {
      if (!by.isPlayer && by.faction !== 0) return;
      const c = a.kind === 'ice' ? C.ice : a.kind === 'crys' ? C.crys : C.ore;
      const bonus = 1 + p.skills.science * 0.1;
      this.cw.dropLoot(a.x, a.y, 'cargo', c, '', Math.max(1, Math.round(n * bonus)), COMMODITIES[c].color);
    };
    this.cw.onAggro = (victim, attacker) => {
      if (attacker.isPlayer || attacker.faction === 0) {
        if (victim.faction > 0 && !victim.wasHostileToPlayer) {
          changeRep(w, victim.faction, -6, 'unprovoked attack');
          victim.wasHostileToPlayer = true;
        }
      }
    };
    this.cw.onJumpOutCb = (s) => {
      if (s === this.escort) this.escort = null;
    };
    this.updateBodies();
    this.makeStations();
    this.makeAsteroids();
    // Player ship
    const alive = p.hp.map((x) => x > 0);
    this.player = new Ship(p.design, 0, p.design.name, p.hp);
    this.player.isPlayer = true;
    this.player.ammo = { ...p.ammo };
    this.player.alive = alive;
    this.player.recompute();
    this.player.dmgMult = 1 + p.skills.engineering * 0.06;
    const ps = playerStats(p, alive);
    this.player.stats.maxSpeed = ps.maxSpeed;
    this.player.stats.accel = ps.accel;
    this.player.stats.turnRate = ps.turnRate;
    this.player.shield = this.player.stats.shieldCap;
    this.cw.player = this.player;
    this.cw.playerDmgMult = (1 + p.skills.gunnery * 0.05) / ((w as any).difficulty ?? 1) ** 0.3;
    this.placePlayer(o);
    this.cw.add(this.player);
    this.cam.x = this.player.x;
    this.cam.y = this.player.y;
    this.cam.zoom = 1.7;
    // NPCs
    this.syncFleets(true);
    this.spawnAmbient(true, o.arrive === 'jump');
    this.spawnWingmen();
    this.spawnMissionStuff();
    missionsOnEnter(w, this.sysId);
    if (o.arrive === 'jump') this.customsScan();
    if (this.st.siege) toast(`${this.sys.name} is under siege by the ${w.factions[this.st.siege.by].name}!`, 'bad', 5000);
    if (this.sys.special === 'derelict') this.objects.push({ x: (new RNG(this.sys.seed)).range(-6000, 6000), y: (new RNG(this.sys.seed + 1)).range(-6000, 6000), mission: '', kind: 'derelict', label: 'Derelict Hulk', done: false });
    if (this.sys.special === 'anomaly') this.objects.push({ x: (new RNG(this.sys.seed + 2)).range(-7000, 7000), y: (new RNG(this.sys.seed + 3)).range(-7000, 7000), mission: '', kind: 'anomaly', label: 'Spatial Anomaly', done: false });
  }

  /** Patrols may scan arriving ships for contraband. */
  private customsScan(): void {
    const w = this.w;
    const p = w.player;
    const owner = this.st.owner;
    if (owner <= 0 || w.factions[owner].kind === 'pirate') return;
    const illegal = p.cargo.map((q, c) => (q > 0 && w.isIllegal(this.sysId, c) ? c : -1)).filter((c) => c >= 0);
    if (!illegal.length) return;
    const rng = new RNG(hash(this.sysId, Math.floor(w.day * 7)));
    if (!rng.chance(this.st.security * 0.55)) {
      setTimeout(() => toast('Customs patrols are active here. Your contraband went unnoticed… this time.', 'info'), 1200);
      return;
    }
    let value = 0;
    for (const c of illegal) {
      value += p.cargo[c] * COMMODITIES[c].base;
      p.cargo[c] = 0;
    }
    const fine = Math.round(value * 0.5);
    const paid = Math.min(p.credits, fine);
    p.credits -= paid;
    if (fine > paid) p.bounty[owner] = (p.bounty[owner] ?? 0) + (fine - paid);
    changeRep(w, owner, -5, 'smuggling');
    setTimeout(() => toast(`Customs scan! Contraband confiscated and ${fmtCr(fine)} fine issued by the ${w.factions[owner].name}.`, 'bad', 5000), 1000);
  }

  private placePlayer(o: SystemOpts): void {
    const p = this.w.player;
    const s = this.player;
    if (o.arrive === 'jump' && o.from !== undefined && o.from >= 0) {
      const from = this.w.sysData[o.from];
      const a = Math.atan2(from.y - this.sys.y, from.x - this.sys.x);
      const r = Math.max(4000, Math.min(EDGE * 0.7, (this.sys.planets[this.sys.planets.length - 1]?.orbit ?? 5000) * 0.8));
      s.x = Math.cos(a) * r;
      s.y = Math.sin(a) * r;
      s.angle = a + Math.PI;
      s.vx = Math.cos(s.angle) * 150;
      s.vy = Math.sin(s.angle) * 150;
      s.warpIn = 0.6;
    } else if ((o.arrive === 'station' || o.docked) && this.cw.stations.length) {
      const st = this.cw.stations[0];
      s.x = st.x + st.r + 80;
      s.y = st.y + 40;
      s.angle = 0;
    } else if (o.arrive === 'planet' && o.planetKey) {
      const b = this.bodies.find((x) => x.key === o.planetKey);
      const pos = b ? this.bodyXY.get(b.key)! : { x: 3000, y: 0 };
      s.x = pos.x + (b?.radius ?? 100) + 150;
      s.y = pos.y;
    } else {
      s.x = p.x || 3000;
      s.y = p.y || 0;
    }
  }

  // ================================================================== world objects
  private updateBodies(): void {
    const day = this.w.day;
    for (const b of this.bodies) this.bodyXY.set(b.key, bodyPos(b, day));
  }

  private makeStations(): void {
    const st = this.st;
    const w = this.w;
    if (!st.station && st.colony < 0) return;
    const owner = st.owner;
    const fac = owner >= 0 ? w.factions[owner] : null;
    const planets = [...this.sys.planets].sort((a, b) => b.habitability - a.habitability);
    const host = planets[0];
    const guns = st.station ? 6 + st.tech * 4 : 0;
    const mk = (type: StationEnt['type'], body: Body | undefined, angle: number, name: string, r: number): StationEnt => ({
      id: `${this.sysId}_${type}`, x: 0, y: 0, r, faction: owner, name, type, guns: type === 'military' ? guns * 2.2 : type === 'colony' ? 0 : guns, cd: 0,
      orbitBody: body?.key ?? '', orbitR: body ? body.radius + 260 : 2200, orbitA: angle, angle: 0,
    });
    if (st.station) {
      const pirate = fac?.kind === 'pirate';
      this.cw.stations.push(mk(pirate ? 'pirate' : 'trade', host, 0.4, `${this.sys.name} ${pirate ? 'Haven' : 'Station'}`, 150));
      if (st.shipyard && !pirate) this.cw.stations.push(mk('shipyard', planets[1] ?? host, 2.4, `${this.sys.name} Shipyards`, 140));
      if (st.military) this.cw.stations.push(mk('military', planets[2] ?? planets[1] ?? host, 4.2, `${fac?.short ?? ''} Naval Base`, 170));
    }
    if (st.colony >= 0) {
      const col = w.colonies.find((c) => c.id === st.colony);
      if (col && col.owner === 0) {
        const b = this.bodies.find((x) => x.key === col.body);
        const s = mk('colony', b, 1.2, `${col.name} Spaceport`, 110);
        s.faction = 0;
        this.cw.stations.push(s);
      }
    }
    this.updateStations(0);
  }

  private updateStations(dt: number): void {
    for (const s of this.cw.stations) {
      s.angle += dt * 0.08;
      s.orbitA += dt * 0.004;
      const b = s.orbitBody ? this.bodyXY.get(s.orbitBody) : null;
      const cx = b ? b.x : 0, cy = b ? b.y : 0;
      s.x = cx + Math.cos(s.orbitA) * s.orbitR;
      s.y = cy + Math.sin(s.orbitA) * s.orbitR;
    }
  }

  private makeAsteroids(): void {
    const rng = new RNG(hash(this.sys.seed, 0xa57));
    for (const belt of this.sys.belts) {
      const n = Math.round(belt.count * (this.game.settings.quality === 'low' ? 0.5 : 1));
      for (let i = 0; i < n; i++) {
        const r = belt.orbit + rng.range(-belt.width / 2, belt.width / 2);
        const a = rng.range(0, Math.PI * 2);
        const kind = belt.kind === 'ice' ? 'ice' : belt.kind === 'crystal' ? (rng.chance(0.5) ? 'crys' : 'ore') : rng.chance(0.08) ? 'crys' : 'ore';
        const size = rng.range(10, 42);
        const amt = Math.round(size * 0.6 * belt.richness) + 2;
        this.cw.asteroids.push({
          x: Math.cos(a) * r, y: Math.sin(a) * r, r: size, kind: kind as any, amount: amt, max: amt, angle: rng.range(0, 6.28), spin: rng.range(-0.4, 0.4),
          verts: [rng.int(0, 7)], orbitR: r, orbitA: a, orbitSpeed: 0.0006 * (5000 / r), mined: 0, hitT: 0,
        });
      }
    }
  }

  // ================================================================== NPC spawning
  private behaviorFor(fid: number, role: string): AIBehavior {
    const f = this.w.factions[fid];
    if (role === 'trade' || role === 'convoy' || role === 'colony' || role === 'mining') return 'trader';
    if (f.species === 'hive') return 'swarm';
    if (f.species === 'synod') return 'kite';
    if (f.species === 'automata') return 'relentless';
    return 'normal';
  }

  private spawnFleetShips(fl: Fleet, arriving: boolean): Ship[] {
    const w = this.w;
    const f = w.factions[fl.faction];
    const rng = new RNG(hash(fl.id, Math.floor(w.day)));
    const main = this.cw.stations[0];
    let cx: number, cy: number;
    if (arriving) {
      const a = rng.range(0, Math.PI * 2);
      cx = Math.cos(a) * EDGE * 0.6;
      cy = Math.sin(a) * EDGE * 0.6;
    } else if (fl.role === 'pirate' || fl.role === 'bounty') {
      const a = rng.range(0, Math.PI * 2), r = rng.range(3000, 9000);
      cx = Math.cos(a) * r;
      cy = Math.sin(a) * r;
    } else if (main) {
      cx = main.x + rng.range(-1500, 1500);
      cy = main.y + rng.range(-1500, 1500);
    } else {
      const a = rng.range(0, Math.PI * 2), r = rng.range(2000, 7000);
      cx = Math.cos(a) * r;
      cy = Math.sin(a) * r;
    }
    const ships: Ship[] = [];
    const behavior = this.behaviorFor(fl.faction, fl.role);
    let leader: Ship | null = null;
    fl.ships.forEach((sh: FleetShip, i) => {
      const d = w.design(fl.faction, sh.cls, sh.v);
      const hpFrac = d.modules.map(() => Math.max(0.2, sh.hp));
      const s = new Ship(d, fl.faction, `${fl.name}${fl.ships.length > 1 ? ' ' + (i + 1) : ''}`, hpFrac);
      s.x = cx + rng.range(-200, 200) + (i % 3) * 90;
      s.y = cy + rng.range(-200, 200) + Math.floor(i / 3) * 90;
      s.angle = rng.range(-Math.PI, Math.PI);
      s.fleetId = fl.id;
      s.fleetRef = sh;
      s.role = fl.role;
      s.missionId = fl.mission;
      if (arriving) s.warpIn = 0.5 + i * 0.15;
      const skill = clamp(0.35 + f.tech * 0.1 + (fl.role === 'war' ? 0.1 : 0), 0.3, 0.95);
      let mode: AIController['mode'] = 'patrol';
      if (fl.role === 'trade' || fl.role === 'convoy' || fl.role === 'colony') mode = main ? 'trade' : 'wander';
      else if (fl.role === 'mining') mode = this.cw.asteroids.length ? 'mine' : 'wander';
      else if (fl.role === 'bounty' || fl.role === 'defense') mode = 'guard';
      else if (fl.role === 'explore') mode = 'wander';
      const ai = new AIController(mode, behavior, { x: cx, y: cy }, skill);
      if (mode === 'trade' && main) ai.stationTarget = main;
      if (fl.role === 'bounty') ai.guardRadius = 2600;
      if (leader && mode !== 'trade' && mode !== 'mine') {
        ai.mode = 'escort';
        ai.leader = leader;
        ai.offset = { x: -120 - (i % 3) * 70, y: (i % 2 ? 1 : -1) * (60 + i * 25) };
      }
      s.ai = ai;
      if (fl.cargo && (fl.role === 'trade' || fl.role === 'convoy')) s.cargo.push({ c: fl.cargo.c, q: Math.round(fl.cargo.q / fl.ships.length) });
      if (!leader) leader = s;
      ships.push(s);
      this.cw.add(s);
    });
    this.fleetShips.set(fl.id, ships);
    return ships;
  }

  /** Reconcile galaxy fleets with ships present in the scene. */
  private syncFleets(initial = false): void {
    const w = this.w;
    const present = w.fleetsAt(this.sysId).filter((f) => f.dest < 0);
    const presentIds = new Set(present.map((f) => f.id));
    for (const [fid, ships] of [...this.fleetShips]) {
      if (presentIds.has(fid)) continue;
      const fl = w.fleets.find((f) => f.id === fid);
      for (const s of ships) {
        if (s.dead || s.removed || !s.ai) continue;
        if (s.ai.mode !== 'attack') s.ai.mode = 'leave';
        else s.ai.leaveAfter = this.cw.time + 20;
      }
      if (fl) this.departed.set(fid, fl);
      this.fleetShips.delete(fid);
    }
    for (const fl of present) {
      if (this.fleetShips.has(fl.id)) continue;
      if (fl.faction === 0) continue;
      this.spawnFleetShips(fl, !initial);
    }
  }

  private writeBack(): void {
    const w = this.w;
    const touched = new Set<Fleet>();
    for (const s of this.cw.ships) {
      if (!s.fleetRef || s.dead) continue;
      s.fleetRef.hp = Math.max(0.05, s.hpFraction());
    }
    for (const fid of [...this.fleetShips.keys(), ...this.departed.keys()]) {
      const fl = w.fleets.find((f) => f.id === fid);
      if (fl) touched.add(fl);
    }
    for (const fl of touched) {
      const before = fl.ships.length;
      fl.ships = fl.ships.filter((s) => s.hp > 0.02);
      if (fl.ships.length < before) w.factions[fl.faction].losses += before - fl.ships.length;
      fl.strength = w.fleetStrength(fl);
      if (!fl.ships.length) {
        w.removeFleet(fl);
        missionsOnFleetDestroyed(w, fl.id);
        this.fleetShips.delete(fl.id);
        this.departed.delete(fl.id);
      }
    }
  }

  private syncAll(): void {
    if (!this.initialized) return;
    this.writeBack();
    const p = this.w.player;
    if (!this.dead && this.player.design === p.design) {
      p.x = this.player.x;
      p.y = this.player.y;
      p.hp = this.player.hpFracArray();
      p.ammo = { ...this.player.ammo };
    }
    for (const wm of p.wingmen) {
      const s = this.cw.ships.find((x) => x.wingmanId === wm.id);
      if (s && !s.dead) wm.hp = s.hpFraction();
    }
    if (this.escort) {
      const m = p.missions.find((x) => x.id === this.escort!.missionId);
      if (m) m.data.hp = this.escort.hpFraction();
    }
  }

  private spawnAmbient(initial: boolean, arrivedByJump: boolean): void {
    const w = this.w;
    const st = this.st;
    const rng = new RNG(hash(this.sysId, Math.floor(w.day * 10), initial ? 1 : 2));
    const main = this.cw.stations[0];
    const ownerF = st.owner > 0 ? w.factions[st.owner] : null;
    if (initial && ownerF && ownerF.kind !== 'pirate' && main) {
      const cops = st.security > 0.6 ? 2 : st.security > 0.3 ? 1 : 0;
      for (let i = 0; i < cops; i++) {
        const s = this.makeNpc(st.owner, rng.pick(['corvette', 'fighter', 'frigate'] as const), main.x + rng.range(-800, 800), main.y + rng.range(-800, 800), 'patrol');
        s.ambient = true;
        s.name = `${ownerF.short} Security`;
      }
      if (this.cw.asteroids.length && rng.chance(0.6)) {
        const a = rng.pick(this.cw.asteroids);
        const s = this.makeNpc(st.owner, 'miner', a.x + 300, a.y, 'mine');
        s.ambient = true;
      }
    }
    // Civilian traffic
    if (main && st.pop > 0 && (initial || rng.chance(0.7))) {
      const fid = st.owner > 0 && ownerF?.kind !== 'pirate' ? st.owner : this.pickNeighborFaction(rng);
      if (fid > 0) {
        const a = rng.range(0, Math.PI * 2);
        const s = this.makeNpc(fid, 'freighter', Math.cos(a) * EDGE * 0.55, Math.sin(a) * EDGE * 0.55, 'trade');
        s.ai!.stationTarget = main;
        s.ambient = true;
        s.warpIn = initial ? 0 : 0.6;
        s.cargo.push({ c: rng.int(0, 15), q: rng.int(10, 40) });
      }
    }
    // Pirate interdiction on arrival
    if (arrivedByJump && initial) {
      const cargoVal = w.player.cargo.reduce((a, q, i) => a + q * COMMODITIES[i].base, 0);
      const chance = (1 - st.security) * 0.28 + Math.min(0.15, cargoVal / 60000) + (st.owner < 0 ? 0.08 : 0);
      if (rng.chance(chance)) {
        const pirates = w.factions.filter((f) => f.kind === 'pirate' && f.alive);
        if (pirates.length) {
          const pf = rng.pick(pirates);
          const n = rng.int(1, 2 + Math.floor(w.player.level / 4));
          const a = Math.atan2(this.player.y, this.player.x) + rng.range(-0.8, 0.8);
          for (let i = 0; i < n; i++) {
            const s = this.makeNpc(pf.id, i === 0 && rng.chance(0.4) ? 'frigate' : rng.pick(['fighter', 'corvette'] as const),
              this.player.x + Math.cos(a) * 1400 + rng.range(-200, 200), this.player.y + Math.sin(a) * 1400 + rng.range(-200, 200), 'attack');
            s.ambient = true;
            s.target = this.player;
            s.warpIn = 1 + i * 0.3;
            s.cargo.push({ c: rng.pick([C.stim, C.arms, C.lux, C.fuel]), q: rng.int(3, 12) });
          }
          setTimeout(() => toast(`⚠ Interdiction! ${pf.name} raiders are closing in.`, 'bad'), 800);
          audio.play('alarm', 0.6);
        }
      }
    }
  }

  private pickNeighborFaction(rng: RNG): number {
    const opts = this.sys.neighbors.slice(0, 6).map((n) => this.w.systems[n].owner).filter((o) => o > 0 && this.w.factions[o].kind !== 'pirate');
    return opts.length ? rng.pick(opts) : -1;
  }

  makeNpc(fid: number, cls: Parameters<World['design']>[1], x: number, y: number, mode: AIController['mode']): Ship {
    const w = this.w;
    const d = w.design(fid, cls, Math.floor(Math.random() * 2));
    const f = w.factions[fid];
    const s = new Ship(d, fid, `${f.short} ${d.name.split(' ').slice(1).join(' ')}`);
    s.x = x;
    s.y = y;
    s.angle = Math.random() * Math.PI * 2;
    s.role = mode === 'trade' ? 'trade' : mode === 'mine' ? 'mining' : 'patrol';
    s.ai = new AIController(mode, this.behaviorFor(fid, s.role), { x, y }, clamp(0.35 + f.tech * 0.1, 0.3, 0.9));
    this.cw.add(s);
    return s;
  }

  private spawnWingmen(): void {
    const p = this.w.player;
    p.wingmen.forEach((wm, i) => {
      if (this.cw.ships.some((x) => x.wingmanId === wm.id && !x.dead)) return;
      const d = this.w.design(wm.faction, wm.cls, wm.v);
      const s = new Ship(d, 0, wm.name, d.modules.map(() => Math.max(0.25, wm.hp)));
      s.wingmanId = wm.id;
      s.x = this.player.x - 150 - i * 80;
      s.y = this.player.y + (i % 2 ? 1 : -1) * (100 + i * 40);
      s.angle = this.player.angle;
      s.warpIn = this.opts.arrive === 'jump' ? 0.8 + i * 0.2 : 0;
      s.ai = new AIController('escort', 'normal', { x: s.x, y: s.y }, 0.5 + wm.skill * 0.08);
      s.ai.leader = this.player;
      s.ai.offset = { x: -140 - i * 60, y: (i % 2 ? 1 : -1) * (110 + i * 30) };
      this.cw.add(s);
    });
  }

  private spawnMissionStuff(): void {
    const w = this.w;
    const p = w.player;
    for (const m of p.missions) {
      if (m.status !== 'active') continue;
      const rng = new RNG(hash(m.id.length, this.sysId, 77));
      if ((m.type === 'salvage' || m.type === 'rescue') && m.target === this.sysId && !m.data.picked) {
        const a = rng.range(0, Math.PI * 2), r = rng.range(3500, 9000);
        this.objects.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, mission: m.id, kind: m.type === 'rescue' ? 'pod' : 'wreck', label: m.type === 'rescue' ? 'Escape Pod' : 'Derelict (black box)', done: false });
        if (rng.chance(0.5)) {
          const pirates = w.factions.filter((f) => f.kind === 'pirate' && f.alive);
          if (pirates.length) {
            const pf = rng.pick(pirates);
            for (let i = 0; i < 2; i++) {
              const s = this.makeNpc(pf.id, 'corvette', Math.cos(a) * r + rng.range(-600, 600), Math.sin(a) * r + rng.range(-600, 600), 'guard');
              s.ambient = true;
            }
          }
        }
      }
      if (m.type === 'defend' && m.target === this.sysId) {
        this.defend = { mission: m, wave: m.progress, t: 8, alive: [] };
        toast(`Defend ${this.sys.name}: enemy waves incoming!`, 'bad');
      }
      if (m.type === 'escort' && (m.origin === this.sysId || m.data.started)) {
        if ((m.data.hp ?? 1) <= 0) continue;
        m.data.started = true;
        const d = w.design(m.faction > 0 ? m.faction : 1, 'freighter', 0);
        const s = new Ship(d, m.faction > 0 ? m.faction : 1, 'Escorted Freighter', d.modules.map(() => m.data.hp ?? 1));
        s.x = this.player.x - 200;
        s.y = this.player.y + 150;
        s.missionId = m.id;
        s.ai = new AIController('escort', 'trader', { x: s.x, y: s.y }, 0.5);
        s.ai.leader = this.player;
        s.ai.offset = { x: -220, y: 160 };
        s.ai.aggressive = false;
        this.cw.add(s);
        this.escort = s;
        if (m.target === this.sysId) {
          m.data.arrived = true;
          const pirates = w.factions.filter((f) => f.kind === 'pirate' && f.alive);
          if (pirates.length && !m.data.ambushed) {
            m.data.ambushed = true;
            const pf = pirates[0];
            for (let i = 0; i < 3; i++) {
              const e = this.makeNpc(pf.id, i ? 'fighter' : 'corvette', this.player.x + 1500 + i * 120, this.player.y - 900, 'attack');
              e.target = s;
              e.ambient = true;
              e.warpIn = 2 + i * 0.3;
            }
            toast('Pirate ambush! Protect the freighter and dock at the station.', 'bad');
          }
        }
      }
    }
  }

  private updateDefend(dt: number): void {
    const d = this.defend;
    if (!d || d.mission.status !== 'active') return;
    d.alive = d.alive.filter((s) => !s.dead && !s.removed);
    if (d.alive.length === 0) {
      d.t -= dt;
      if (d.t <= 0) {
        if (d.wave >= d.mission.goal) {
          completeMission(this.w, d.mission);
          this.defend = null;
          return;
        }
        d.wave++;
        d.mission.progress = d.wave - 1;
        const enemy = d.mission.enemy > 0 ? d.mission.enemy : this.w.factions.find((f) => f.kind === 'pirate')!.id;
        const n = 2 + d.wave;
        const a = Math.random() * Math.PI * 2;
        const target = this.cw.stations[0] ?? this.player;
        for (let i = 0; i < n; i++) {
          const cls = i === 0 && d.wave >= 2 ? 'destroyer' : i < 2 ? 'frigate' : 'fighter';
          const s = this.makeNpc(enemy, cls, target.x + Math.cos(a) * 3500 + i * 80, target.y + Math.sin(a) * 3500, 'attack');
          s.warpIn = 1 + i * 0.2;
          s.ambient = true;
          s.ai!.home = { x: target.x, y: target.y };
          d.alive.push(s);
        }
        toast(`Wave ${d.wave}/${d.mission.goal} incoming!`, 'bad');
        audio.play('alarm', 0.6);
        d.t = 10;
      }
    }
  }

  // ================================================================== events
  private onShipDeath(s: Ship, killer: Ship | null): void {
    const w = this.w;
    const p = w.player;
    if (s.fleetRef) s.fleetRef.hp = 0;
    const rng = new RNG(s.id * 7 + Math.floor(this.t * 10));
    if (s.isPlayer) {
      this.dead = true;
      this.cam.shake = 30;
      setTimeout(() => this.deathScreen(), 1400);
      return;
    }
    if (s.wingmanId) {
      p.wingmen = p.wingmen.filter((x) => x.id !== s.wingmanId);
      toast(`Wingman ${s.name} was destroyed.`, 'bad');
    }
    if (s === this.escort) {
      const m = p.missions.find((x) => x.id === s.missionId);
      if (m) {
        m.data.hp = 0;
        toast('The escorted freighter was destroyed!', 'bad');
        abandonMission(w, m);
      }
      this.escort = null;
    }
    const byPlayer = killer && (killer.isPlayer || killer.faction === 0);
    if (dist(s.x, s.y, this.player.x, this.player.y) < 1500) this.cam.shake = Math.min(18, 4 + s.radius / 10);
    // Loot
    const loot = rng.int(1, 3);
    for (const cg of s.cargo) this.cw.dropLoot(s.x, s.y, 'cargo', cg.c, '', Math.max(1, Math.round(cg.q * rng.range(0.4, 0.8))), COMMODITIES[cg.c].color);
    if (rng.chance(0.7)) this.cw.dropLoot(s.x, s.y, 'credits', 0, '', Math.round(s.base.cost * rng.range(0.02, 0.06) + 40), '#ffd040');
    for (let i = 0; i < loot; i++) {
      if (rng.chance(0.35)) {
        const mods = s.design.modules.filter((m) => !MODULE_MAP[m.id].command && MODULE_MAP[m.id].cat !== 'armor');
        if (mods.length) {
          const m = rng.pick(mods);
          this.cw.dropLoot(s.x, s.y, 'module', 0, m.id, 1, '#c07aff');
        }
      } else if (rng.chance(0.3)) {
        const ammo = rng.pick(['shells', 'missiles', 'slugs'] as AmmoType[]);
        this.cw.dropLoot(s.x, s.y, 'ammo', 0, ammo, ammo === 'shells' ? 60 : ammo === 'slugs' ? 8 : 4, '#ff8040');
      } else {
        const c = rng.pick([C.metals, C.alloys, C.elec, C.mach, C.fuel]);
        this.cw.dropLoot(s.x, s.y, 'cargo', c, '', rng.int(2, 8), COMMODITIES[c].color);
      }
    }
    if (s.design.species !== 'human' && rng.chance(0.3)) this.cw.dropLoot(s.x, s.y, 'cargo', C.art, '', 1, '#ffb040');
    if (!byPlayer) return;
    // Rewards & reputation
    const f = w.factions[s.faction];
    const hostileBefore = w.hostile(0, s.faction) || s.wasHostileToPlayer;
    p.kills++;
    p.killsBy[s.faction] = (p.killsBy[s.faction] ?? 0) + 1;
    const str = s.base.strength;
    addXp(p, 10 + str / 60);
    if (w.hostile(0, s.faction) || f.kind === 'pirate' || s.wasHostileToPlayer) {
      // bounty from the local authority or anyone at war with them
      const payer = this.st.owner > 0 && w.factions[this.st.owner].kind !== 'pirate' && (f.kind === 'pirate' || w.factions[this.st.owner].war.includes(s.faction)) ? this.st.owner : -1;
      const bounty = Math.round(60 + str / 6);
      if (payer > 0 || f.kind === 'pirate' || f.species === 'hive') {
        p.credits += bounty;
        p.totalEarned += bounty;
        toast(`Bounty: +${bounty} cr (${s.name})`, 'good', 2000);
        if (payer > 0) changeRep(w, payer, 1.2);
      }
      for (const e of f.war) if (w.factions[e].alive && w.factions[e].kind !== 'player') p.rep[e] = Math.min(100, p.rep[e] + 0.6);
      if (p.military && (f.war.includes(p.military.faction) || f.kind === 'pirate' || w.factions[p.military.faction].war.includes(s.faction))) addMerit(w, 2 + str / 900);
      if (f.kind !== 'pirate') changeRep(w, s.faction, -1.5);
    }
    if (!hostileBefore && f.kind !== 'player') {
      changeRep(w, s.faction, -18, 'murder');
      p.bounty[s.faction] = (p.bounty[s.faction] ?? 0) + 800;
      toast(`You destroyed a non-hostile ${f.short} ship. They will remember.`, 'bad');
    }
    if (s.fleetId >= 0) {
      const fl = w.fleets.find((x) => x.id === s.fleetId);
      if (fl && fl.ships.every((x) => x.hp <= 0)) {
        w.removeFleet(fl);
        missionsOnFleetDestroyed(w, fl.id);
        this.fleetShips.delete(fl.id);
        w.addNews(`${p.name} destroyed ${fl.name} (${f.name}) at ${this.sys.name}.`, 'player', this.sysId);
      }
    }
  }

  private onPickup(l: Loot, s: Ship): boolean {
    const p = this.w.player;
    const st = this.player.stats;
    if (l.kind === 'cargo') {
      const free = st.cargo - cargoUsed(p);
      if (free <= 0) {
        if (Math.random() < 0.02) toast('Cargo hold full!', 'bad', 1200);
        return false;
      }
      const q = Math.min(free, l.qty);
      p.cargo[l.c] += q;
      l.qty -= q;
      toast(`+${q} ${COMMODITIES[l.c].name}`, 'good', 1200);
      audio.play('pickup', 0.4);
      return l.qty <= 0;
    }
    if (l.kind === 'credits') {
      p.credits += l.qty;
      p.totalEarned += l.qty;
      toast(`+${l.qty} credits`, 'good', 1200);
    } else if (l.kind === 'module') {
      p.modules[l.id] = (p.modules[l.id] ?? 0) + 1;
      toast(`Salvaged module: ${MODULE_MAP[l.id].name}`, 'good', 1800);
    } else if (l.kind === 'ammo') {
      const t = l.id as AmmoType;
      this.player.ammo[t] = Math.min(this.player.stats.ammoCap[t] || l.qty, (this.player.ammo[t] ?? 0) + l.qty);
      toast(`+${l.qty} ${t}`, 'good', 1200);
    }
    audio.play('pickup', 0.4);
    void s;
    return true;
  }

  // ================================================================== actions
  private dockAt(stn: StationEnt): void {
    const w = this.w;
    if (stn.faction > 0 && w.hostile(0, stn.faction)) {
      toast('Docking denied: you are hostile to this faction.', 'bad');
      audio.play('deny');
      return;
    }
    if (this.cw.stationAggro.has(stn.id + ':0')) {
      toast('Docking denied: station security is engaging you.', 'bad');
      return;
    }
    this.docked = true;
    this.dockStation = stn;
    this.autopilot = null;
    this.player.vx = this.player.vy = 0;
    this.player.cruise = false;
    this.player.x = stn.x + stn.r * 0.3;
    this.player.y = stn.y + stn.r * 0.3;
    audio.play('dock', 0.5);
    missionsOnDock(w, this.sysId);
    this.syncAll();
    this.openStationUI();
  }

  openStationUI(): void {
    if (!this.dockStation) this.dockStation = this.cw.stations[0] ?? null;
    if (!this.dockStation) return;
    openStation(this.game, this, this.dockStation, () => this.undock());
  }

  undock(): void {
    this.docked = false;
    const stn = this.dockStation;
    // apply any ship changes (repairs, builder, ammo purchases)
    const p = this.w.player;
    this.rebuildPlayerShip();
    if (stn) {
      this.player.x = stn.x + stn.r + 90;
      this.player.y = stn.y + 60;
      this.player.vx = 60;
    }
    this.player.invuln = 2;
    this.spawnWingmen();
    this.spawnEscorts();
    void p;
  }

  /** Escort freighters for missions accepted while docked here. */
  private spawnEscorts(): void {
    const w = this.w;
    for (const m of w.player.missions) {
      if (m.status !== 'active' || m.type !== 'escort' || m.origin !== this.sysId || (m.data.hp ?? 1) <= 0) continue;
      if (this.cw.ships.some((x) => x.missionId === m.id && !x.dead)) continue;
      m.data.started = true;
      const d = w.design(m.faction > 0 ? m.faction : 1, 'freighter', 0);
      const s = new Ship(d, m.faction > 0 ? m.faction : 1, 'Escorted Freighter', d.modules.map(() => m.data.hp ?? 1));
      s.x = this.player.x - 200;
      s.y = this.player.y + 150;
      s.missionId = m.id;
      s.ai = new AIController('escort', 'trader', { x: s.x, y: s.y }, 0.5);
      s.ai.leader = this.player;
      s.ai.offset = { x: -220, y: 160 };
      s.ai.aggressive = false;
      this.cw.add(s);
      this.escort = s;
      toast('The freighter is following you. Keep it alive until you dock at the destination.', 'info');
    }
  }

  rebuildPlayerShip(): void {
    const p = this.w.player;
    const old = this.player;
    const s = new Ship(p.design, 0, p.design.name, p.hp);
    s.isPlayer = true;
    s.x = old.x;
    s.y = old.y;
    s.angle = old.angle;
    s.vx = old.vx;
    s.vy = old.vy;
    s.ammo = { ...p.ammo };
    const ps = playerStats(p, s.alive);
    s.stats.maxSpeed = ps.maxSpeed;
    s.stats.accel = ps.accel;
    s.stats.turnRate = ps.turnRate;
    s.shield = s.stats.shieldCap;
    s.energy = s.stats.battery;
    s.dmgMult = 1 + p.skills.engineering * 0.06;
    old.removed = true;
    this.cw.ships = this.cw.ships.filter((x) => x !== old);
    this.cw.add(s);
    this.cw.player = s;
    for (const x of this.cw.ships) if (x.ai?.leader === old) x.ai.leader = s;
    this.player = s;
    this.buildHud();
  }

  private startJump(to: number): void {
    const w = this.w;
    const p = w.player;
    if (this.docked) this.undock();
    const d = sysDist(this.sys, w.sysData[to]);
    const fuel = fuelForJump(d);
    if (this.player.stats.jump <= 0) return void toast('No jump drive installed.', 'bad');
    if (d > this.player.stats.jump + 0.01) return void toast('Target is beyond jump range.', 'bad');
    if (p.fuel < fuel) return void toast(`Not enough fuel (${fuel} needed).`, 'bad');
    const hostile = this.cw.ships.some((s) => !s.dead && this.cw.isHostile(this.player, s) && dist2(s.x, s.y, this.player.x, this.player.y) < 1400 * 1400);
    this.jump = { to, t: 0, dur: hostile ? 6 : 3 };
    this.autopilot = null;
    toast(`Jump drive spooling${hostile ? ' (mass-locked by hostiles: slower)' : ''}…`, 'info');
    audio.play('jump', 0.4);
  }

  private doJump(): void {
    const w = this.w;
    const p = w.player;
    const to = this.jump!.to;
    const d = sysDist(this.sys, w.sysData[to]);
    p.fuel -= fuelForJump(d);
    // escort mission: carry the freighter along
    if (this.escort && !this.escort.dead) {
      const m = p.missions.find((x) => x.id === this.escort!.missionId);
      if (m) m.data.hp = this.escort.hpFraction();
    }
    this.syncAll();
    const from = this.sysId;
    p.sys = to;
    p.x = 0;
    p.y = 0;
    advanceTime(w, d / 9, -1);
    const route = (this.game as any).galaxyRoute as number[] | undefined;
    if (route && route[0] === from && route[1] === to) {
      route.shift();
      if (route.length < 2) (this.game as any).galaxyRoute = undefined;
    }
    this.game.go('system', { arrive: 'jump', from });
  }

  private deathScreen(): void {
    const w = this.w;
    const p = w.player;
    const value = designValue(p.design);
    const premium = Math.round(value * 0.12);
    const home = this.findRespawn();
    const m = openModal('Ship Destroyed', [
      h('p', null, 'Your ship breaks apart. The escape capsule ejects and drifts until a patrol recovers you.'),
      h('p', { class: 'small muted' }, `Cargo lost. You will be taken to ${w.sysData[home].name}.`),
      h('div', { class: 'col' },
        h('button', { class: `btn primary ${p.credits < premium ? 'disabled' : ''}`, onclick: () => { respawn(true); } }, `Insurance claim: restore your ship (${fmtCr(premium)})`),
        h('button', { class: 'btn', onclick: () => { respawn(false); } }, 'Take a basic replacement ship (free)')),
    ], { noClose: true });
    const respawn = (insured: boolean) => {
      m.close();
      p.deaths++;
      p.cargo = p.cargo.map(() => 0);
      if (insured) {
        p.credits -= premium;
      } else {
        p.design = starterDesign();
      }
      p.hp = p.design.modules.map(() => 1);
      p.fuel = Math.max(p.fuel, 30);
      for (const mi of p.missions) if (mi.type === 'delivery' || mi.type === 'passenger' || mi.type === 'smuggle') mi.data.lostCargo = true;
      this.syncAllWithoutPlayer();
      p.sys = home;
      advanceTime(w, 2, -1);
      this.game.go('system', { arrive: 'station', docked: true });
    };
  }

  private syncAllWithoutPlayer(): void {
    this.writeBack();
  }

  private findRespawn(): number {
    const w = this.w;
    const here = this.sys;
    let best = w.player.startFaction >= 0 ? w.factions[w.player.startFaction].capital : 0, bd = 1e9;
    for (let i = 0; i < w.systems.length; i++) {
      const st = w.systems[i];
      if (!st.station || (st.owner > 0 && w.hostile(0, st.owner))) continue;
      const d = sysDist(here, w.sysData[i]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  private intro(): void {
    const w = this.w;
    const f = w.factions[w.player.homeFaction];
    openModal('Welcome, Captain', [
      h('p', null, `You have just registered your first ship, the `, h('b', null, w.player.design.name), `, at ${this.sys.name} in ${f.name} space.`),
      h('p', null, 'You are docked. Check the Missions board for work, trade goods in the Market, or visit the Shipyard to redesign your ship block by block.'),
      h('p', null, 'The galaxy is alive: factions trade, expand, fight wars and rebel on their own. Watch the News and the galaxy map.'),
      h('p', { class: 'small muted' }, this.game.isTouch() ? 'Touch: left joystick flies, FIRE shoots at your target, tap objects to select them, double tap to autopilot.' : 'Keys: W/A/S/D fly, mouse aims, click / Space fires, right mouse flies toward cursor, M opens the galaxy map, E interacts.'),
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => topModal()?.close() }, 'Let\'s go')),
    ]);
  }

  // ================================================================== HUD
  buildHud(): void {
    const hud = this.game.hud;
    clear(hud);
    const R = this.hudRefs;
    const w = this.w;
    const owner = this.st.owner >= 0 ? w.factions[this.st.owner] : null;
    R.day = h('span', { class: 'v' });
    R.cr = h('span', { class: 'v' });
    R.loc = h('span', null, owner ? h('span', { class: 'dot', style: { background: owner.color } }) : null, h('b', null, this.sys.name));
    const menuBtns = h('div', { class: 'hud-menu' },
      h('button', { class: 'btn', onclick: () => this.openMap() }, '🗺 Map'),
      h('button', { class: 'btn', onclick: () => openJournal(this.game, 'Missions') }, '📋 Journal'),
      h('button', { class: 'btn', onclick: () => openJournal(this.game, 'Ship') }, '🚀 Ship'),
      h('button', { class: 'btn', onclick: () => openJournal(this.game, 'News') }, '📰 News'),
      h('button', { class: 'btn', onclick: () => this.menu() }, '≡'));
    hud.append(h('div', { class: 'hud-top' },
      h('div', { class: 'panel hud-info' }, R.loc, h('span', null, 'Day ', R.day), h('span', null, R.cr)),
      menuBtns));
    // ship status
    R.hull = h('div');
    R.shield = h('div');
    R.energy = h('div');
    R.misc = h('div', { class: 'lbl' });
    hud.append(h('div', { class: 'panel shipstat' }, R.hull, R.shield, R.energy, R.misc));
    R.target = h('div', { class: 'panel targetbox', style: 'display:none' });
    hud.append(R.target);
    R.actions = h('div', { class: 'actionbar' });
    hud.append(R.actions);
    R.progress = h('div', { class: 'panel progress-center', style: 'display:none' });
    hud.append(R.progress);
    this.radar = h('canvas', { class: 'panel radar', width: 180, height: 180 });
    hud.append(this.radar);
    this.controls = new FlightControls(this.game, hud, {
      onAction: () => this.actionState[0]?.fn(),
      onTarget: () => this.cycleTarget(true),
      onCruise: () => this.toggleCruise(),
    });
    this.actionKey = '';
    this.updateHud();
  }

  private menu(): void {
    const game = this.game;
    const m = openModal('Menu', h('div', { class: 'col' },
      h('button', { class: 'btn', onclick: () => { m.close(); openSaveLoad(game, 'save'); } }, '💾 Save game'),
      h('button', { class: 'btn', onclick: () => { m.close(); openSaveLoad(game, 'load'); } }, '⤓ Load game'),
      h('button', { class: 'btn', onclick: () => { m.close(); openSettings(game); } }, '⚙ Settings'),
      h('button', { class: 'btn', onclick: () => { m.close(); openJournal(game, 'Pilot'); } }, '⭐ Pilot & skills'),
      h('button', { class: 'btn', onclick: () => { m.close(); openJournal(game, 'Factions'); } }, '⚑ Factions'),
      h('button', { class: 'btn', onclick: () => { m.close(); openJournal(game, 'Colonies'); } }, '⌂ Colonies'),
      h('button', { class: 'btn danger', onclick: () => { m.close(); game.autosave(); game.go('menu'); } }, '⏏ Save & quit to title')));
  }

  openMap(): void {
    if (this.docked) return;
    this.game.go('galaxy');
  }

  private toggleCruise(): void {
    const s = this.player;
    if (s.cruise) {
      s.cruise = false;
      return;
    }
    if (this.hostileNear) {
      toast('Cruise drive blocked: hostiles nearby.', 'bad', 1500);
      return;
    }
    s.cruise = true;
  }

  private cycleTarget(hostileFirst: boolean): void {
    const cands = this.cw.ships.filter((s) => !s.dead && !s.isPlayer && s.faction !== 0 && dist2(s.x, s.y, this.player.x, this.player.y) < this.player.stats.sensor ** 2);
    cands.sort((a, b) => {
      const ha = this.cw.isHostile(this.player, a) ? 0 : 1, hb = this.cw.isHostile(this.player, b) ? 0 : 1;
      if (hostileFirst && ha !== hb) return ha - hb;
      return dist2(a.x, a.y, this.player.x, this.player.y) - dist2(b.x, b.y, this.player.x, this.player.y);
    });
    if (!cands.length) return;
    const cur = this.sel?.kind === 'ship' ? cands.indexOf(this.sel.ship) : -1;
    this.sel = { kind: 'ship', ship: cands[(cur + 1) % cands.length] };
    this.player.target = this.sel.ship;
  }

  private computeActions(): { label: string; fn: () => void }[] {
    const acts: { label: string; fn: () => void }[] = [];
    if (this.docked || this.dead) return acts;
    const s = this.player;
    const w = this.w;
    const route = (this.game as any).galaxyRoute as number[] | undefined;
    for (const stn of this.cw.stations) {
      if (dist(s.x, s.y, stn.x, stn.y) < stn.r + 260) {
        acts.push({ label: `Dock: ${stn.name}`, fn: () => this.dockAt(stn) });
        break;
      }
    }
    for (const b of this.bodies) {
      const pos = this.bodyXY.get(b.key)!;
      const d = dist(s.x, s.y, pos.x, pos.y);
      if (d < b.radius + 420) {
        acts.push({ label: b.landable ? `Orbit ${b.name}` : `Orbit ${b.name}`, fn: () => this.toPlanet(b) });
      }
      const scanned = this.st.scanned.includes(b.key);
      if (!scanned && !this.scan && d < b.radius + 1400 + s.stats.scan * 250) acts.push({ label: `Scan ${b.name}`, fn: () => this.startScan(b) });
    }
    for (const o of this.objects) {
      if (o.done) continue;
      if (dist(s.x, s.y, o.x, o.y) < 350) acts.push({ label: o.kind === 'anomaly' ? 'Study anomaly' : o.kind === 'pod' ? 'Recover pod' : 'Salvage', fn: () => this.useObject(o) });
    }
    if (route && route.length > 1 && route[0] === this.sysId && !this.jump) acts.push({ label: `Jump → ${w.sysData[route[1]].name}`, fn: () => this.startJump(route[1]) });
    if (this.sel && this.sel.kind !== 'ship' && !this.autopilot) {
      const [x, y] = this.selPos();
      if (dist(s.x, s.y, x, y) > 900) acts.push({ label: 'Autopilot', fn: () => this.setAutopilot() });
    }
    if (this.autopilot) acts.push({ label: 'Cancel autopilot', fn: () => (this.autopilot = null) });
    // keep the bar tidy: at most one scan suggestion and a few actions
    let scans = 0;
    const tidy = acts.filter((a) => !a.label.startsWith('Scan ') || scans++ < 1);
    return tidy.slice(0, this.game.isTouch() ? 3 : 4);
  }

  private selPos(): [number, number] {
    const sel = this.sel;
    if (!sel) return [0, 0];
    if (sel.kind === 'ship') return [sel.ship.x, sel.ship.y];
    if (sel.kind === 'station') return [sel.st.x, sel.st.y];
    if (sel.kind === 'object') return [sel.obj.x, sel.obj.y];
    const p = this.bodyXY.get(sel.body.key)!;
    return [p.x, p.y];
  }

  private setAutopilot(): void {
    const sel = this.sel;
    if (!sel) return;
    const [x, y] = this.selPos();
    const stop = sel.kind === 'body' ? sel.body.radius + 250 : sel.kind === 'station' ? sel.st.r + 150 : 200;
    const label = sel.kind === 'body' ? sel.body.name : sel.kind === 'station' ? sel.st.name : sel.kind === 'object' ? sel.obj.label : sel.ship.name;
    this.autopilot = { x, y, stop, label };
  }

  private toPlanet(b: Body): void {
    this.syncAll();
    this.game.go('planet', { body: b });
  }

  private startScan(b: Body): void {
    const dur = Math.max(1.5, 5 - this.player.stats.scan * 0.6 - this.w.player.skills.science * 0.3);
    this.scan = { body: b, t: 0, dur };
    audio.play('scan', 0.4);
  }

  private finishScan(b: Body): void {
    const w = this.w;
    const p = w.player;
    this.st.scanned.push(b.key);
    const value = Math.round((80 + b.habitability * 400 + (b.ruins ? 600 : 0) + b.biosphere * 300 + b.resources.crystals * 300 + (b.type === 'crystal' ? 800 : 0) + (this.sys.special !== 'none' ? 200 : 0)) * (1 + p.skills.science * 0.1));
    p.explorationData += value;
    addXp(p, 12 + value / 40);
    const res = Object.entries(b.resources).filter(([, v]) => v > 0.4).map(([k]) => k).join(', ') || 'none notable';
    toast(`Scan complete: ${b.name} — ${PLANET_LABEL[b.type]}, habitability ${(b.habitability * 100).toFixed(0)}%, resources: ${res}${b.ruins ? ', ANCIENT RUINS detected!' : ''} (+${value} cr data)`, 'good', 5000);
    missionsOnScan(w, this.sysId);
    if (b.ruins) w.addNews(`${p.name} discovers ancient ruins on ${b.name}.`, 'discovery', this.sysId);
  }

  private useObject(o: MissionObject): void {
    const w = this.w;
    const p = w.player;
    o.done = true;
    if (o.mission) {
      const m = p.missions.find((x) => x.id === o.mission);
      if (m) {
        m.data.picked = true;
        toast(m.type === 'rescue' ? 'Survivors recovered! Return them to the mission giver.' : 'Black box recovered! Return it to the mission giver.', 'good');
      }
      return;
    }
    const rng = new RNG(this.sys.seed + 99);
    if (o.kind === 'derelict') {
      for (let i = 0; i < 4; i++) {
        const mods = ['shield', 'laser_heavy', 'reactor', 'jump2', 'repair', 'missile', 'armor_heavy', 'railgun'];
        this.cw.dropLoot(o.x, o.y, i === 0 ? 'module' : 'cargo', i === 0 ? 0 : rng.pick([C.elec, C.alloys, C.art, C.mach]), rng.pick(mods), i === 0 ? 1 : rng.int(2, 10), '#c07aff');
      }
      toast('You pry open the derelict. Salvage drifts free.', 'good');
    } else if (o.kind === 'anomaly') {
      const v = 1500 + p.skills.science * 200;
      p.explorationData += v;
      addXp(p, 120);
      toast(`Anomaly studied. Invaluable data recorded (+${v} cr of data).`, 'good');
      w.addNews(`${p.name} charts a spatial anomaly near ${this.sys.name}.`, 'discovery', this.sysId);
    }
  }

  private updateHud(): void {
    const R = this.hudRefs;
    const w = this.w;
    const p = w.player;
    const s = this.player;
    R.day.textContent = String(Math.floor(w.day));
    R.cr.textContent = fmtCr(p.credits);
    const st = s.stats;
    clear(R.hull);
    R.hull.append(h('div', { class: 'lbl' }, h('span', null, 'HULL'), h('span', null, `${Math.round(s.hpFraction() * 100)}%`)), bar(s.hpFraction(), '#e0a040'));
    clear(R.shield);
    R.shield.append(h('div', { class: 'lbl' }, h('span', null, 'SHIELD'), h('span', null, `${Math.round(s.shield)}/${Math.round(st.shieldCap)}`)), bar(st.shieldCap ? s.shield / st.shieldCap : 0, '#50a8ff'));
    clear(R.energy);
    R.energy.append(h('div', { class: 'lbl' }, h('span', null, 'ENERGY'), h('span', null, `${Math.round(s.energy)}`)), bar(s.energy / Math.max(1, st.battery), '#60e0a0'));
    const ammo = (Object.keys(s.ammo) as AmmoType[]).filter((k) => st.ammoCap[k] > 0).map((k) => `${k[0].toUpperCase()}${Math.floor(s.ammo[k])}`).join(' ');
    R.misc.textContent = `FUEL ${Math.floor(p.fuel)}  CARGO ${cargoUsed(p)}/${st.cargo}  ${Math.round(Math.hypot(s.vx, s.vy))} m/s ${s.cruise ? 'CRUISE' : ''} ${ammo}`;
    // target
    const sel = this.sel;
    if (sel) {
      R.target.style.display = '';
      clear(R.target);
      const [x, y] = this.selPos();
      const d = dist(s.x, s.y, x, y);
      if (sel.kind === 'ship') {
        const t = sel.ship;
        const f = w.factions[t.faction];
        const hostile = this.cw.isHostile(s, t);
        add(R.target,
          h('div', { class: 'row between' }, h('b', null, t.name), h('span', { class: hostile ? 'bad' : 'good' }, hostile ? 'HOSTILE' : t.faction === 0 ? 'WINGMAN' : 'NEUTRAL')),
          h('div', { class: 'small' }, h('span', { class: 'dot', style: { background: f.color } }), f.name, t.faction > 0 ? h('span', { class: 'muted' }, ` · ${repTier(p.rep[t.faction]).name}`) : null),
          h('div', { class: 'small muted' }, `${t.design.name} · ${(d / 1000).toFixed(1)}k · ${t.role || 'patrol'}`),
          bar(t.hpFraction(), '#e0a040', 'HULL'), bar(t.stats.shieldCap ? t.shield / t.stats.shieldCap : 0, '#50a8ff', 'SHIELD'));
      } else if (sel.kind === 'body') {
        const b = sel.body;
        const scanned = this.st.scanned.includes(b.key);
        add(R.target, h('b', null, b.name), h('div', { class: 'small muted' }, `${PLANET_LABEL[b.type]} · ${(d / 1000).toFixed(1)}k`),
          scanned ? h('div', { class: 'small' }, `Hab ${(b.habitability * 100).toFixed(0)}% · ${b.atmosphere} atm · ${b.gravity.toFixed(1)}g · ${Math.round(b.temp)}K`) : h('div', { class: 'small warn' }, 'Unscanned'),
          b.ruins && scanned ? h('div', { class: 'small gold' }, 'Ancient ruins') : null);
      } else if (sel.kind === 'station') {
        const f = sel.st.faction >= 0 ? w.factions[sel.st.faction] : null;
        add(R.target, h('b', null, sel.st.name), h('div', { class: 'small muted' }, `${f ? f.name : 'Independent'} · ${(d / 1000).toFixed(1)}k`));
      } else {
        add(R.target, h('b', null, sel.obj.label), h('div', { class: 'small muted' }, `${(d / 1000).toFixed(1)}k`));
      }
    } else R.target.style.display = 'none';
    // actions
    this.actionState = this.computeActions();
    const key = this.actionState.map((a) => a.label).join('|');
    if (key !== this.actionKey) {
      this.actionKey = key;
      clear(R.actions);
      const touch = this.game.isTouch();
      this.actionState.forEach((a, i) => R.actions.append(h('button', { class: `btn ${i === 0 ? 'primary' : ''}`, onclick: a.fn }, a.label + (i === 0 && !touch ? ' [E]' : ''))));
      this.controls.setAction(this.actionState[0] ? this.actionState[0].label.split(':')[0].split(' ')[0] : null);
    }
    this.controls.setCruise(s.cruise);
    // progress
    if (this.scan || this.jump) {
      R.progress.style.display = '';
      clear(R.progress);
      if (this.scan) R.progress.append(h('div', null, `Scanning ${this.scan.body.name}…`), bar(this.scan.t / this.scan.dur, '#46d0dc'));
      if (this.jump) R.progress.append(h('div', null, `Jump drive charging → ${w.sysData[this.jump.to].name}`), bar(this.jump.t / this.jump.dur, '#b080ff'));
    } else R.progress.style.display = 'none';
  }

  private drawRadar(): void {
    const c = this.radar;
    if (!c || !c.isConnected || this.game.isTouch()) return;
    const g = c.getContext('2d')!;
    const W = c.width;
    g.clearRect(0, 0, W, W);
    const range = Math.max(3000, this.player.stats.sensor);
    const k = (W / 2) / range;
    g.strokeStyle = 'rgba(70,208,220,0.25)';
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.arc(W / 2, W / 2, W / 4, 0, Math.PI * 2);
    g.stroke();
    const px = this.player.x, py = this.player.y;
    for (const st of this.cw.stations) {
      const x = W / 2 + (st.x - px) * k, y = W / 2 + (st.y - py) * k;
      if (Math.hypot(x - W / 2, y - W / 2) > W / 2) continue;
      g.fillStyle = '#ffe080';
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const b of this.bodies) {
      const p = this.bodyXY.get(b.key)!;
      const x = W / 2 + (p.x - px) * k, y = W / 2 + (p.y - py) * k;
      if (Math.hypot(x - W / 2, y - W / 2) > W / 2) continue;
      g.fillStyle = '#6a8ab0';
      g.beginPath();
      g.arc(x, y, Math.max(2, b.radius * k), 0, Math.PI * 2);
      g.fill();
    }
    for (const s of this.cw.ships) {
      if (s.dead || s.isPlayer) continue;
      const x = W / 2 + (s.x - px) * k, y = W / 2 + (s.y - py) * k;
      if (Math.hypot(x - W / 2, y - W / 2) > W / 2) continue;
      g.fillStyle = s.faction === 0 ? '#6fe08a' : this.cw.isHostile(this.player, s) ? '#ff5a4a' : '#c8d4e8';
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    g.fillStyle = '#46d0dc';
    g.beginPath();
    const a = this.player.angle;
    g.moveTo(W / 2 + Math.cos(a) * 6, W / 2 + Math.sin(a) * 6);
    g.lineTo(W / 2 + Math.cos(a + 2.5) * 4, W / 2 + Math.sin(a + 2.5) * 4);
    g.lineTo(W / 2 + Math.cos(a - 2.5) * 4, W / 2 + Math.sin(a - 2.5) * 4);
    g.fill();
  }

  // ================================================================== update
  update(dt: number): void {
    this.t += dt;
    const w = this.w;
    const s = this.player;
    this.onResize();
    // world time
    if (!this.docked && !this.dead) {
      const before = Math.floor(w.day);
      advanceTime(w, dt / SECONDS_PER_DAY, this.sysId);
      if (Math.floor(w.day) !== before) {
        this.writeBack();
        this.syncFleets();
      }
    }
    this.updateBodies();
    this.updateStations(dt);
    const uiBlocked = !!topModal();
    if (!this.dead && !this.docked) {
      this.controls.apply(s, this.cam, dt, () => this.autoTarget(), uiBlocked);
      // autopilot
      if (this.autopilot) {
        const ap = this.autopilot;
        if (this.sel && this.sel.kind !== 'ship') [ap.x, ap.y] = this.selPos();
        const d = dist(s.x, s.y, ap.x, ap.y);
        const manual = s.thrust > 0 || s.reverse > 0;
        if (manual && !input.down('KeyE')) this.autopilot = null;
        else if (d < ap.stop) {
          this.autopilot = null;
          s.cruise = false;
          toast(`Arrived: ${ap.label}`, 'info', 1500);
        } else {
          const ai = new AIController('hold', 'normal', { x: 0, y: 0 });
          ai.steer(s, ap.x, ap.y, dt, ap.stop, 1);
          if (d > 3000 && !this.hostileNear) s.cruise = true;
          if (d < 2500 && s.cruise) s.cruise = false;
        }
      }
      if (input.hit('KeyC')) this.toggleCruise();
      if (input.hit('KeyE', 'KeyF') && this.actionState[0]) this.actionState[0].fn();
      if (input.hit('Tab')) this.cycleTarget(false);
      if (input.hit('KeyT')) this.cycleTarget(true);
      if (input.hit('KeyM')) this.openMap();
      if (input.hit('KeyJ')) openJournal(this.game, 'Missions');
      if (input.hit('KeyN')) openJournal(this.game, 'News');
      if (input.hit('KeyI')) openJournal(this.game, 'Ship');
      this.handleTaps();
    }
    // hostile proximity: cruise disengage & music
    this.hostileNear = this.cw.ships.some((o) => !o.dead && o !== s && o.warpIn <= 0 && this.cw.isHostile(s, o) && dist2(o.x, o.y, s.x, s.y) < 2200 * 2200);
    if (this.hostileNear) {
      this.lastCombat = this.t;
      if (s.cruise) {
        s.cruise = false;
        toast('Cruise drive disengaged: hostile contact!', 'bad', 1500);
      }
    }
    audio.setMood(this.t - this.lastCombat < 10 ? 'tense' : 'calm');
    // scanning
    if (this.scan) {
      const pos = this.bodyXY.get(this.scan.body.key)!;
      if (dist(s.x, s.y, pos.x, pos.y) > this.scan.body.radius + 2200) {
        toast('Scan interrupted: out of range.', 'bad');
        this.scan = null;
      } else {
        this.scan.t += dt;
        if (this.scan.t >= this.scan.dur) {
          this.finishScan(this.scan.body);
          this.scan = null;
        }
      }
    }
    if (this.jump) {
      this.jump.t += dt;
      s.thrust = Math.max(s.thrust, 0.3);
      if (this.jump.t >= this.jump.dur) {
        this.doJump();
        return;
      }
    }
    // ambient traffic
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 35 + Math.random() * 40;
      if (this.cw.ships.length < 40) this.spawnAmbient(false, false);
    }
    this.updateDefend(dt);
    // keep NPCs inside the system bounds
    for (const o of this.cw.ships) {
      if (o.isPlayer) {
        const r = Math.hypot(o.x, o.y);
        if (r > EDGE * 1.2) {
          o.vx -= (o.x / r) * 400 * dt;
          o.vy -= (o.y / r) * 400 * dt;
        }
      }
    }
    // docked ship stays put
    if (this.docked && this.dockStation) {
      s.x = this.dockStation.x;
      s.y = this.dockStation.y;
      s.vx = s.vy = 0;
    }
    if (!this.docked) this.cw.update(dt);
    else this.cw.particles.update(dt);
    // camera
    const zoomAt = (f: number) => (this.cam.zoom = clamp(this.cam.zoom * f, 0.035, 3.2));
    if (input.wheel && !uiBlocked) zoomAt(Math.pow(0.87, input.wheel));
    if (input.pinch !== 1 && !uiBlocked) zoomAt(input.pinch);
    if (input.hit('Equal', 'NumpadAdd')) zoomAt(1.25);
    if (input.hit('Minus', 'NumpadSubtract')) zoomAt(0.8);
    const speed = Math.hypot(s.vx, s.vy);
    const lookAhead = s.cruise ? 0.6 : 0.25;
    const tx = s.x + s.vx * lookAhead, ty = s.y + s.vy * lookAhead;
    const k = 1 - Math.exp(-dt * 5);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    if (s.cruise && this.cam.zoom > 0.35) this.cam.zoom *= 1 - dt * 0.8;
    void speed;
    this.cam.updateShake(dt);
    if (this.sel?.kind === 'ship' && (this.sel.ship.dead || this.sel.ship.removed)) this.sel = null;
    // HUD
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.12;
      this.updateHud();
      this.drawRadar();
    }
  }

  private autoTarget(): Ship | null {
    const s = this.player;
    if (this.sel?.kind === 'ship' && !this.sel.ship.dead && this.cw.isHostile(s, this.sel.ship)) return this.sel.ship;
    if (!this.game.settings.aimAssist && !this.game.isTouch()) return null;
    let best: Ship | null = null, bd = (s.stats.range * 1.2) ** 2;
    for (const o of this.cw.ships) {
      if (o.dead || o === s || o.cloaked || !this.cw.isHostile(s, o) || o.warpIn > 0) continue;
      const d = dist2(o.x, o.y, s.x, s.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) s.target = best;
    return best;
  }

  private handleTaps(): void {
    for (const tap of input.taps) {
      const [wx, wy] = this.cam.toWorld(tap.x, tap.y);
      const z = this.cam.zoom;
      let best: Sel = null, bd = (40 / z) ** 2;
      for (const s of this.cw.ships) {
        if (s.dead || s.isPlayer) continue;
        const r = Math.max(s.radius, 30 / z);
        const d = dist2(s.x, s.y, wx, wy);
        if (d < r * r && d < bd) { bd = d; best = { kind: 'ship', ship: s }; }
      }
      if (!best) {
        for (const st of this.cw.stations) {
          const d = dist2(st.x, st.y, wx, wy);
          if (d < Math.max(st.r, 30 / z) ** 2) best = { kind: 'station', st };
        }
      }
      if (!best) {
        for (const o of this.objects) if (!o.done && dist2(o.x, o.y, wx, wy) < (40 / z) ** 2) best = { kind: 'object', obj: o };
      }
      if (!best) {
        for (const b of this.bodies) {
          const p = this.bodyXY.get(b.key)!;
          const r = Math.max(b.radius, 24 / z);
          if (dist2(p.x, p.y, wx, wy) < r * r) best = { kind: 'body', body: b };
        }
      }
      const now = performance.now();
      const same = best && this.sel && best.kind === this.sel.kind && JSON.stringify(Object.values(best).map((v: any) => v?.id ?? v?.key ?? v?.label)) === JSON.stringify(Object.values(this.sel).map((v: any) => v?.id ?? v?.key ?? v?.label));
      if (best) {
        this.sel = best;
        if (best.kind === 'ship') this.player.target = best.ship;
        if (same && now - this.lastTapT < 450 && best.kind !== 'ship') this.setAutopilot();
      } else if (this.game.isTouch() && now - this.lastTapT < 450) {
        this.autopilot = { x: wx, y: wy, stop: 120, label: 'waypoint' };
      } else if (!this.game.isTouch() && tap.button === 0) {
        // clicking empty space on desktop fires, so keep the selection
      } else this.sel = null;
      this.lastTapT = now;
    }
  }

  // ================================================================== render
  render(g: CanvasRenderingContext2D): void {
    const game = this.game;
    const W = game.width, H = game.height;
    const cam = this.cam;
    const w = this.w;
    const neb = this.sys.nebula >= 0 ? w.galaxy.nebulae[this.sys.nebula] : null;
    game.starfield.draw(g, W, H, cam.x * 0.4, cam.y * 0.4 * cam.tilt, neb ? `rgb(${neb.color.join(',')})` : undefined, neb ? 0.35 : 0);
    const z = cam.zoom;
    // habitable zone band
    {
      const [cx, cy] = cam.toScreen(0, 0);
      const r1 = this.sys.hzInner * z, r2 = this.sys.hzOuter * z;
      if (r2 > 30) {
        g.save();
        g.translate(cx, cy);
        g.scale(1, cam.tilt);
        g.beginPath();
        g.arc(0, 0, r2, 0, Math.PI * 2);
        g.arc(0, 0, r1, 0, Math.PI * 2, true);
        g.fillStyle = 'rgba(40,140,110,0.09)';
        g.fill();
        g.restore();
        if (z < 0.25) {
          g.fillStyle = 'rgba(90,200,150,0.7)';
          g.font = '12px Roboto Mono, monospace';
          g.textAlign = 'center';
          g.fillText('HABITABLE ZONE', cx, cy - ((r1 + r2) / 2) * cam.tilt);
        }
      }
    }
    // orbits
    g.lineWidth = 1;
    for (const b of this.bodies) {
      const parent = b.parent ? this.bodyXY.get(b.parent.key)! : { x: 0, y: 0 };
      const r = b.orbit * z;
      if (r < 4 || (b.parent && r < 12)) continue;
      const [cx, cy] = cam.toScreen(parent.x, parent.y);
      g.strokeStyle = b.parent ? 'rgba(140,170,210,0.18)' : 'rgba(140,170,210,0.22)';
      g.beginPath();
      g.ellipse(cx, cy, r, r * cam.tilt, 0, 0, Math.PI * 2);
      g.stroke();
    }
    // belts (faint band when zoomed out)
    for (const belt of this.sys.belts) {
      const [cx, cy] = cam.toScreen(0, 0);
      if (z > 0.25) continue;
      g.strokeStyle = 'rgba(160,140,110,0.18)';
      g.lineWidth = Math.max(1, belt.width * z);
      g.beginPath();
      g.ellipse(cx, cy, belt.orbit * z, belt.orbit * z * cam.tilt, 0, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 1;
    }
    if (z > 0.08) drawAsteroids(g, this.cw, cam);
    // bodies & star, depth sorted (objects "behind" the star are drawn first)
    const items: { y: number; draw: () => void }[] = [];
    const starR = this.sys.stars[0].radius;
    const bin = this.sys.binarySep;
    this.sys.stars.forEach((star, i) => {
      // binary companions orbit the barycentre on opposite sides, weighted by mass
      const total = this.sys.stars.reduce((a, s2) => a + s2.mass, 0) || 1;
      const ang = this.t * 0.05 + i * Math.PI;
      const off = bin > 0 ? bin * (1 - star.mass / total) : 0;
      const sx0 = Math.cos(ang) * off, sy0 = Math.sin(ang) * off;
      items.push({ y: sy0, draw: () => {
        const [sx, sy] = cam.toScreen(sx0, sy0);
        drawStar(g, star, sx, sy, Math.max(3, star.radius * z), this.t);
      } });
    });
    const star = this.sys.stars[0];
    for (const b of this.bodies) {
      const p = this.bodyXY.get(b.key)!;
      items.push({ y: p.y, draw: () => this.drawBody(g, b, p.x, p.y) });
    }
    for (const st of this.cw.stations) items.push({ y: st.y, draw: () => this.drawStation(g, st) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    void starR;
    void star;
    // mission objects
    for (const o of this.objects) {
      if (o.done || !cam.visible(o.x, o.y, 50)) continue;
      const [ox, oy] = cam.toScreen(o.x, o.y);
      const pulse = 0.5 + Math.sin(this.t * 3) * 0.5;
      g.strokeStyle = o.kind === 'anomaly' ? `rgba(200,120,255,${0.5 + pulse * 0.5})` : `rgba(64,255,176,${0.5 + pulse * 0.5})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(ox, oy, Math.max(6, 25 * z), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#8a8070';
      g.fillRect(ox - 6 * Math.max(0.5, z), oy - 4 * Math.max(0.5, z), 12 * Math.max(0.5, z), 8 * Math.max(0.5, z));
      g.fillStyle = '#c8d4e8';
      g.font = '11px Roboto, sans-serif';
      g.textAlign = 'center';
      g.fillText(o.label, ox, oy + Math.max(14, 32 * z));
    }
    drawLoot(g, this.cw, cam, this.t);
    // ships (depth sorted)
    const ships = this.cw.ships.filter((s) => !s.dead && !s.docked).sort((a, b) => a.y - b.y);
    for (const s of ships) {
      if (s.isPlayer && this.docked) continue;
      if (z < 0.12) {
        const [sx, sy] = cam.toScreen(s.x, s.y);
        g.fillStyle = s.isPlayer ? '#46d0dc' : s.faction === 0 ? '#6fe08a' : this.cw.isHostile(this.player, s) ? '#ff5a4a' : w.factions[s.faction].color;
        g.beginPath();
        g.moveTo(sx + Math.cos(s.angle) * 6, sy + Math.sin(s.angle) * 6 * cam.tilt);
        g.lineTo(sx + Math.cos(s.angle + 2.5) * 4, sy + Math.sin(s.angle + 2.5) * 4 * cam.tilt);
        g.lineTo(sx + Math.cos(s.angle - 2.5) * 4, sy + Math.sin(s.angle - 2.5) * 4 * cam.tilt);
        g.fill();
        continue;
      }
      drawShip(g, s, cam, this.t, this.sel?.kind === 'ship' && this.sel.ship === s);
    }
    drawProjectiles(g, this.cw, cam);
    this.cw.particles.draw(g, (x, y) => cam.toScreen(x, y), z, cam.tilt, W, H);
    this.drawOverlays(g);
  }

  private drawBody(g: CanvasRenderingContext2D, b: Body, x: number, y: number): void {
    const cam = this.cam;
    const z = cam.zoom;
    const r = b.radius * z;
    if (!cam.visible(x, y, b.radius * 2.5)) return;
    const [sx, sy] = cam.toScreen(x, y);
    // light from the star (screen space direction)
    const lx = -x, ly = -y * cam.tilt;
    const l = Math.hypot(lx, ly) || 1;
    const inhabited = this.st.pop > 50 && b.habitability > 0.4 && b.parent === null && this.sys.planets.indexOf(b) === 0 ? 1 : 0;
    if (r < 2.2) {
      g.fillStyle = '#9ab0c8';
      g.fillRect(sx - 1, sy - 1, 2, 2);
    } else {
      const rot = (this.w.day * b.rotSpeed * 6) % (Math.PI * 2);
      const size = Math.min(320, Math.max(8, r * 2));
      const spr = this.game.planets.sprite(b, size, rot, (lx / l) * 0.85, (ly / l) * 0.85, this.t, inhabited);
      if (b.rings) drawRings(g, sx, sy, r, cam.tilt, 'rgba(210,190,160,0.8)', false);
      if (spr) {
        const full = spr.width;
        const scale = (r * 2) / (full / 1.24);
        g.drawImage(spr, sx - (full * scale) / 2, sy - (full * scale) / 2, full * scale, full * scale);
      } else {
        // placeholder while the surface map is generated
        g.fillStyle = '#3a4a5a';
        g.beginPath();
        g.arc(sx, sy, r, 0, Math.PI * 2);
        g.fill();
      }
      if (b.rings) drawRings(g, sx, sy, r, cam.tilt, 'rgba(210,190,160,0.8)', true);
    }
    // labels (reference style: white name under the planet)
    const showLabel = z > 0.02 && (b.parent === null || z > 0.25);
    if (showLabel) {
      const selected = this.sel?.kind === 'body' && this.sel.body === b;
      g.font = `${selected ? 600 : 500} ${b.parent ? 11 : 13}px Roboto, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = selected ? '#ffffff' : 'rgba(200,210,235,0.85)';
      g.fillText(b.name, sx, sy + Math.max(r, 4) + 16);
      if (this.st.colony >= 0) {
        const col = this.w.colonies.find((c) => c.id === this.st.colony);
        if (col && col.body === b.key) {
          g.fillStyle = '#6fe08a';
          g.beginPath();
          g.arc(sx + g.measureText(b.name).width / 2 + 8, sy + Math.max(r, 4) + 12, 4, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    if (this.sel?.kind === 'body' && this.sel.body === b) {
      g.strokeStyle = '#46c0c8';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, sy, Math.max(r, 8) + 8, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private drawStation(g: CanvasRenderingContext2D, st: StationEnt): void {
    const cam = this.cam;
    if (!cam.visible(st.x, st.y, st.r * 2)) return;
    const [sx, sy] = cam.toScreen(st.x, st.y);
    const z = cam.zoom;
    const col = st.faction >= 0 ? this.w.factions[st.faction].color : '#aaaaaa';
    const size = st.r * 2 * z;
    if (size < 4) {
      g.fillStyle = '#ffe080';
      g.fillRect(sx - 2, sy - 2, 4, 4);
    } else {
      const spr = stationSprite(st.type, col, size * 1.2);
      g.save();
      g.translate(sx, sy);
      g.scale(1, cam.tilt);
      g.rotate(st.angle);
      g.drawImage(spr, -size / 2, -size / 2, size, size);
      g.restore();
    }
    if (z > 0.05) {
      g.font = '500 12px Roboto, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255,230,160,0.9)';
      g.fillText(st.name, sx, sy + Math.max(size * cam.tilt / 2, 6) + 16);
    }
    if (this.sel?.kind === 'station' && this.sel.st === st) {
      g.strokeStyle = '#46c0c8';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(sx, sy, size / 2 + 10, (size / 2) * cam.tilt + 10, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private drawOverlays(g: CanvasRenderingContext2D): void {
    const cam = this.cam;
    const W = cam.vw, H = cam.vh;
    const s = this.player;
    // selected ship brackets
    if (this.sel?.kind === 'ship') {
      const t = this.sel.ship;
      const [sx, sy] = cam.toScreen(t.x, t.y);
      const r = Math.max(14, t.radius * cam.zoom * 1.1);
      const hostile = this.cw.isHostile(s, t);
      g.strokeStyle = hostile ? '#ff5a4a' : '#46c0c8';
      g.lineWidth = 2;
      const c = r * 0.4;
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        g.beginPath();
        g.moveTo(sx + dx * r, sy + dy * r * 0.8 - dy * c);
        g.lineTo(sx + dx * r, sy + dy * r * 0.8);
        g.lineTo(sx + dx * r - dx * c, sy + dy * r * 0.8);
        g.stroke();
      }
    }
    // mission / hostile edge indicators
    const markers: { x: number; y: number; color: string; label?: string }[] = [];
    for (const o of this.objects) if (!o.done) markers.push({ x: o.x, y: o.y, color: '#40ffb0', label: o.label });
    for (const sh of this.cw.ships) {
      if (sh.dead || sh.isPlayer) continue;
      if (sh.missionId && this.w.player.missions.some((m) => m.id === sh.missionId && m.status === 'active')) markers.push({ x: sh.x, y: sh.y, color: '#40ffb0', label: 'Target' });
      else if (this.cw.isHostile(s, sh) && dist2(sh.x, sh.y, s.x, s.y) < 4000 * 4000) markers.push({ x: sh.x, y: sh.y, color: '#ff5a4a' });
    }
    if (this.autopilot) markers.push({ x: this.autopilot.x, y: this.autopilot.y, color: '#46d0dc', label: this.autopilot.label });
    const route = (this.game as any).galaxyRoute as number[] | undefined;
    for (const m of markers) {
      const [mx, my] = cam.toScreen(m.x, m.y);
      if (mx > 20 && my > 60 && mx < W - 20 && my < H - 20) {
        if (m.label === 'Target') {
          g.strokeStyle = m.color;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(mx, my, 22, 0, Math.PI * 2);
          g.stroke();
        }
        continue;
      }
      const cx = W / 2, cy = H / 2;
      const a = Math.atan2(my - cy, mx - cx);
      const ex = clamp(cx + Math.cos(a) * W, 24, W - 24), ey = clamp(cy + Math.sin(a) * H, 70, H - 24);
      g.fillStyle = m.color;
      g.save();
      g.translate(ex, ey);
      g.rotate(a);
      g.beginPath();
      g.moveTo(9, 0);
      g.lineTo(-5, 6);
      g.lineTo(-5, -6);
      g.fill();
      g.restore();
    }
    void route;
    // cruise speed lines
    if (s.cruise) {
      g.strokeStyle = 'rgba(150,200,255,0.25)';
      g.lineWidth = 1;
      const a = Math.atan2(s.vy * cam.tilt, s.vx);
      for (let i = 0; i < 24; i++) {
        const x = ((i * 97 + this.t * 900) % (W + 200)) - 100;
        const y = (i * 53) % H;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - Math.cos(a) * 60, y - Math.sin(a) * 60);
        g.stroke();
      }
    }
    if (this.dead) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, 0, W, H);
    }
    void hexToRgb;
    void CELL;
    void HOSTILE_REP;
    void bus;
  }
}
