// Main menu: new campaign, continue, load, standalone Colony Mode, settings.
import type { Game, Scene } from '../game';
import { h, openModal, clear, toast } from '../ui/dom';
import { openSettings, controlsHelp, orientationButton } from '../ui/settingsui';
import { openSaveLoad } from '../ui/saveui';
import { latestCampaign, latestColony, loadColony } from '../save/save';
import { World } from '../sim/world';
import { RNG, hash } from '../core/rng';
import { personName } from '../core/names';
import { generatePlanetTexture, PlanetTexture } from '../gen/planet';
import { planetGL } from '../render/planetgl';
import { requestPlanetTexture } from '../render/texworker';
import { renderSphere } from '../render/planetcpu';
import type { Body, PlanetType } from '../gen/system';
import { PLANET_LABEL } from '../gen/system';
import { createColony } from '../sim/colony';
import { findLandSite } from '../gen/terrain';
import { audio } from '../audio/audio';
import { input } from '../input/input';

export function presetBody(type: PlanetType, seed: number, name: string): Body {
  const rng = new RNG(seed);
  const hab: Record<string, number> = { terran: 0.85, jungle: 0.75, ocean: 0.65, arid: 0.45, tundra: 0.4, desert: 0.32, ice: 0.18, barren: 0.12, toxic: 0.08, lava: 0.05, crystal: 0.2, gas: 0, icegiant: 0 };
  return {
    sysId: -1, index: 0, key: 'p0', name, type, seed, orbit: 3000, au: 1, period: 365, phase: 0, radius: 120, realRadius: 1, gravity: 1,
    temp: type === 'lava' ? 900 : type === 'ice' ? 150 : 288, atmosphere: type === 'terran' || type === 'jungle' || type === 'ocean' ? 'breathable' : type === 'toxic' ? 'toxic' : 'thin',
    habitability: hab[type] ?? 0.3,
    resources: { ore: rng.range(0.3, 0.9), ice: type === 'ice' || type === 'tundra' ? 0.8 : rng.range(0.1, 0.5), crystals: type === 'crystal' ? 0.9 : rng.range(0.05, 0.5), gas: 0, organics: rng.range(0.2, 0.8) },
    biosphere: ['terran', 'jungle', 'ocean'].includes(type) ? 0.7 : 0.1, ruins: rng.chance(0.3), rings: false, tilt: 0.2, rotSpeed: 0.05, moons: [], parent: null, landable: true,
  };
}

export class MenuScene implements Scene {
  name = 'menu';
  game: Game;
  tex: PlanetTexture | null = null;
  sprite: HTMLCanvasElement | null = null;
  t = 0;
  body: Body;

  constructor(game: Game) {
    this.game = game;
    this.body = presetBody('arid', 4242, 'Menu');
  }

  enter(): void {
    audio.setMood('menu');
    setTimeout(() => {
      this.tex = generatePlanetTexture(this.body, 256);
      if (planetGL().ok) planetGL().setTexture(this.tex);
      const hi = planetGL().ok ? (this.game.settings.quality === 'high' ? 1024 : 512) : 0;
      if (hi) requestPlanetTexture(this.body, hi).then((t) => {
        if (this.game.scene !== this) return;
        this.tex = t;
        planetGL().setTexture(t);
      });
    }, 30);
    this.buildMenu();
  }

  exit(): void {
    this.game.hud.innerHTML = '';
  }

  buildMenu(): void {
    const game = this.game;
    const hud = game.hud;
    clear(hud);
    const cont = latestCampaign();
    const col = latestColony();
    const colonyBtn = h('button', { class: 'btn', onclick: () => this.colonyMode() }, '⌂ Colony Mode', h('div', { class: 'tiny muted' }, 'Standalone colony builder'));
    const menu = h('div', { class: 'menu' },
      h('div', { class: 'menu-title' }, 'INTERGALACTIC', h('br'), 'LIFE'),
      h('div', { class: 'menu-sub' }, 'EXPLORE · TRADE · FIGHT · COLONIZE'),
      cont ? h('button', { class: 'btn primary', onclick: () => game.loadFrom(cont.slot) }, `▶ Continue — ${cont.name}`, h('div', { class: 'tiny muted' }, cont.detail)) : null,
      h('button', { class: 'btn', onclick: () => this.newGame() }, '✦ New Campaign'),
      h('button', { class: 'btn', onclick: () => openSaveLoad(game, 'load') }, '⤓ Load Game'),
      colonyBtn,
      h('button', { class: 'btn', onclick: () => openSettings(game) }, '⚙ Settings'),
      h('button', { class: 'btn', onclick: () => this.howTo() }, '? How to Play'),
      orientationButton(game, 'btn small'),
    );
    if (col) {
      colonyBtn.after(h('button', { class: 'btn', onclick: () => {
        const c = loadColony(col.slot);
        if (c) { game.colony = c; game.colonySlot = col.slot; game.go('colony', { standalone: true }); }
      } }, `⌂ Continue Colony — ${col.name}`, h('div', { class: 'tiny muted' }, col.detail)));
    }
    hud.append(menu, h('div', { class: 'menu-foot' }, 'v1.0 · procedural universe · seed-based'));
  }

  newGame(): void {
    const game = this.game;
    const rng = new RNG(Date.now() & 0xffffffff);
    let name = personName(rng);
    let seed = rng.int(1, 999999);
    let difficulty = 1;
    const body = h('div', { class: 'col' });
    const m = openModal('New Campaign', body, { wide: true });
    const step1 = () => {
      clear(body);
      const nameIn = h('input', { type: 'text', value: name, maxLength: 24, oninput: (e: Event) => (name = (e.target as HTMLInputElement).value) });
      const seedIn = h('input', { type: 'number', value: seed, oninput: (e: Event) => (seed = parseInt((e.target as HTMLInputElement).value) || 1) });
      body.append(
        h('p', null, 'Every galaxy is generated from a seed: the same seed always creates the same stars, planets, factions and aliens.'),
        h('div', { class: 'grid2' },
          h('label', { class: 'col' }, h('span', { class: 'small muted' }, 'Captain name'), nameIn),
          h('label', { class: 'col' }, h('span', { class: 'small muted' }, 'Galaxy seed'), h('div', { class: 'row nowrap' }, seedIn, h('button', { class: 'btn small', onclick: () => { seed = rng.int(1, 999999); seedIn.value = String(seed); } }, '🎲')))),
        h('div', { class: 'col' }, h('span', { class: 'small muted' }, 'Difficulty'),
          h('div', { class: 'row' }, ...([[0.7, 'Relaxed'], [1, 'Standard'], [1.4, 'Brutal']] as [number, string][]).map(([v, l]) =>
            h('button', { class: `btn small ${difficulty === v ? 'active' : ''}`, onclick: () => { difficulty = v; step1(); } }, l)))),
        h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => {
          clear(body);
          body.append(h('p', { class: 'center accent' }, 'Generating galaxy…'));
          setTimeout(step2, 30);
        } }, 'Generate Galaxy →')),
      );
    };
    let preview: World | null = null;
    let choice = 0;
    const step2 = () => {
      const t0 = performance.now();
      preview = World.create(seed, name || 'Captain', 0);
      console.log('world gen ms', performance.now() - t0);
      clear(body);
      const humans = preview.factions.filter((f) => f.kind === 'human');
      const aliens = preview.factions.filter((f) => f.kind === 'alien');
      const list = h('div', { class: 'grid2' });
      const drawList = () => {
        clear(list);
        humans.forEach((f, i) => {
          const wars = f.war.map((x) => preview!.factions[x].short).join(', ');
          list.append(h('div', { class: `choice ${choice === i ? 'sel' : ''}`, onclick: () => { choice = i; drawList(); } },
            h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: f.color } }), h('b', null, f.name)),
            h('div', { class: 'small muted' }, `${f.gov} · ${preview!.ownedSystems(f.id).length} systems · Tech ${f.tech}`),
            h('div', { class: 'tiny' }, `Aggression ${(f.traits.aggression * 100) | 0}% · Trade ${(f.traits.trade * 100) | 0}% · Xenophobia ${(f.traits.xenophobia * 100) | 0}%`),
            wars ? h('div', { class: 'tiny bad' }, `At war with: ${wars}`) : h('div', { class: 'tiny good' }, 'At peace')));
        });
      };
      drawList();
      body.append(
        h('p', null, 'Choose where your career begins. You start as an independent captain docked at one of this power\'s shipyards, on friendly terms with it.'),
        list,
        h('h4', null, 'Known alien species'),
        h('div', { class: 'col small' }, ...aliens.map((a) => h('div', null, h('span', { class: 'dot', style: { background: a.color } }), h('b', null, a.name), ' — ', h('span', { class: 'muted' }, a.desc)))),
        h('div', { class: 'row end' },
          h('button', { class: 'btn', onclick: step1 }, '← Back'),
          h('button', { class: 'btn primary', onclick: () => {
            m.close();
            const w = World.create(seed, name || 'Captain', choice);
            (w as any).difficulty = difficulty;
            w.player.credits = Math.round(w.player.credits / difficulty);
            game.world = w;
            game.planets.clear();
            game.go('system', { arrive: 'station', docked: true, intro: true });
          } }, 'Launch ✦')),
      );
    };
    step1();
  }

  colonyMode(): void {
    const game = this.game;
    const body = h('div', { class: 'col' });
    const m = openModal('Colony Mode', body, { wide: true });
    let type: PlanetType = 'terran';
    let difficulty = 1;
    let seed = (Math.random() * 99999) | 0;
    let name = 'New Haven';
    const types: PlanetType[] = ['terran', 'jungle', 'ocean', 'arid', 'desert', 'tundra', 'ice', 'toxic', 'lava', 'crystal', 'barren'];
    const draw = () => {
      clear(body);
      body.append(
        h('p', null, 'Govern a single colony from landing to a thriving world. Build habitats, farms and mines, balance power and jobs, research technologies, survive meteor strikes, plagues and pirate raids. Victory: build the Space Elevator with 3,000 colonists.'),
        h('h4', null, 'World type'),
        h('div', { class: 'row' }, ...types.map((t) => h('button', { class: `btn small ${type === t ? 'active' : ''}`, onclick: () => { type = t; draw(); } }, PLANET_LABEL[t]))),
        h('div', { class: 'grid2' },
          h('label', { class: 'col' }, h('span', { class: 'small muted' }, 'Colony name'), h('input', { type: 'text', value: name, oninput: (e: Event) => (name = (e.target as HTMLInputElement).value) })),
          h('label', { class: 'col' }, h('span', { class: 'small muted' }, 'World seed'), h('input', { type: 'number', value: seed, oninput: (e: Event) => (seed = parseInt((e.target as HTMLInputElement).value) || 1) }))),
        h('h4', null, 'Difficulty'),
        h('div', { class: 'row' }, ...([[0.7, 'Relaxed'], [1, 'Standard'], [1.5, 'Hardcore']] as [number, string][]).map(([v, l]) =>
          h('button', { class: `btn small ${difficulty === v ? 'active' : ''}`, onclick: () => { difficulty = v; draw(); } }, l))),
        h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => {
          m.close();
          const body = presetBody(type, hash(seed, type.length), name + ' Prime');
          const site = findLandSite(body);
          const c = createColony(1, name || 'New Haven', 'standalone', 0, body, site.lat, site.lon, type === 'ice' ? 0.5 : 1, difficulty);
          game.colony = c;
          game.colonySlot = 'colony_auto';
          game.go('colony', { standalone: true });
        } }, 'Found Colony ⌂')),
      );
    };
    draw();
  }

  howTo(): void {
    openModal('How to Play', [
      h('p', null, 'You are a starship captain in a living, procedurally generated galaxy. Factions trade, expand, wage war and rebel whether or not you are watching.'),
      h('div', { class: 'col small' },
        h('div', null, '🚀 ', h('b', null, 'Fly & fight'), ' in real time inside star systems. Every ship is built from blocks: shots destroy individual modules, so aim for engines, reactors or the bridge.'),
        h('div', null, '🗺 ', h('b', null, 'Galaxy map'), ' (M): plot jumps between stars. Jumps use fuel and take time — the galaxy moves on while you travel.'),
        h('div', null, '🏪 ', h('b', null, 'Dock at stations'), ' to trade goods, take missions, buy modules and ammo, repair, refuel, enlist in a navy or hire wingmen.'),
        h('div', null, '🛠 ', h('b', null, 'Ship builder'), ' at shipyards: design your ship block by block, then test it in the simulator.'),
        h('div', null, '🪐 ', h('b', null, 'Planets'), ': scan them for survey data, land to explore procedurally generated terrain, mine resources and loot ancient ruins.'),
        h('div', null, '⌂ ', h('b', null, 'Colonies'), ': install a Colony Pod and found a colony on any solid world, then manage it like a city builder. Your colonies pay taxes and export goods.'),
        h('div', null, '⭐ ', h('b', null, 'Progress'), ': earn XP and skills, build reputation, rise through military ranks and unlock better technology.')),
      h('hr'),
      controlsHelp(),
    ], { wide: true });
  }

  update(dt: number): void {
    this.t += dt;
    if (input.hit('Enter')) {
      const c = latestCampaign();
      if (c) this.game.loadFrom(c.slot);
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const game = this.game;
    const W = game.width, H = game.height;
    game.starfield.draw(g, W, H, this.t * 12, this.t * 4, '#3a1a5a', 0.35);
    // Star glow off to the side
    const portrait = H > W;
    const px = portrait ? W * 0.5 : W * 0.66, py = portrait ? H * 0.33 : H * 0.5;
    const size = Math.min(portrait ? W * 0.85 : W * 0.55, H * (portrait ? 0.48 : 0.82));
    const grd = g.createRadialGradient(W * 1.05, -H * 0.1, 0, W * 1.05, -H * 0.1, Math.max(W, H) * 0.9);
    grd.addColorStop(0, 'rgba(255,200,140,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    if (this.tex) {
      const light: [number, number, number] = [0.75, -0.45, 0.5];
      const gl = planetGL();
      if (gl.ok) {
        const c = gl.render(Math.round(size * game.dpr), this.t * 0.04, this.t * 0.055, light);
        const s = c.width / game.dpr;
        g.drawImage(c, px - s / 2, py - s / 2, s, s);
      } else {
        if (!this.sprite || Math.floor(this.t * 4) !== Math.floor((this.t - 0.016) * 4)) {
          this.sprite = renderSphere(this.tex, Math.min(360, Math.round(size)), { rotation: this.t * 0.04, lightX: 0.75, lightY: -0.45, lightZ: 0.5 }, this.sprite ?? undefined);
        }
        const s = size * 1.24;
        g.drawImage(this.sprite, px - s / 2, py - s / 2, s, s);
      }
    }
    void toast;
  }
}
