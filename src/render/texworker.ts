// Promise-based access to the planet texture worker, with a synchronous fallback.
import type { Body } from '../gen/system';
import { generatePlanetTexture, PlanetTexture } from '../gen/planet';
import PlanetWorker from '../gen/planet.worker?worker&inline';

let worker: Worker | null = null;
let failed = false;
let nextId = 1;
const pending = new Map<number, (t: PlanetTexture) => void>();

function getWorker(): Worker | null {
  if (worker || failed) return worker;
  try {
    worker = new PlanetWorker();
    worker.onmessage = (e: MessageEvent) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data.tex as PlanetTexture);
    };
    worker.onerror = () => {
      failed = true;
      worker = null;
    };
  } catch {
    failed = true;
  }
  return worker;
}

/** Only the fields the generator needs (bodies have circular parent/moon links). */
function strip(b: Body): Partial<Body> {
  return { seed: b.seed, type: b.type, sysId: b.sysId, key: b.key, name: b.name, resources: b.resources };
}

export function requestPlanetTexture(body: Body, w: number, inhabited = 0): Promise<PlanetTexture> {
  const wk = getWorker();
  if (!wk) return Promise.resolve(generatePlanetTexture(body, w, inhabited));
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    wk.postMessage({ id, body: strip(body), w, inhabited });
  });
}
