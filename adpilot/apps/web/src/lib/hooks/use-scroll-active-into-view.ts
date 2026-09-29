'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Keeps the `aria-current="page"` item of a horizontally scrolling navigation visible on narrow screens.
 * Only the container's own `scrollLeft` changes, so the page itself never jumps.
 */
export function useScrollActiveIntoView(
  ref: RefObject<HTMLElement | null>,
  activeKey: string | undefined,
): void {
  useEffect(() => {
    const container = ref.current;
    if (!container || container.scrollWidth <= container.clientWidth) return;
    const active = container.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const offset = activeRect.left - containerRect.left + container.scrollLeft;
    container.scrollLeft = Math.max(0, offset - (container.clientWidth - activeRect.width) / 2);
  }, [ref, activeKey]);
}
