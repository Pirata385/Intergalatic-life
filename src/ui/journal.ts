// Journal: missions, ship & cargo, pilot progression, factions, news, colonies.
import type { Game } from '../game';
import { h, openModal, tabs, fmtCr, bar, toast, confirmDialog, add, clear } from './dom';
import { COMMODITIES } from '../data/commodities';
import { MODULE_MAP, AMMO, AmmoType, RARITY_COLOR } from '../data/modules';
import { RANKS, RANK_MERIT, repTier } from '../data/factions';
import { SKILLS, xpForLevel, cargoUsed, playerStats, wingmanSlots } from '../player/player';
import { abandonMission } from '../sim/missions';
import { computeStats } from '../ship/design';
import { renderShipSprite } from '../ship/render';
import { CLASS_LABEL } from '../ship/shipgen';
import { PLANET_LABEL } from '../gen/system';

export function openJournal(game: Game, initial = 'Missions'): void {
  const w = game.world;
  if (!w) return;
  const p = w.player;
  let t: HTMLElement;
  const refresh = () => (t as any).redraw();
  t = tabs(['Missions', 'Ship', 'Pilot', 'Factions', 'News', 'Colonies'], (name, body) => {
    switch (name) {
      case 'Missions': {
        const active = p.missions.filter((m) => m.status === 'active');
        if (!active.length) body.append(h('p', { class: 'muted' }, 'No active missions. Visit a station\'s mission board.'));
        for (const m of active) {
          const target = m.target >= 0 ? w.sysData[m.target].name : '';
          add(body, h('div', { class: 'card' },
            h('div', { class: 'row between' }, h('b', null, m.title), h('span', { class: 'mono gold' }, fmtCr(m.reward))),
            h('div', { class: 'small' }, m.desc),
            h('div', { class: 'row small muted' },
              m.faction > 0 ? h('span', null, h('span', { class: 'dot', style: { background: w.factions[m.faction].color } }), w.factions[m.faction].name) : null,
              target ? h('span', null, `📍 ${target}`) : null,
              m.deadline ? h('span', { class: m.deadline - w.day < 3 ? 'bad' : '' }, `⏱ ${Math.max(0, m.deadline - Math.floor(w.day))} days left`) : null,
              m.goal > 1 ? h('span', null, `Progress ${m.progress}/${m.goal}`) : null,
              (m.type === 'salvage' || m.type === 'rescue') ? h('span', null, m.data.picked ? 'Recovered — return to ' + w.sysData[m.origin].name : 'Not yet recovered') : null),
            h('div', { class: 'row end' },
              target ? h('button', { class: 'btn small', onclick: () => { (game as any).galaxyRoute = undefined; game.go('galaxy'); setTimeout(() => (game.scene as any).select?.(m.target), 50); } }, 'Show on map') : null,
              h('button', { class: 'btn small danger', onclick: () => confirmDialog('Abandon mission', 'Abandon this mission? You will lose reputation.', () => { abandonMission(w, m); refresh(); }, 'Abandon') }, 'Abandon'))));
        }
        body.append(h('div', { class: 'small muted' }, `Completed: ${p.completed} · Failed: ${p.failed}`));
        break;
      }
      case 'Ship': {
        const alive = p.hp.map((x) => x > 0);
        const st = playerStats(p, alive);
        const spr = renderShipSprite(p.design, { px: 6, alive, hpFrac: p.hp });
        spr.style.imageRendering = 'pixelated';
        spr.style.maxWidth = '100%';
        add(body, h('div', { class: 'grid2' },
          h('div', { class: 'card' }, h('h3', null, p.design.name), h('div', { class: 'center' }, spr),
            h('div', { class: 'kv small' },
              'Blocks', st.blocks, 'Mass', st.mass.toFixed(0), 'Hull HP', `${Math.round(p.hp.reduce((a, x, i) => a + x * (MODULE_MAP[p.design.modules[i].id]?.hp ?? 0), 0))}/${st.hp}`,
              'Armor', st.armor.toFixed(1), 'Shield', `${st.shieldCap} (+${st.shieldRegen.toFixed(0)}/s)`, 'Power', `${st.powerGen.toFixed(0)} gen / ${st.powerUse.toFixed(0)} use`,
              'Speed', st.maxSpeed.toFixed(0), 'Turn', `${st.turnRate.toFixed(2)} rad/s`, 'DPS', st.dps.toFixed(0), 'Range', st.range.toFixed(0),
              'Jump range', `${st.jump} ly`, 'Fuel', `${Math.floor(p.fuel)}/${st.fuel}`, 'Crew', `${st.crewCap}/${st.crewReq}`, 'Sensors', st.sensor.toFixed(0))),
          h('div', { class: 'col' },
            h('div', { class: 'card' }, h('h3', null, `Cargo ${cargoUsed(p)}/${st.cargo}`),
              ...COMMODITIES.map((c) => p.cargo[c.id] ? h('div', { class: 'row between small' }, `${c.icon} ${c.name}`, h('span', { class: 'row' }, h('span', { class: 'mono' }, String(p.cargo[c.id])),
                h('button', { class: 'btn tiny', onclick: () => { p.cargo[c.id] = 0; toast(`Jettisoned ${c.name}.`, 'info'); refresh(); } }, 'Jettison'))) : null),
              cargoUsed(p) === 0 ? h('div', { class: 'muted small' }, 'Empty') : null),
            h('div', { class: 'card small' }, h('h3', null, 'Ammunition'), ...(Object.keys(AMMO) as AmmoType[]).map((a) => st.ammoCap[a] ? h('div', null, `${AMMO[a].name}: ${Math.floor(p.ammo[a])}/${st.ammoCap[a]}`) : null),
              Object.values(st.ammoCap).every((v) => !v) ? h('div', { class: 'muted' }, 'No ammunition weapons') : null),
            h('div', { class: 'card small' }, h('h3', null, 'Spare modules'), ...Object.entries(p.modules).filter(([, n]) => n > 0).map(([id, n]) => h('div', { style: { color: RARITY_COLOR[MODULE_MAP[id].rarity] } }, `${MODULE_MAP[id].name} ×${n}`))),
            h('div', { class: 'card small' }, h('h3', null, `Wingmen ${p.wingmen.length}/${wingmanSlots(p, st.leadership)}`),
              ...p.wingmen.map((wm) => h('div', null, `${wm.name} — ${CLASS_LABEL[wm.cls]} (${(wm.hp * 100).toFixed(0)}%) · ${wm.wage} cr/day`)),
              p.wingmen.length ? null : h('div', { class: 'muted' }, 'Hire wingmen in station bars.')))));
        if (st.errors.length || st.warnings.length) body.append(h('div', { class: 'card small' }, ...st.errors.map((e) => h('div', { class: 'bad' }, e)), ...st.warnings.map((e) => h('div', { class: 'warn' }, e))));
        void computeStats;
        break;
      }
      case 'Pilot': {
        const need = xpForLevel(p.level);
        add(body, h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', null, `Captain ${p.name}`), h('span', { class: 'mono' }, `Level ${p.level}`)),
          bar(p.xp / need, '#b07aff', `${p.xp} / ${need} XP`),
          h('div', { class: 'kv small', style: 'margin-top:0.5em' },
            'Credits', fmtCr(p.credits), 'Total earned', fmtCr(p.totalEarned), 'Kills', p.kills, 'Systems visited', p.visitedCount,
            'Missions done', p.completed, 'Deaths', p.deaths, 'Unsold survey data', fmtCr(p.explorationData),
            'Military', p.military ? `${RANKS[p.military.rank]}, ${w.factions[p.military.faction].name} (${p.military.merit}/${RANK_MERIT[Math.min(RANKS.length - 1, p.military.rank + 1)]} merit)` : 'Civilian')));
        const skills = h('div', { class: 'card' }, h('h3', null, `Skills — ${p.skillPoints} point(s) available`));
        for (const s of SKILLS) {
          const lv = p.skills[s.id] ?? 0;
          skills.append(h('div', { class: 'row between' }, h('div', null, h('b', null, `${s.name} ${lv}/10`), h('div', { class: 'tiny muted' }, s.desc)),
            h('button', { class: `btn small ${p.skillPoints <= 0 || lv >= 10 ? 'disabled' : 'primary'}`, onclick: () => { p.skillPoints--; p.skills[s.id] = lv + 1; refresh(); } }, '+')));
        }
        body.append(skills);
        break;
      }
      case 'Factions': {
        for (const f of w.factions) {
          if (f.kind === 'player' || !f.alive) continue;
          const rep = p.rep[f.id] ?? 0;
          const tier = repTier(rep);
          add(body, h('div', { class: 'card small' },
            h('div', { class: 'row between' }, h('span', null, h('span', { class: 'dot', style: { background: f.color } }), h('b', null, f.name), h('span', { class: 'muted' }, ` · ${f.gov}`)),
              h('span', { style: { color: tier.color } }, `${tier.name} (${rep.toFixed(0)})`)),
            bar((rep + 100) / 200, tier.color),
            h('div', { class: 'muted' }, `${f.systemsCount} systems · tech ${f.tech} · fleet strength ${Math.round(f.strength / 100)} · kills ${f.kills} / losses ${f.losses}`),
            f.war.length ? h('div', { class: 'bad' }, `⚔ At war: ${f.war.map((x) => w.factions[x].name).join(', ')}`) : null,
            f.allies.length ? h('div', { class: 'good' }, `🤝 Allies: ${f.allies.map((x) => w.factions[x].name).join(', ')}`) : null,
            f.parent >= 0 ? h('div', { class: 'warn' }, `Broke away from the ${w.factions[f.parent].name} on day ${f.founded}`) : null,
            (p.bounty[f.id] ?? 0) > 0 ? h('div', { class: 'bad' }, `Fines owed: ${fmtCr(p.bounty[f.id])}`) : null));
        }
        const dead = w.factions.filter((f) => !f.alive);
        if (dead.length) body.append(h('div', { class: 'small muted' }, `Fallen: ${dead.map((f) => f.name).join(', ')}`));
        break;
      }
      case 'News': {
        const filterRow = h('div', { class: 'row small' });
        const list = h('div');
        let filter = 'all';
        const kinds = ['all', 'war', 'capture', 'colony', 'battle', 'pirate', 'economy', 'rebellion', 'alien', 'player'];
        const draw = () => {
          clear(filterRow);
          for (const k of kinds) filterRow.append(h('button', { class: `btn tiny ${filter === k ? 'active' : ''}`, onclick: () => { filter = k; draw(); } }, k));
          clear(list);
          for (const n of w.news.filter((x) => filter === 'all' || x.kind === filter || (filter === 'war' && (x.kind === 'peace' || x.kind === 'alliance'))).slice(0, 120)) {
            list.append(h('div', { class: 'news-item' }, h('span', { class: 'd' }, `D${Math.floor(n.day)}`), n.text));
          }
        };
        draw();
        body.append(filterRow, list);
        break;
      }
      case 'Colonies': {
        const mine = w.colonies.filter((c) => c.owner === 0);
        if (!mine.length) body.append(h('p', { class: 'muted' }, 'You have no colonies yet. Install a Colony Pod (buy it in a shipyard\'s module market and place it in the Ship Builder), fly to a solid planet, orbit it and choose "Found colony".'));
        for (const c of mine) {
          add(body, h('div', { class: 'card small' }, h('div', { class: 'row between' }, h('b', null, c.name), h('span', { class: 'muted' }, `${w.sysData[c.sys].name} · ${c.planetName} (${PLANET_LABEL[c.planetType]})`)),
            h('div', { class: 'kv' }, 'Population', Math.round(c.pop), 'Happiness', `${c.happiness.toFixed(0)}%`, 'Health', `${c.health.toFixed(0)}%`, 'Daily income', fmtCr(c.report?.income ?? 0)),
            c.lost ? h('div', { class: 'bad' }, 'Abandoned') : h('div', { class: 'row end' }, h('button', { class: 'btn primary small', onclick: () => { m.close(); (game.scene as any)?.syncBeforeSave?.(); game.colony = c; game.go('colony', { colonyId: c.id }); } }, 'Manage remotely'))));
        }
        const lost = w.colonies.filter((c) => c.owner !== 0 && c.mode === 'campaign');
        if (lost.length) body.append(h('div', { class: 'small bad' }, `Lost colonies: ${lost.map((c) => c.name).join(', ')}`));
        break;
      }
    }
  }, initial);
  const m = openModal('Journal', t, { wide: true });
}
