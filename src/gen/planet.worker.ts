// Generates large planet textures off the main thread.
import { generatePlanetTexture } from './planet';

self.onmessage = (e: MessageEvent) => {
  const { id, body, w, inhabited } = e.data;
  const tex = generatePlanetTexture(body, w, inhabited);
  const transfer: Transferable[] = [tex.color.buffer];
  if (tex.emissive) transfer.push(tex.emissive.buffer);
  if (tex.clouds) transfer.push(tex.clouds.buffer);
  (self as any).postMessage({ id, tex }, transfer);
};
