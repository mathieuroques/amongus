import { useEffect, useState } from 'preact/hooks';

/** Petit magasin observable (évite une dépendance supplémentaire). */
export class Store<T extends object> {
  private listeners = new Set<(v: T) => void>();
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  update(patch: Partial<T>) {
    this.value = { ...this.value, ...patch };
    for (const l of this.listeners) l(this.value);
  }
  subscribe(fn: (v: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function useStore<T extends object>(store: Store<T>): T {
  const [v, setV] = useState(store.get());
  useEffect(() => {
    setV(store.get());
    return store.subscribe(setV);
  }, [store]);
  return v;
}

/** Re-rendu périodique pour les comptes à rebours. */
export function useTick(ms = 500): number {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}
