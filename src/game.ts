// Game shell: scene management, layout/orientation, main loop, persistence.
import { input } from './input/input';
import { audio } from './audio/audio';
import { Settings, loadSettings, saveSettings, isTouchDevice, qualityScale } from './settings';
import { World } from './sim/world';
import { bus } from './core/events';
import { initUI, toast, h, closeAllModals, topModal } from './ui/dom';
import { saveCampaign, loadCampaign, saveColony } from './save/save';
import { advanceTime } from './sim/simulation';
import { PlanetSprites } from './render/sprites';
import { Starfield } from './render/starfield';
import { generateGalaxy, Galaxy } from './gen/galaxy';
import type { ColonyState } from './sim/colony';

export interface Scene {
  name: string;
  enter(): void;
  exit(): void;
  update(dt: number): void;
  render(g: CanvasRenderingContext2D): void;
  onResize?(): void;
  onBack?(): boolean;
}

export class Game {
  app: HTMLElement;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  uiLayer: HTMLElement;
  hud: HTMLElement;
  width = 800;
  height = 600;
  dpr = 1;
  rotation = 0;
  settings: Settings;
  world: World | null = null;
  scene: Scene | null = null;
  colony: ColonyState | null = null;
  colonySlot = 'colony_auto';
  planets = new PlanetSprites(128);
  starfield: Starfield;
  time = 0;
  fps = 60;
  private last = 0;
  private autosaveT = 0;
  private fpsEl: HTMLElement;
  private galaxyCache = new Map<number, Galaxy>();
  private sceneFactory: Record<string, (...args: any[]) => Scene> = {};
  paused = false;
  touchMode = false;

  constructor(app: HTMLElement) {
    this.app = app;
    this.settings = loadSettings();
    this.canvas = h('canvas', { id: 'game' });
    this.uiLayer = h('div', { id: 'ui' });
    this.hud = h('div', { id: 'hud' });
    app.append(this.canvas, this.hud, this.uiLayer);
    this.g = this.canvas.getContext('2d', { alpha: false })!;
    initUI(this.uiLayer);
    this.fpsEl = h('div', { class: 'fps' });
    this.uiLayer.appendChild(this.fpsEl);
    this.starfield = new Starfield(7, qualityScale(this.settings.quality));
    input.attach(this.canvas);
    audio.setVolume(this.settings.volume);
    audio.setMusic(this.settings.music);
    audio.setSfx(this.settings.sfx);
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autosave();
    });
    window.addEventListener('beforeunload', () => this.autosave());
    bus.on('toast', (p: { text: string; kind?: 'good' | 'bad' | 'info' }) => toast(p.text, p.kind ?? 'info'));
    bus.on('sfx', (name: string) => audio.play(name, 0.5));
    bus.on('news', (n: { kind: string; text: string }) => {
      if (this.scene && (this.scene.name === 'system' || this.scene.name === 'galaxy') && ['war', 'peace', 'rebellion', 'alien', 'alliance'].includes(n.kind)) toast(`📰 ${n.text}`, n.kind === 'peace' || n.kind === 'alliance' ? 'good' : 'bad', 4500);
    });
    this.layout();
  }

  register(name: string, factory: (...args: any[]) => Scene): void {
    this.sceneFactory[name] = factory;
  }

  go(name: string, ...args: any[]): void {
    const f = this.sceneFactory[name];
    if (!f) throw new Error('No scene ' + name);
    closeAllModals();
    if (this.scene) this.scene.exit();
    this.hud.innerHTML = '';
    this.scene = f(...args);
    this.scene.enter();
    this.app.dataset.scene = name;
  }

  isTouch(): boolean {
    if (this.settings.controls === 'touch') return true;
    if (this.settings.controls === 'desktop') return false;
    return isTouchDevice() && input.lastType !== 'mouse';
  }

  galaxy(seed: number): Galaxy {
    let g = this.galaxyCache.get(seed);
    if (!g) {
      g = generateGalaxy(seed);
      this.galaxyCache.clear();
      this.galaxyCache.set(seed, g);
    }
    return g;
  }

  // ------------------------------------------------------------------ layout & orientation
  layout(): void {
    const W = window.innerWidth, H = window.innerHeight;
    const pref = this.settings.orientation;
    const actualPortrait = H > W;
    const rotate = (pref === 'portrait' && !actualPortrait) || (pref === 'landscape' && actualPortrait);
    const s = this.app.style;
    if (rotate) {
      this.width = H;
      this.height = W;
      s.width = H + 'px';
      s.height = W + 'px';
      s.transformOrigin = '0 0';
      if (this.settings.flip) {
        s.transform = `translate(0px, ${H}px) rotate(-90deg)`;
        this.rotation = -90;
      } else {
        s.transform = `translate(${W}px, 0px) rotate(90deg)`;
        this.rotation = 90;
      }
    } else {
      this.width = W;
      this.height = H;
      s.width = W + 'px';
      s.height = H + 'px';
      s.transform = 'none';
      this.rotation = 0;
    }
    const rot = this.rotation;
    input.toLocal = (cx, cy) => {
      if (rot === 90) return [cy, W - cx];
      if (rot === -90) return [H - cy, cx];
      return [cx, cy];
    };
    const q = qualityScale(this.settings.quality);
    this.dpr = Math.min(window.devicePixelRatio || 1, q >= 1 ? 2 : q >= 0.7 ? 1.5 : 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    const portrait = this.height > this.width;
    this.app.classList.toggle('portrait', portrait);
    this.app.classList.toggle('landscape', !portrait);
    this.app.classList.toggle('compact', Math.min(this.width, this.height) < 560);
    this.app.style.setProperty('--ui-scale', String(this.settings.uiScale));
    this.touchMode = this.isTouch();
    this.app.classList.toggle('touch', this.touchMode);
    this.scene?.onResize?.();
  }

  async requestFullscreenOrientation(): Promise<void> {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      const pref = this.settings.orientation;
      const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (pref !== 'auto' && so?.lock) await so.lock(pref === 'landscape' ? 'landscape' : 'portrait');
    } catch {
      /* orientation lock unsupported: CSS rotation fallback stays active */
    }
    setTimeout(() => this.layout(), 250);
  }

  applySettings(): void {
    saveSettings(this.settings);
    audio.setVolume(this.settings.volume);
    audio.setMusic(this.settings.music);
    audio.setSfx(this.settings.sfx);
    this.starfield = new Starfield(7, qualityScale(this.settings.quality));
    this.layout();
  }

  // ------------------------------------------------------------------ loop
  start(): void {
    const frame = (t: number) => {
      const dt = Math.min(0.05, Math.max(0.0001, (t - this.last) / 1000 || 0.016));
      this.last = t;
      this.time += dt;
      this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
      try {
        if (input.hit('Escape')) this.handleBack();
        this.planets.budget = 1;
        if (this.scene && !this.paused) this.scene.update(dt);
        if (this.scene) {
          const g = this.g;
          g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
          this.scene.render(g);
        }
      } catch (e) {
        console.error(e);
      }
      input.endFrame();
      const touch = this.isTouch();
      if (touch !== this.touchMode) {
        this.touchMode = touch;
        this.app.classList.toggle('touch', touch);
      }
      this.fpsEl.textContent = this.settings.showFps ? `${this.fps.toFixed(0)} fps` : '';
      this.autosaveT += dt;
      if (this.autosaveT > 90) {
        this.autosaveT = 0;
        if (this.settings.autosave) this.autosave();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  handleBack(): void {
    const m = topModal();
    if (m) {
      m.close();
      return;
    }
    if (this.scene?.onBack?.()) return;
  }

  // ------------------------------------------------------------------ persistence
  autosave(): void {
    try {
      if (this.world && this.scene && this.scene.name !== 'menu' && this.scene.name !== 'arena') {
        (this.scene as any).syncBeforeSave?.();
        saveCampaign('auto', this.world.toSave());
      }
      if (this.colony && this.colony.mode === 'standalone' && this.scene?.name === 'colony') saveColony(this.colonySlot, this.colony);
    } catch (e) {
      console.warn('autosave failed', e);
    }
  }

  saveTo(slot: string): boolean {
    if (!this.world) return false;
    (this.scene as any)?.syncBeforeSave?.();
    const ok = saveCampaign(slot, this.world.toSave());
    toast(ok ? 'Game saved.' : 'Saved for this session only (browser storage unavailable). Use Export to keep a copy.', ok ? 'good' : 'bad');
    return ok;
  }

  loadFrom(slot: string): boolean {
    const data = loadCampaign(slot);
    if (!data) {
      toast('Save could not be loaded.', 'bad');
      return false;
    }
    this.loadData(data);
    return true;
  }

  loadData(data: any): void {
    const galaxy = this.galaxy(data.seed);
    const w = World.fromSave(data, galaxy);
    // Offline progression: the galaxy kept living while you were away.
    if (this.settings.offlineSim && data.realTime) {
      const hours = (Date.now() - data.realTime) / 3600000;
      const days = Math.min(30, Math.floor(hours));
      if (days >= 1) {
        advanceTime(w, days, -1);
        setTimeout(() => toast(`While you were away, ${days} day${days > 1 ? 's' : ''} passed in the galaxy.`, 'info', 5000), 600);
      }
    }
    this.world = w;
    this.planets.clear();
    this.go('system', { arrive: 'station' });
  }
}
