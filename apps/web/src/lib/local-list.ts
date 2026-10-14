/**
 * A short list of club slugs kept in localStorage (compare picks, saved clubs). Storage can
 * be empty, corrupt, blocked or full, so every read and write is guarded and the page
 * renders correctly with an empty list.
 */

/** Slugs from a stored JSON value: strings only, de-duped in order, capped. Never throws. */
export function parseSlugList(raw: string | null | undefined, max: number): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((s): s is string => typeof s === "string" && /^[a-z0-9-]{1,120}$/.test(s)))].slice(
      0,
      max,
    );
  } catch {
    return [];
  }
}

export interface ListStore {
  read(): string[];
  /** Stable-identity snapshot for useSyncExternalStore. */
  getSnapshot(): string[];
  subscribe(cb: () => void): () => void;
  write(slugs: string[]): void;
}

export function createListStore(key: string, max: number): ListStore {
  const event = key;
  const read = () => {
    try {
      return parseSlugList(localStorage.getItem(key), max);
    } catch {
      return [];
    }
  };
  let snapshot: string[] = [];
  let snapshotKey = "";
  return {
    read,
    getSnapshot() {
      const next = read();
      const k = next.join(",");
      if (k !== snapshotKey) {
        snapshotKey = k;
        snapshot = next;
      }
      return snapshot;
    },
    subscribe(cb) {
      window.addEventListener(event, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(event, cb);
        window.removeEventListener("storage", cb);
      };
    },
    write(slugs) {
      try {
        localStorage.setItem(key, JSON.stringify([...new Set(slugs)].slice(0, max)));
      } catch {
        /* storage blocked: the in-page state is simply not remembered */
      }
      window.dispatchEvent(new Event(event));
    },
  };
}
