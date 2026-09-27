// Settings dialog: orientation (auto / portrait / landscape), graphics, audio,
// controls and gameplay options.
import type { Game } from '../game';
import { h, openModal, clear } from './dom';
import type { Settings } from '../settings';

export function openSettings(game: Game): void {
  const body = h('div', { class: 'col' });
  const m = openModal('Settings', body);
  const s = game.settings;
  const draw = () => {
    clear(body);
    const seg = <K extends keyof Settings>(key: K, opts: [Settings[K], string][], after?: () => void) =>
      h('div', { class: 'row' }, ...opts.map(([v, label]) =>
        h('button', { class: `btn small ${s[key] === v ? 'active' : ''}`, onclick: () => { s[key] = v; game.applySettings(); after?.(); draw(); } }, label)));
    const toggle = (key: keyof Settings, label: string) =>
      h('label', { class: 'row', style: 'cursor:pointer' },
        h('input', { type: 'checkbox', checked: !!s[key], onchange: (e: Event) => { (s as any)[key] = (e.target as HTMLInputElement).checked; game.applySettings(); } }), label);
    const slider = (key: keyof Settings, min: number, max: number, step: number, label: string) =>
      h('div', { class: 'col', style: 'gap:0.1em' }, h('div', { class: 'row between small' }, h('span', null, label), h('span', { class: 'mono' }, String((s as any)[key]))),
        h('input', { type: 'range', min, max, step, value: (s as any)[key], oninput: (e: Event) => { (s as any)[key] = parseFloat((e.target as HTMLInputElement).value); game.applySettings(); } }));

    body.append(
      h('h4', null, 'Screen orientation'),
      h('p', { class: 'small muted' }, 'On phones and tablets you can force the game into portrait or landscape. If your device keeps the other orientation, the game rotates itself — just turn your device.'),
      seg('orientation', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], () => {
        if (s.orientation !== 'auto') game.requestFullscreenOrientation();
      }),
      h('div', { class: 'row' },
        toggle('flip', 'Flip rotation direction'),
        h('button', { class: 'btn small', onclick: () => game.requestFullscreenOrientation() }, '⛶ Fullscreen & lock')),
      h('hr'),
      h('h4', null, 'Graphics'),
      seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]),
      slider('uiScale', 0.8, 1.4, 0.05, 'UI scale'),
      slider('tilt', 0.35, 1, 0.01, 'Camera tilt (2.5D perspective)'),
      toggle('showFps', 'Show FPS counter'),
      h('hr'),
      h('h4', null, 'Audio'),
      slider('volume', 0, 1, 0.05, 'Master volume'),
      h('div', { class: 'row' }, toggle('sfx', 'Sound effects'), toggle('music', 'Ambient music')),
      h('hr'),
      h('h4', null, 'Controls'),
      seg('controls', [['auto', 'Auto detect'], ['touch', 'Touch'], ['desktop', 'Keyboard & mouse']]),
      seg('joystickSide', [['left', 'Joystick left'], ['right', 'Joystick right']]),
      toggle('aimAssist', 'Aim assist / auto-target'),
      h('hr'),
      h('h4', null, 'Gameplay'),
      toggle('autosave', 'Autosave'),
      toggle('offlineSim', 'Galaxy keeps simulating while the game is closed (up to 30 days)'),
      toggle('tutorial', 'Show tips'),
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => m.close() }, 'Done')),
    );
  };
  draw();
}

export function controlsHelp(): HTMLElement {
  return h('div', { class: 'col small' },
    h('h4', null, 'Keyboard & mouse'),
    h('div', { class: 'kv' },
      'W / S or ↑ / ↓', 'Thrust / brake & reverse',
      'A / D or ← / →', 'Rotate ship',
      'Right mouse (hold)', 'Fly toward cursor',
      'Mouse', 'Aim turrets',
      'Left mouse / Space', 'Fire weapons',
      'Shift', 'Boost (uses energy)',
      'C', 'Toggle cruise drive (fast travel, no hostiles nearby)',
      'E / F', 'Context action: dock, land, scan, pick up',
      'Tab / T', 'Cycle targets / nearest hostile',
      'Click', 'Select object (double-click to autopilot)',
      'M', 'Galaxy map',
      'J / N / I', 'Journal, news, ship & cargo',
      'Mouse wheel', 'Zoom',
      'Esc', 'Close panel / menu'),
    h('h4', null, 'Touch'),
    h('div', { class: 'kv' },
      'Left joystick', 'Steer and thrust in that direction',
      'FIRE', 'Hold to fire at your target (auto-aim)',
      'BOOST / CRUISE', 'Speed up / fast travel',
      'Action button', 'Dock, land, scan, pick up',
      'Tap', 'Select objects; double tap to autopilot',
      'Pinch', 'Zoom',
      'Drag (maps)', 'Pan'),
  );
}
