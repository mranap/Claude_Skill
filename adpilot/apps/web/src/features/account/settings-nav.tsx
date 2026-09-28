'use client';

import { Bell, Palette, Shield, UserRound } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { NavTabs } from '@/components/ui/tabs';

const ITEMS = [
  { href: '/settings/profile', label: 'Profile', icon: <UserRound /> },
  { href: '/settings/security', label: 'Security', icon: <Shield /> },
  { href: '/settings/notifications', label: 'Notifications', icon: <Bell /> },
  { href: '/settings/appearance', label: 'Appearance', icon: <Palette /> },
];

export function SettingsNav() {
  const pathname = usePathname();
  const active = ITEMS.find((item) => pathname.startsWith(item.href))?.href ?? ITEMS[0]!.href;
  return <NavTabs items={ITEMS} activeHref={active} className="mb-6" />;
}
