// In-memory `localStorage` / `sessionStorage` for the *.gaps.test.ts files.
//
// On the Node version this suite runs under, `window.localStorage` is not a
// working jsdom Storage (its methods are not functions), so tests that go
// through storage install this plain object instead. Methods are ordinary
// properties, so a test can `vi.spyOn(storage, 'setItem')` to make a write
// throw (quota exceeded / private mode).
export interface MemoryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  key: (index: number) => string | null;
  readonly length: number;
}

export function createMemoryStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length(): number {
      return store.size;
    },
  };
}

/** Replace `globalThis[name]` (and therefore `window[name]`) with a fresh store. */
export function installMemoryStorage(
  name: 'localStorage' | 'sessionStorage' = 'localStorage',
): MemoryStorage {
  const storage = createMemoryStorage();
  Object.defineProperty(globalThis, name, { configurable: true, value: storage });
  return storage;
}
