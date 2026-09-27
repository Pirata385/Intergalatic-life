# Intergalactic Life

A 2.5D procedural space exploration, combat, trading, colonization and simulation game for the web — playable on desktop and mobile.

**Play:** open `docs/index.html` in any modern browser (it is a single self-contained file — no server or install needed), or enable GitHub Pages for the `docs/` folder.

## Features

- **Deterministic procedural universe** — every galaxy is generated from a seed: ~1,300 star systems in spiral arms, nebulae, binary stars, white dwarfs, neutron stars, black holes and a galactic core. Planets and moons get physically-motivated types (terran, ocean, jungle, arid, desert, tundra, ice, lava, toxic, barren, crystal, gas and ice giants), temperatures, atmospheres, habitability, resources, biospheres, rings and ancient ruins.
- **Living galaxy simulation** — factions keep evolving whether or not you are watching (and, optionally, while the game is closed): markets produce and consume goods, trade convoys run routes, pirates raid lanes, empires colonize, declare wars, besiege and capture systems, make peace and alliances, research technology and suffer rebellions from their own sub-factions.
- **Factions** — procedurally generated human powers (with governments, traits and sub-factions), three alien species with unique ships and behaviours (swarming bio-organic Hive, long-range crystalline Synod, relentless machine Automata) and pirate clans.
- **Real-time 2.5D flight & combat** — tilted orbital view, lit procedural planet spheres, stars with coronas, black holes with accretion disks, stations, asteroid belts. Ships are built from blocks: every shot damages an individual module, severed sections break off, reactors and magazines explode.
- **Voxel ship builder** — design ships block by block on hull frames of increasing size with 70+ modules (armor, thrusters, reactors, shields, lasers, pulse cannons, autocannons, railguns, missiles, torpedoes, ion cannons, plasma lances, drone bays, point defense, jump drives, cargo, crew, repair bays, cloaks, colony pods…), mirroring, undo/redo, painting, live stats/validation and a combat simulator.
- **Trading, mining & loot** — 17 commodities with supply-and-demand prices, contraband and customs scans, asteroid mining, salvage from wrecks, module drops, ammunition.
- **Planetary landing** — choose a landing site on the globe and explore chunked procedural terrain in a rover: mine deposits, excavate ruins, salvage wrecks, fight fauna and ancient sentinels, survive hazardous environments.
- **Colonies** — found colonies with a Colony Pod and manage them in an isometric city builder (housing, food, water, power, jobs, production chains, research, defense, events, exports). Also playable as a separate **Colony Mode** with its own victory condition.
- **Missions & progression** — procedural contracts (delivery, passengers, bounties, patrols, surveys, mining, smuggling, strikes, defense waves, raids, courier, salvage, rescue, escort, relief), XP and skills, reputation tiers, military enlistment with ranks, salary and equipment access, hireable wingmen.
- **Saves** — multiple compressed save slots in browser storage, autosave, and export/import to files.
- **Controls** — keyboard & mouse or touch (virtual joystick, fire/boost/cruise/target buttons, tap to select, pinch to zoom). Mobile players can force **portrait or landscape** in Settings; the game rotates itself when the device orientation differs, and can also request fullscreen orientation lock.

## Development

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + single-file build into dist/index.html
npm run build:docs # build and copy to docs/index.html
```

Tech stack: TypeScript, Canvas 2D (world rendering) + WebGL (close-up planet shading), DOM overlay UI, WebAudio (procedurally synthesised sound), Vite with a single-file bundle. No runtime dependencies.

Source layout (`src/`):

| Folder | Contents |
| --- | --- |
| `core/` | seeded RNG, simplex noise, math, names, compression, event bus |
| `data/` | commodities, ship modules, factions/ranks, colony buildings & research |
| `gen/` | galaxy, star systems, planet textures, surface terrain |
| `sim/` | world state, background simulation, faction AI, economy, missions, colonies |
| `ship/` | voxel designs & stats, procedural ship generation, pixel-art rendering, runtime ships, combat, AI |
| `render/` | camera, starfield, sprites, CPU & WebGL planet renderers, particles |
| `scenes/` | menu, galaxy map, system flight, planet orbit, surface, builder, arena, colony |
| `ui/` | DOM helpers, station, journal, settings, save/load |
