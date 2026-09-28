'use client';

import Link from 'next/link';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { useRef } from 'react';
import type * as React from 'react';
import { useScrollActiveIntoView } from '@/lib/hooks/use-scroll-active-into-view';
import { cn } from '@/lib/utils/cn';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('scrollbar-none flex w-full items-center gap-1 overflow-x-auto border-b', className)}
      {...props}
    />
  );
}

const triggerClasses = cn(
  'relative inline-flex h-9 shrink-0 items-center justify-center gap-2 px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors',
  'hover:text-foreground focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring/50',
  'after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent',
  'data-[state=active]:text-foreground data-[state=active]:after:bg-primary aria-[current=page]:text-foreground aria-[current=page]:after:bg-primary',
  'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
);

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn(triggerClasses, className)} {...props} />;
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('pt-5 outline-none', className)} {...props} />;
}

/** Route-driven tabs (each tab is a link; the active one is marked with aria-current). */
export function NavTabs({
  items,
  activeHref,
  className,
}: {
  items: { href: string; label: React.ReactNode; icon?: React.ReactNode }[];
  activeHref: string;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useScrollActiveIntoView(ref, activeHref);
  return (
    <nav ref={ref} className={cn('scrollbar-none flex w-full items-center gap-1 overflow-x-auto border-b', className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.href === activeHref ? 'page' : undefined}
          className={triggerClasses}
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
