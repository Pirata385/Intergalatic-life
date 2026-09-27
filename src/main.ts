// Entry point: boots the game shell and registers all scenes.
import './styles.css';
import { Game } from './game';
import { MenuScene } from './scenes/menu';
import { GalaxyScene } from './scenes/galaxy';
import { SystemScene, SystemOpts } from './scenes/system';
import { PlanetScene } from './scenes/planet';
import { SurfaceScene } from './scenes/surface';
import { BuilderScene } from './scenes/builder';
import { ColonyScene } from './scenes/colony';
import { ArenaScene } from './scenes/arena';
import { renderShipSprite } from './ship/render';

function boot(): void {
  const app = document.getElementById('app')!;
  document.getElementById('boot')?.remove();
  const game = new Game(app);
  let systemScene: SystemScene | null = null;

  game.register('menu', () => {
    systemScene = null;
    return new MenuScene(game);
  });
  game.register('galaxy', () => new GalaxyScene(game));
  game.register('system', (opts: SystemOpts) => {
    const w = game.world!;
    // Resume the live scene if we are still in the same system; otherwise start fresh.
    if (opts.arrive === 'resume' && systemScene && systemScene.w === w && systemScene.sysId === w.player.sys) {
      systemScene.opts = opts;
      return systemScene;
    }
    systemScene = new SystemScene(game, opts.arrive === 'resume' ? { ...opts, arrive: 'station' } : opts);
    return systemScene;
  });
  game.register('planet', (opts) => new PlanetScene(game, opts));
  game.register('surface', (opts) => new SurfaceScene(game, opts));
  game.register('builder', (opts) => new BuilderScene(game, opts));
  game.register('colony', (opts) => new ColonyScene(game, opts ?? {}));
  game.register('arena', (opts) => new ArenaScene(game, opts));

  // debugging / automated test hooks
  (window as any).__game = game;
  (window as any).__renderShip = (d: any) => renderShipSprite(d, { barrels: true });
  game.go('menu');
  game.start();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
