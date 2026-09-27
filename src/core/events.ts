type Handler = (payload?: any) => void;

/** Tiny pub/sub used to decouple simulation, scenes and UI. */
export class EventBus {
  private map = new Map<string, Set<Handler>>();

  on(evt: string, h: Handler): () => void {
    let set = this.map.get(evt);
    if (!set) this.map.set(evt, (set = new Set()));
    set.add(h);
    return () => set!.delete(h);
  }

  emit(evt: string, payload?: any): void {
    const set = this.map.get(evt);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (e) {
        console.error('event handler error', evt, e);
      }
    }
  }
}

export const bus = new EventBus();
