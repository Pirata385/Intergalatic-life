// Docked station interface.
import type { Game } from '../game';
import type { SystemScene } from '../scenes/system';
import type { StationEnt } from '../ship/combat';
import { h, clear, openModal, toast, fmtCr, tabs, bar, confirmDialog, add } from './dom';
import { COMMODITIES, ECONOMY_LABEL, C } from '../data/commodities';
import { MODULES, MODULE_MAP, AMMO, AmmoType, FRAMES, RARITY_COLOR } from '../data/modules';
import { RANKS, RANK_MERIT, RANK_SALARY, rankTier, repTier, SUBFACTION_TEMPLATES } from '../data/factions';
import { cargoUsed, playerStats, changeRep, wingmanSlots, addXp } from '../player/player';
import { missionBoard, acceptMission, completeMission } from '../sim/missions';
import { computeStats, designValue, cloneDesign, ShipClass } from '../ship/design';
import { moduleIcon, renderShipSprite } from '../ship/render';
import { RNG, hash } from '../core/rng';
import { personName } from '../core/names';
import { CLASS_LABEL } from '../ship/shipgen';
import { sysDist, systemsNear } from '../gen/galaxy';
import { audio } from '../audio/audio';
import type { Wingman } from '../sim/types';

export function openStation(game: Game, scene: SystemScene, stn: StationEnt, onClose: () => void): void {
  const w = game.world!;
  const p = w.player;
  const sysId = p.sys;
  const st = w.systems[sysId];
  const sys = w.sysData[sysId];
  const fac = stn.faction > 0 ? w.factions[stn.faction] : null;
  const pirateBase = stn.type === 'pirate';
  const names: string[] = [];
  if (stn.type !== 'colony' || st.stock) names.push('Market');
  names.push('Missions');
  if (stn.type !== 'colony') names.push('Outfitting');
  if (stn.type === 'shipyard' || (st.shipyard && stn.type === 'trade') || pirateBase) names.push('Shipyard');
  if (fac && fac.kind !== 'pirate' && (stn.type === 'military' || (sysId === fac.capital && stn.type === 'trade'))) names.push('Military');
  if (stn.type === 'trade' || pirateBase) names.push('Bar');
  if (stn.type === 'colony') names.push('Colony');
  names.push('Info');

  const head = h('div', { class: 'st-head' });
  const drawHead = () => {
    clear(head);
    const stats = playerStats(p, p.hp.map((x) => x > 0));
    add(head,
      fac ? h('span', { class: 'fac' }, h('span', { class: 'dot', style: { background: fac.color } }), fac.name, ' · ', h('span', { style: { color: repTier(p.rep[fac.id]).color } }, repTier(p.rep[fac.id]).name)) : h('span', { class: 'fac muted' }, stn.type === 'colony' ? 'Your colony' : 'Independent'),
      h('span', { class: 'mono gold' }, fmtCr(p.credits)),
      h('span', { class: 'mono small' }, `Cargo ${cargoUsed(p)}/${stats.cargo}`),
      h('span', { class: 'mono small' }, `Fuel ${Math.floor(p.fuel)}/${stats.fuel}`),
      h('span', { class: 'mono small' }, `Day ${Math.floor(w.day)}`));
  };
  let tabEl: HTMLElement;
  const refresh = () => {
    drawHead();
    (tabEl as any).redraw();
  };
  tabEl = tabs(names, (name, body) => {
    switch (name) {
      case 'Market': marketTab(body); break;
      case 'Missions': missionsTab(body); break;
      case 'Outfitting': outfitTab(body); break;
      case 'Shipyard': shipyardTab(body); break;
      case 'Military': militaryTab(body); break;
      case 'Bar': barTab(body); break;
      case 'Colony': colonyTab(body); break;
      case 'Info': infoTab(body); break;
    }
  });
  drawHead();
  const m = openModal(`${stn.name} — ${sys.name}`, [head, tabEl, h('div', { class: 'row end', style: 'margin-top:0.6em' },
    h('button', { class: 'btn primary', onclick: () => m.close() }, '🚀 Launch'))], { wide: true, onClose: () => { onClose(); } });

  // ------------------------------------------------------------------ market
  function marketTab(body: HTMLElement): void {
    if (!st.stock) {
      body.append(h('p', { class: 'muted' }, 'No market here.'));
      return;
    }
    const stats = playerStats(p, p.hp.map((x) => x > 0));
    const table = h('table', { class: 'table' },
      h('tr', null, h('th', null, 'Commodity'), h('th', { class: 'num' }, 'Buy'), h('th', { class: 'num' }, 'Sell'), h('th', { class: 'num' }, 'Stock'), h('th', { class: 'num' }, 'Hold'), h('th', null, '')));
    for (const c of COMMODITIES) {
      if (c.key === 'pax') continue;
      const buy = w.buyPrice(sysId, c.id), sell = w.sellPrice(sysId, c.id);
      const illegal = w.isIllegal(sysId, c.id) && !pirateBase;
      const ratio = w.price(sysId, c.id) / c.base;
      const free = stats.cargo - cargoUsed(p);
      const stock = Math.floor(st.stock[c.id]);
      const maxBuy = Math.max(0, Math.min(free, stock, Math.floor(p.credits / buy)));
      const doBuy = (n: number) => {
        n = Math.min(n, maxBuy);
        if (n <= 0) return void audio.play('deny');
        p.credits -= buy * n;
        p.cargo[c.id] += n;
        st.stock![c.id] -= n;
        audio.play('ui', 0.3);
        refresh();
      };
      const doSell = (n: number) => {
        n = Math.min(n, p.cargo[c.id]);
        if (n <= 0) return;
        if (illegal) return void toast('Illegal here. Find a black market or a smuggling contract.', 'bad');
        const reserved = p.missions.filter((mi) => mi.status === 'active' && (mi.type === 'delivery' || mi.type === 'passenger' || mi.type === 'smuggle') && mi.commodity === c.id).reduce((a, mi) => a + mi.qty, 0);
        const sellable = Math.max(0, p.cargo[c.id] - reserved);
        n = Math.min(n, sellable);
        if (n <= 0) return void toast('That cargo is reserved for a mission.', 'bad');
        p.credits += sell * n;
        p.totalEarned += sell * n;
        p.cargo[c.id] -= n;
        st.stock![c.id] += n;
        addXp(p, (sell * n) / 800);
        audio.play('ui', 0.3);
        refresh();
      };
      table.append(h('tr', null,
        h('td', null, `${c.icon} ${c.name}`, illegal ? h('span', { class: 'tag bad', style: 'margin-left:0.4em' }, 'ILLEGAL') : null),
        h('td', { class: `num ${ratio < 0.8 ? 'price-up' : ratio > 1.3 ? 'price-down' : ''}` }, String(buy)),
        h('td', { class: 'num' }, String(sell)),
        h('td', { class: 'num muted' }, String(stock)),
        h('td', { class: 'num' }, p.cargo[c.id] ? String(p.cargo[c.id]) : '·'),
        h('td', null, h('div', { class: 'row nowrap' },
          h('button', { class: 'btn tiny', onclick: () => doBuy(1) }, '+1'),
          h('button', { class: 'btn tiny', onclick: () => doBuy(10) }, '+10'),
          h('button', { class: 'btn tiny', onclick: () => doBuy(9999) }, 'Max'),
          h('button', { class: 'btn tiny', onclick: () => doSell(1) }, '−1'),
          h('button', { class: 'btn tiny', onclick: () => doSell(9999) }, 'All')))));
    }
    body.append(h('div', { class: 'small muted' }, `${ECONOMY_LABEL[st.econ]} economy · green prices are cheap here, red are expensive.`), h('div', { class: 'scroll', style: 'max-height:55vh;overflow-x:auto' }, table));
  }

  // ------------------------------------------------------------------ missions
  function missionsTab(body: HTMLElement): void {
    if (fac && w.hostile(0, fac.id)) {
      body.append(h('p', { class: 'bad' }, 'Nobody here will work with you.'));
      return;
    }
    const active = p.missions.filter((mi) => mi.status === 'active');
    if (active.length) {
      body.append(h('h4', null, `Active (${active.length}/8)`));
      for (const mi of active) {
        const deliverHere = (mi.type === 'mining' || mi.type === 'supply' || mi.type === 'delivery' || mi.type === 'smuggle' || mi.type === 'passenger') && mi.target === sysId;
        add(body, h('div', { class: 'card small' }, h('div', { class: 'row between' }, h('b', null, mi.title), h('span', { class: 'mono gold' }, fmtCr(mi.reward))),
          h('div', { class: 'muted' }, mi.desc), deliverHere ? h('div', { class: p.cargo[mi.commodity] >= mi.qty ? 'good' : 'warn' },
            `Deliver here: ${p.cargo[mi.commodity]}/${mi.qty} ${COMMODITIES[mi.commodity].name}`,
            p.cargo[mi.commodity] >= mi.qty ? h('button', { class: 'btn small good', style: 'margin-left:0.5em', onclick: () => { p.cargo[mi.commodity] -= mi.qty; completeMission(w, mi); refresh(); } }, 'Deliver') : null) : null));
      }
    }
    const board = missionBoard(w, sysId);
    body.append(h('h4', null, 'Available contracts'));
    if (!board.length) body.append(h('p', { class: 'muted' }, 'No work available this week.'));
    for (const mi of board) {
      const sub = fac && mi.sub >= 0 ? fac.subs[mi.sub] : null;
      add(body, h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('b', null, mi.title), h('span', { class: 'mono gold' }, fmtCr(mi.reward))),
        h('div', { class: 'small' }, mi.desc),
        h('div', { class: 'row small muted' },
          sub ? h('span', null, `From: ${sub.name}`) : null,
          mi.deadline ? h('span', null, `Deadline: day ${mi.deadline}`) : null,
          mi.target >= 0 ? h('span', null, `Target: ${w.sysData[mi.target].name} (${sysDist(sys, w.sysData[mi.target]).toFixed(1)} ly)`) : null,
          mi.military ? h('span', { class: 'tag accent' }, `MILITARY${mi.minRank > 0 ? ' · ' + RANKS[mi.minRank] : ''}`) : null,
          mi.merit ? h('span', null, `+${mi.merit} merit`) : null),
        h('div', { class: 'row end' }, h('button', { class: 'btn primary small', onclick: () => {
          const err = acceptMission(w, mi);
          if (err) toast(err, 'bad');
          refresh();
        } }, 'Accept'))));
    }
  }

  // ------------------------------------------------------------------ outfitting
  function outfitTab(body: HTMLElement): void {
    const design = p.design;
    const stats = computeStats(design, p.hp.map((x) => x > 0));
    // Repair
    let repairCost = 0;
    design.modules.forEach((mm, i) => {
      const def = MODULE_MAP[mm.id];
      const frac = p.hp[i] ?? 1;
      if (frac < 1) repairCost += def.cost * (frac <= 0 ? 0.35 : (1 - frac) * 0.18) + 2;
    });
    repairCost = Math.round(repairCost * (fac && p.military?.faction === fac.id ? 0.7 : 1));
    const fuelPrice = Math.max(4, Math.round(w.price(sysId, C.fuel) * 0.35));
    const fuelNeed = Math.max(0, Math.floor(stats.fuel - p.fuel));
    const hullFrac = p.hp.reduce((a, x, i) => a + x * (MODULE_MAP[design.modules[i].id]?.hp ?? 0), 0) / Math.max(1, design.modules.reduce((a, mm) => a + (MODULE_MAP[mm.id]?.hp ?? 0), 0));
    add(body, h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', null, '🔧 Repairs'), bar(hullFrac, '#e0a040', `Hull ${(hullFrac * 100).toFixed(0)}%`),
        h('div', { class: 'row', style: 'margin-top:0.4em' }, h('button', { class: `btn ${repairCost <= 0 || p.credits < repairCost ? 'disabled' : 'primary'}`, onclick: () => {
          p.credits -= repairCost;
          p.hp = p.hp.map(() => 1);
          audio.play('build', 0.4);
          scene.rebuildPlayerShip();
          refresh();
        } }, repairCost > 0 ? `Repair all (${fmtCr(repairCost)})` : 'No damage'))),
      h('div', { class: 'card' }, h('h3', null, '⛽ Fuel'), bar(p.fuel / Math.max(1, stats.fuel), '#f0c050', `${Math.floor(p.fuel)}/${stats.fuel}`),
        h('div', { class: 'row', style: 'margin-top:0.4em' },
          h('button', { class: `btn ${fuelNeed <= 0 ? 'disabled' : 'primary'}`, onclick: () => {
            const n = Math.min(fuelNeed, Math.floor(p.credits / fuelPrice));
            p.credits -= n * fuelPrice;
            p.fuel += n;
            refresh();
          } }, fuelNeed > 0 ? `Refuel (${fmtCr(fuelNeed * fuelPrice)})` : 'Tanks full'),
          p.cargo[C.fuel] > 0 && fuelNeed > 0 ? h('button', { class: 'btn small', onclick: () => {
            const n = Math.min(fuelNeed, p.cargo[C.fuel] * 5);
            p.cargo[C.fuel] -= Math.ceil(n / 5);
            p.fuel += n;
            refresh();
          } }, 'Use cargo fuel') : null))));
    // Ammo
    const ammoCard = h('div', { class: 'card' }, h('h3', null, '💥 Ammunition'));
    let anyAmmo = false;
    for (const t of Object.keys(AMMO) as AmmoType[]) {
      const cap = stats.ammoCap[t];
      if (!cap) continue;
      anyAmmo = true;
      const have = Math.floor(p.ammo[t] ?? 0);
      const need = Math.max(0, cap - have);
      const price = AMMO[t].price;
      ammoCard.append(h('div', { class: 'row between small' }, h('span', null, `${AMMO[t].name}: ${have}/${cap}`),
        h('button', { class: `btn tiny ${need <= 0 ? 'disabled' : ''}`, onclick: () => {
          const n = Math.min(need, Math.floor(p.credits / price));
          p.credits -= n * price;
          p.ammo[t] = have + n;
          scene.rebuildPlayerShip();
          refresh();
        } }, need > 0 ? `Fill (${fmtCr(need * price)})` : 'Full')));
    }
    if (!anyAmmo) ammoCard.append(h('p', { class: 'small muted' }, 'Your weapons use no ammunition.'));
    body.append(ammoCard);
    // Module shop
    const maxTier = shopTier();
    const species = shopSpecies();
    const shop = MODULES.filter((md) => md.tier <= maxTier && species.includes(md.species) && md.id !== 'cloak').sort((a, b) => a.cat.localeCompare(b.cat) || a.cost - b.cost);
    const priceMult = pirateBase ? 1.25 : fac && p.military?.faction === fac.id ? 0.85 : 1;
    const grid = h('div', { class: 'grid3' });
    for (const md of shop) {
      const price = Math.round(md.cost * priceMult);
      const owned = p.modules[md.id] ?? 0;
      grid.append(h('div', { class: 'card row nowrap', style: 'margin:0;padding:0.4em' },
        moduleIcon(md.id, 36),
        h('div', { class: 'grow small' }, h('div', { style: { color: RARITY_COLOR[md.rarity] } }, md.name), h('div', { class: 'tiny muted' }, `${fmtCr(price)}${owned ? ` · own ${owned}` : ''}`)),
        h('div', { class: 'col', style: 'gap:0.2em' },
          h('button', { class: `btn tiny ${p.credits < price ? 'disabled' : ''}`, onclick: () => { p.credits -= price; p.modules[md.id] = owned + 1; refresh(); } }, 'Buy'),
          owned ? h('button', { class: 'btn tiny', onclick: () => { p.modules[md.id] = owned - 1; p.credits += Math.round(md.cost * 0.5); refresh(); } }, 'Sell') : null)));
    }
    add(body, h('h4', null, `Module market (tier ≤ ${maxTier})`), h('p', { class: 'small muted' }, 'Bought modules go to your spare parts inventory. Install them in the Ship Builder at a shipyard. Salvaged modules sell for 50%.'), grid);
    // Spare modules not sold here
    const spare = Object.entries(p.modules).filter(([id, n]) => n > 0 && !shop.some((x) => x.id === id));
    if (spare.length) {
      body.append(h('h4', null, 'Your salvaged / exotic modules'));
      const g2 = h('div', { class: 'grid3' });
      for (const [id, n] of spare) {
        const md = MODULE_MAP[id];
        g2.append(h('div', { class: 'card row nowrap', style: 'margin:0;padding:0.4em' }, moduleIcon(id, 36),
          h('div', { class: 'grow small' }, h('div', { style: { color: RARITY_COLOR[md.rarity] } }, md.name), h('div', { class: 'tiny muted' }, `×${n}`)),
          h('button', { class: 'btn tiny', onclick: () => { p.modules[id] = n - 1; p.credits += Math.round(md.cost * 0.5); refresh(); } }, `Sell ${fmtCr(md.cost * 0.5)}`)));
      }
      body.append(g2);
    }
  }

  function shopTier(): number {
    const t = st.tech;
    let tier = Math.min(t, 3);
    if (fac && p.military?.faction === fac.id) tier = Math.max(tier, rankTier(p.military.rank));
    if (fac && p.rep[fac.id] >= 45) tier = Math.max(tier, Math.min(4, t + 1));
    if (pirateBase) tier = 3;
    return Math.min(5, tier);
  }

  function shopSpecies(): string[] {
    const s = ['human'];
    if (fac?.species === 'synod' && p.rep[fac.id] >= 15) s.push('synod');
    if (pirateBase) s.push('hive', 'automata');
    return s;
  }

  // ------------------------------------------------------------------ shipyard
  function shipyardTab(body: HTMLElement): void {
    const stats = computeStats(p.design, p.hp.map((x) => x > 0));
    const value = designValue(p.design);
    const sprite = renderShipSprite(p.design, { px: 6 });
    sprite.style.imageRendering = 'pixelated';
    sprite.style.maxWidth = '100%';
    add(body, h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h3', null, `Current ship: ${p.design.name}`), h('span', { class: 'mono' }, `Value ${fmtCr(value)}`)),
      h('div', { class: 'center' }, sprite),
      h('div', { class: 'small muted' }, `${stats.blocks} blocks · ${stats.dps.toFixed(0)} DPS · ${stats.hp} HP · shield ${stats.shieldCap} · speed ${stats.maxSpeed.toFixed(0)} · cargo ${stats.cargo} · jump ${stats.jump} ly`),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => { m.close(); scene.syncBeforeSave(); game.go('builder', { returnTo: 'system' }); } }, '🛠 Open Ship Builder'),
        p.hangar.length < 5 ? h('button', { class: 'btn', onclick: () => { p.hangar.push(cloneDesign(p.design)); toast('Design copy stored in hangar.', 'good'); refresh(); } }, 'Save design copy to hangar') : null)));
    // Frames
    const frames = h('div', { class: 'grid2' });
    for (const fr of FRAMES) {
      const own = p.frames.includes(fr.id);
      const lockedTier = fr.tier > shopTier();
      frames.append(h('div', { class: 'card small', style: 'margin:0' }, h('b', null, fr.name), h('div', { class: 'muted' }, fr.desc),
        own ? h('span', { class: 'good' }, 'Owned') : lockedTier ? h('span', { class: 'bad' }, `Requires tech/rank tier ${fr.tier}`) :
          h('button', { class: `btn small ${p.credits < fr.cost ? 'disabled' : 'primary'}`, onclick: () => { p.credits -= fr.cost; p.frames.push(fr.id); toast(`${fr.name} purchased. Select it in the Ship Builder.`, 'good'); refresh(); } }, `Buy ${fmtCr(fr.cost)}`)));
    }
    add(body, h('h4', null, 'Hull frames (larger build grids)'), frames);
    // Premade ships
    if (fac && !w.hostile(0, fac.id)) {
      const classes: ShipClass[] = ['scout', 'corvette', 'miner', 'freighter', 'colony', 'frigate', 'destroyer'];
      if (fac.tech >= 3) classes.push('cruiser');
      const list = h('div', { class: 'grid2' });
      for (const cls of classes) {
        const d = w.design(fac.id, cls, 0);
        const s2 = computeStats(d);
        const price = Math.round(designValue(d) * (pirateBase ? 1.3 : 1.1));
        const trade = Math.round(value * 0.7);
        const spr = renderShipSprite(d, { px: 4 });
        spr.style.imageRendering = 'pixelated';
        spr.style.maxWidth = '100%';
        list.append(h('div', { class: 'card small', style: 'margin:0' }, h('div', { class: 'row between' }, h('b', null, `${CLASS_LABEL[cls]}`), h('span', { class: 'mono gold' }, fmtCr(price))),
          h('div', { class: 'center' }, spr),
          h('div', { class: 'muted' }, `${s2.dps.toFixed(0)} DPS · ${s2.hp} HP · shield ${s2.shieldCap} · cargo ${s2.cargo} · jump ${s2.jump} ly`),
          h('button', { class: `btn small ${p.credits + trade < price ? 'disabled' : ''}`, onclick: () => confirmDialog('Buy ship', `Buy this ${CLASS_LABEL[cls]} for ${fmtCr(price)}? Your current ship is traded in for ${fmtCr(trade)} (spare modules and cargo are kept).`, () => {
            p.credits += trade - price;
            const nd = cloneDesign(d);
            // factory hulls come fully crewed; custom refits must provide crew quarters
            nd.key = 'custom_' + Date.now().toString(36);
            nd.name = `${CLASS_LABEL[cls]} ${nd.name.split(' ')[0]}`;
            nd.frame = FRAMES.find((f) => f.w >= nd.w && f.h >= nd.h)?.id ?? 'capital';
            if (!p.frames.includes(nd.frame)) p.frames.push(nd.frame);
            p.design = nd;
            p.hp = nd.modules.map(() => 1);
            p.fuel = computeStats(nd).fuel;
            scene.rebuildPlayerShip();
            toast('New ship delivered!', 'good');
            refresh();
          }, 'Buy') }, `Buy (trade-in −${fmtCr(trade)})`)));
      }
      add(body, h('h4', null, `${fac.name} hulls`), list);
    }
    // Hangar
    if (p.hangar.length) {
      body.append(h('h4', null, 'Hangar'));
      p.hangar.forEach((d, i) => {
        body.append(h('div', { class: 'card row between small' }, h('span', null, `${d.name} (${d.w}×${d.h}, ${d.modules.length} modules)`),
          h('div', { class: 'row' },
            h('button', { class: 'btn tiny', onclick: () => {
              const cur = cloneDesign(p.design);
              p.design = cloneDesign(d);
              p.hangar[i] = cur;
              p.hp = p.design.modules.map(() => 1);
              scene.rebuildPlayerShip();
              toast(`Switched to ${p.design.name}. (Missing modules must be bought in the builder.)`, 'info');
              refresh();
            } }, 'Swap in'),
            h('button', { class: 'btn tiny danger', onclick: () => { p.hangar.splice(i, 1); refresh(); } }, 'Delete'))));
      });
    }
  }

  // ------------------------------------------------------------------ military
  function militaryTab(body: HTMLElement): void {
    if (!fac) return;
    const mil = p.military;
    const rep = p.rep[fac.id];
    if (mil && mil.faction === fac.id) {
      const next = mil.rank < RANKS.length - 1 ? RANK_MERIT[mil.rank + 1] : null;
      add(body, h('div', { class: 'card' }, h('h3', null, `${RANKS[mil.rank]} of the ${fac.name}`),
        next ? bar((mil.merit - RANK_MERIT[mil.rank]) / (next - RANK_MERIT[mil.rank]), '#ffd040', `Merit ${mil.merit} / ${next}`) : h('div', { class: 'gold' }, 'Highest rank achieved.'),
        h('div', { class: 'kv', style: 'margin-top:0.5em' },
          'Weekly salary', fmtCr(RANK_SALARY[mil.rank]),
          'Equipment access', `Tier ${rankTier(mil.rank)} modules`,
          'Wingman slots', `+${Math.floor(mil.rank / 2)}`,
          'Mission pay bonus', `+${mil.rank * 10}%`,
          'Discounts', '15% modules, 30% repairs'),
        h('p', { class: 'small muted' }, 'Earn merit by completing military missions and destroying enemies of the realm. Military contracts appear on mission boards.'),
        h('div', { class: 'row end' }, h('button', { class: 'btn danger small', onclick: () => confirmDialog('Resign commission', 'Resign from the navy? You will lose your rank and some standing.', () => {
          p.military = null;
          changeRep(w, fac.id, -10, 'resigned');
          refresh();
        }, 'Resign') }, 'Resign'))));
      const wars = fac.war.map((x) => w.factions[x]).filter((f) => f.alive);
      body.append(h('div', { class: 'card small' }, h('h3', null, 'War room'), wars.length ? h('div', null, ...wars.map((e) => h('div', null, h('span', { class: 'dot', style: { background: e.color } }), `${e.name} — exhaustion ${(fac.exhaustion[e.id] ?? 0).toFixed(0)}`))) : h('div', { class: 'muted' }, 'The realm is at peace.')));
    } else if (mil) {
      body.append(h('p', null, `You already serve the ${w.factions[mil.faction].name}. Resign there first.`));
    } else {
      const ok = rep >= 15;
      add(body, h('div', { class: 'card' }, h('h3', null, `Enlist in the ${fac.name} Navy`),
        h('p', null, 'Join the navy to gain a salary, access to military-grade equipment, wingmen, and military contracts. Enemies of the realm will become your enemies.'),
        h('div', { class: 'small' }, `Requires standing Friendly (15). Yours: ${rep.toFixed(0)}`),
        fac.war.length ? h('div', { class: 'small warn' }, `At war with: ${fac.war.map((x) => w.factions[x].name).join(', ')}`) : null,
        h('button', { class: `btn primary ${ok ? '' : 'disabled'}`, onclick: () => {
          p.military = { faction: fac.id, rank: 0, merit: 0, joined: Math.floor(w.day) };
          p.lastSalary = Math.floor(w.day);
          for (const e of fac.war) p.rep[e] = Math.min(p.rep[e], -30);
          changeRep(w, fac.id, 5, 'enlisted');
          toast(`Welcome aboard, Recruit ${p.name}.`, 'good');
          w.addNews(`${p.name} enlists in the ${fac.name} navy.`, 'player', sysId);
          refresh();
        } }, 'Enlist')));
    }
  }

  // ------------------------------------------------------------------ bar
  function barTab(body: HTMLElement): void {
    const week = Math.floor(w.day / 7);
    const rng = new RNG(hash(sysId, week, 0xba7));
    const stats = computeStats(p.design);
    const slots = wingmanSlots(p, stats.leadership);
    body.append(h('h4', null, `Pilots for hire (${p.wingmen.length}/${slots} wingmen)`));
    const hired = new Set(p.wingmen.map((x) => x.id));
    const n = rng.int(2, 4);
    const fid = fac ? fac.id : w.factions.find((f) => f.kind === 'human')!.id;
    for (let i = 0; i < n; i++) {
      const cls = rng.pick(['fighter', 'corvette', 'corvette', 'frigate', 'destroyer'] as ShipClass[]);
      const skill = rng.int(1, 5);
      const wm: Wingman = { id: `${sysId}_${week}_${i}`, name: personName(rng), cls, faction: fid, v: rng.int(0, 1), hp: 1, wage: Math.round((cls === 'destroyer' ? 180 : cls === 'frigate' ? 110 : cls === 'corvette' ? 70 : 45) * (1 + skill * 0.15) * (1 - p.skills.leadership * 0.04)), skill, kills: 0 };
      const fee = wm.wage * 10;
      if (hired.has(wm.id)) continue;
      body.append(h('div', { class: 'card row between small' },
        h('div', null, h('b', null, wm.name), h('div', { class: 'muted' }, `${CLASS_LABEL[cls]} · skill ${'★'.repeat(skill)} · wage ${wm.wage} cr/day`)),
        h('button', { class: `btn small ${p.wingmen.length >= slots || p.credits < fee ? 'disabled' : 'primary'}`, onclick: () => {
          p.credits -= fee;
          p.wingmen.push(wm);
          toast(`${wm.name} joins your wing.`, 'good');
          refresh();
        } }, `Hire (${fmtCr(fee)})`)));
    }
    if (p.wingmen.length) {
      body.append(h('h4', null, 'Your wingmen'));
      for (const wm of p.wingmen) body.append(h('div', { class: 'card row between small' }, h('span', null, `${wm.name} — ${CLASS_LABEL[wm.cls]} · hull ${(wm.hp * 100).toFixed(0)}%`),
        h('div', { class: 'row' },
          wm.hp < 1 ? h('button', { class: 'btn tiny', onclick: () => { const c = Math.round((1 - wm.hp) * 2000); if (p.credits >= c) { p.credits -= c; wm.hp = 1; refresh(); } } }, `Repair ${fmtCr((1 - wm.hp) * 2000)}`) : null,
          h('button', { class: 'btn tiny danger', onclick: () => { p.wingmen = p.wingmen.filter((x) => x !== wm); refresh(); } }, 'Dismiss'))));
    }
    // Rumours
    body.append(h('h4', null, 'Rumours'));
    const rumours: string[] = [];
    const near = systemsNear(w.galaxy, sys.x, sys.y, 60).filter((id) => id !== sysId && w.systems[id].stock);
    let best: { c: number; to: number; gain: number } | null = null;
    for (const to of near) for (let c = 0; c < 16; c++) {
      if (w.isIllegal(to, c)) continue;
      const gain = w.sellPrice(to, c) - w.buyPrice(sysId, c);
      if (!best || gain > best.gain) best = { c, to, gain };
    }
    if (best && best.gain > 0) rumours.push(`Traders say ${COMMODITIES[best.c].name} fetches ${best.gain} cr more per unit at ${w.sysData[best.to].name} than here.`);
    const warring = w.factions.filter((f) => f.alive && f.war.length && f.kind !== 'pirate');
    if (warring.length) {
      const f = rng.pick(warring);
      rumours.push(`The ${f.name} is fighting the ${w.factions[rng.pick(f.war)].name}. Military contractors are well paid.`);
    }
    const ruins = near.filter((id) => w.sysData[id].special !== 'none');
    if (ruins.length) rumours.push(`A prospector swears there is something strange in the ${w.sysData[rng.pick(ruins)].name} system.`);
    const pirates = w.fleets.filter((fl) => fl.role === 'pirate' && near.includes(fl.sys));
    if (pirates.length) rumours.push(`${pirates[0].name} have been seen near ${w.sysData[pirates[0].sys].name}. Watch your cargo.`);
    const hive = w.factions.find((f) => f.species === 'hive' && f.alive);
    if (hive) rumours.push(`Refugees whisper about the ${hive.name}. It controls ${hive.systemsCount} systems now.`);
    for (const r of rumours) body.append(h('div', { class: 'news-item' }, `“${r}”`));
  }

  // ------------------------------------------------------------------ colony
  function colonyTab(body: HTMLElement): void {
    const col = w.colonies.find((c) => c.id === st.colony);
    if (!col) return;
    add(body, h('div', { class: 'card' }, h('h3', null, col.name),
      h('div', { class: 'kv' }, 'Population', Math.round(col.pop), 'Happiness', `${col.happiness.toFixed(0)}%`, 'Buildings', col.buildings.length, 'Founded', `Day ${col.founded}`),
      h('div', { class: 'row', style: 'margin-top:0.5em' }, h('button', { class: 'btn primary', onclick: () => { m.close(); scene.syncBeforeSave(); game.colony = col; game.go('colony', { colonyId: col.id }); } }, '⌂ Manage Colony'))));
    // transfer cargo to colony
    const trans = h('div', { class: 'card small' }, h('h3', null, 'Unload cargo to colony stores'));
    const map: [number, keyof typeof col.res][] = [[C.food, 'food'], [C.water, 'water'], [C.ore, 'ore'], [C.metals, 'metals'], [C.alloys, 'alloys'], [C.crys, 'crystals'], [C.med, 'med']];
    for (const [c, r] of map) {
      if (!p.cargo[c]) continue;
      trans.append(h('div', { class: 'row between' }, `${COMMODITIES[c].name}: ${p.cargo[c]}`, h('button', { class: 'btn tiny', onclick: () => { col.res[r] += p.cargo[c]; p.cargo[c] = 0; refresh(); } }, 'Unload all')));
    }
    if (p.cargo[C.pax]) trans.append(h('div', { class: 'row between' }, `Colonists: ${p.cargo[C.pax]}`, h('button', { class: 'btn tiny', onclick: () => { col.pop += p.cargo[C.pax] * 5; p.cargo[C.pax] = 0; refresh(); } }, 'Settle')));
    body.append(trans);
  }

  // ------------------------------------------------------------------ info
  function infoTab(body: HTMLElement): void {
    if (p.explorationData > 0) {
      const val = Math.round(p.explorationData);
      body.append(h('div', { class: 'card row between' }, h('div', null, h('b', null, 'Cartographics'), h('div', { class: 'small muted' }, 'Sell survey and scan data collected on your travels.')),
        h('button', { class: 'btn primary', onclick: () => { p.credits += val; p.totalEarned += val; p.explorationData = 0; addXp(p, val / 50); toast(`Survey data sold for ${fmtCr(val)}.`, 'good'); refresh(); } }, `Sell data (${fmtCr(val)})`)));
    }
    if (fac && (p.bounty[fac.id] ?? 0) > 0) {
      const b = p.bounty[fac.id];
      body.append(h('div', { class: 'card row between' }, h('span', { class: 'bad' }, `Outstanding fines: ${fmtCr(b)}`),
        h('button', { class: `btn ${p.credits < b ? 'disabled' : ''}`, onclick: () => { p.credits -= b; p.bounty[fac.id] = 0; changeRep(w, fac.id, 8, 'fines paid'); refresh(); } }, 'Pay fines')));
    }
    add(body, h('div', { class: 'card small' }, h('h3', null, sys.name),
      h('div', { class: 'kv' }, 'Population', st.pop >= 1000 ? `${(st.pop / 1000).toFixed(2)} B` : `${st.pop.toFixed(1)} M`, 'Economy', ECONOMY_LABEL[st.econ], 'Tech level', st.tech,
        'Security', `${(st.security * 100).toFixed(0)}%`, 'Defense', `${Math.round(st.defense)}/${Math.round(st.maxDefense)}`, 'Unrest', `${st.unrest.toFixed(0)}%`)));
    if (fac) {
      add(body, h('div', { class: 'card small' }, h('h3', null, fac.name), h('p', null, fac.desc),
        h('div', { class: 'kv' }, 'Government', fac.gov, 'Systems', fac.systemsCount, 'Tech', fac.tech, 'Treasury', fmtCr(fac.treasury),
          'At war with', fac.war.map((x) => w.factions[x].short).join(', ') || 'none', 'Allies', fac.allies.map((x) => w.factions[x].short).join(', ') || 'none',
          'Illegal goods', fac.illegal.map((c) => COMMODITIES[c].name).join(', ') || 'none'),
        fac.subs.length ? h('div', null, h('h4', null, 'Power blocs'), ...fac.subs.map((s) => h('div', { class: 'row between' }, h('span', null, `${s.name} `, h('span', { class: 'muted' }, `(${s.role})`)),
          h('span', { class: 'mono' }, `loyalty ${s.loyalty.toFixed(0)} · influence ${s.influence.toFixed(0)}`)))) : null,
        h('p', { class: 'tiny muted' }, SUBFACTION_TEMPLATES.separatist.desc)));
    }
  }
}
