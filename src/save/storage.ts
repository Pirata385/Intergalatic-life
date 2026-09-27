// localStorage wrapper that never throws: private browsing, blocked storage or
// sandboxed frames fall back to an in-memory map for the session.

const memory = new Map<string, string>();
let available: boolean | null = null;

function ok(): boolean {
  if (available !== null) return available;
  try {
    const k = '__igl_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export const storage = {
  get(key: string): string | null {
    if (ok()) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        /* fall through */
      }
    }
    return memory.get(key) ?? null;
  },
  set(key: string, value: string): boolean {
    memory.set(key, value);
    if (!ok()) return false;
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    memory.delete(key);
    if (!ok()) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  persistent(): boolean {
    return ok();
  },
};
