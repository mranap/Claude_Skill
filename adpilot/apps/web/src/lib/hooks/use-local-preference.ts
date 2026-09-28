'use client';

import { useCallback, useSyncExternalStore } from 'react';

const EVENT = 'adpilot:preference';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Small per-browser UI preference (view mode, collapsed panels) stored in localStorage. Hydration-safe:
 * the server snapshot is the default and the stored value is applied right after hydration.
 */
export function useLocalPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    const handler = (event: Event) => {
      if (event instanceof StorageEvent ? event.key === key : (event as CustomEvent<string>).detail === key) onChange();
    };
    window.addEventListener('storage', handler);
    window.addEventListener(EVENT, handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener(EVENT, handler);
    };
  }, [key]);
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const value = raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // storage unavailable (private mode); the change is lost on reload
      }
      window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
    },
    [key],
  );
  return [value, set];
}
