// Minimal DOM helpers, toasts and modal panels.
import { audio } from '../audio/audio';

type Attrs = Record<string, any> & { class?: string; style?: string | Partial<CSSStyleDeclaration>; onclick?: (e: MouseEvent) => void };
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        const evt = k.slice(2).toLowerCase();
        if (evt === 'click') {
          el.addEventListener('click', (e) => {
            audio.play('ui', 0.25);
            v(e);
          });
        } else el.addEventListener(evt, v);
      } else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof (el as any)[k] !== 'function' && k !== 'list') (el as any)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  // Key/value grids need every entry as its own element (adjacent text nodes merge).
  const wrap = el instanceof HTMLElement && el.classList.contains('kv');
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else if (wrap) {
      const s = document.createElement('span');
      s.textContent = String(c);
      el.appendChild(s);
    } else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Appends children, skipping null/false entries (unlike Element.append). */
export function add(el: HTMLElement, ...children: Child[]): HTMLElement {
  append(el, children);
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let uiRoot: HTMLElement;
let toastBox: HTMLElement;

export function initUI(root: HTMLElement): void {
  uiRoot = root;
  toastBox = h('div', { class: 'toasts' });
  root.appendChild(toastBox);
}

export function ui(): HTMLElement {
  return uiRoot;
}

export function toast(text: string, kind: 'good' | 'bad' | 'info' = 'info', ms = 3200): void {
  const el = h('div', { class: `toast ${kind}` }, text);
  toastBox.appendChild(el);
  while (toastBox.children.length > 5) toastBox.firstChild?.remove();
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

export interface Modal {
  el: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

let modalStack: Modal[] = [];

export function openModal(title: string, content: Node | Node[], opts: { wide?: boolean; onClose?: () => void; cls?: string; noClose?: boolean } = {}): Modal {
  const body = h('div', { class: 'modal-body' });
  append(body, Array.isArray(content) ? content : [content]);
  const back = h('div', { class: 'modal-back' });
  const m: Modal = { el: back, body, close: () => undefined };
  const close = () => {
    back.remove();
    modalStack = modalStack.filter((x) => x !== m);
    opts.onClose?.();
  };
  m.close = close;
  const panel = h('div', { class: `modal panel ${opts.wide ? 'wide' : ''} ${opts.cls ?? ''}` },
    h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, title), opts.noClose ? null : h('button', { class: 'btn icon close', onclick: close, title: 'Close' }, '✕')),
    body,
  );
  back.appendChild(panel);
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back && !opts.noClose) close();
  });
  uiRoot.appendChild(back);
  modalStack.push(m);
  return m;
}

export function closeAllModals(): void {
  for (const m of [...modalStack]) m.close();
}

export function topModal(): Modal | undefined {
  return modalStack[modalStack.length - 1];
}

export function confirmDialog(title: string, text: string, onYes: () => void, yesLabel = 'Confirm'): void {
  const m = openModal(title, [
    h('p', null, text),
    h('div', { class: 'row end' },
      h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => { m.close(); onYes(); } }, yesLabel)),
  ]);
}

export function bar(frac: number, color: string, label?: string): HTMLElement {
  return h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: { width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: color } }), label ? h('span', { class: 'bar-label' }, label) : null);
}

export function tabs(names: string[], render: (name: string, body: HTMLElement) => void, initial?: string): HTMLElement {
  const body = h('div', { class: 'tab-body' });
  const head = h('div', { class: 'tabs' });
  let current = initial ?? names[0];
  const draw = () => {
    clear(head);
    for (const n of names) head.appendChild(h('button', { class: `tab ${n === current ? 'active' : ''}`, onclick: () => { current = n; draw(); } }, n));
    clear(body);
    render(current, body);
  };
  draw();
  const wrap = h('div', { class: 'tabwrap' }, head, body);
  (wrap as any).redraw = draw;
  return wrap;
}

export function fmtCr(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} cr`;
}
