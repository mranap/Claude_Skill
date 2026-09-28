import type { PermissionKey } from '@adpilot/shared';
import {
  Bell,
  Briefcase,
  ChartColumn,
  Cpu,
  FileClock,
  Gauge,
  HardDrive,
  Images,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  Megaphone,
  Plug,
  Radio,
  Rocket,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { READ_ACCESS } from '@/lib/permissions';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** All listed permissions are required to show the item. */
  permission?: PermissionKey | PermissionKey[];
  /** Any one of these permissions shows the item (read access shared by several features, as in the API). */
  anyPermission?: readonly PermissionKey[];
  /** Other path prefixes that belong to this item (e.g. /launches for Launch). */
  matchPrefixes?: string[];
  /** Extra search terms for the command palette. */
  keywords?: string[];
}

export const MAIN_NAV: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, keywords: ['home', 'overview'] },
  {
    title: 'Meta Accounts',
    href: '/meta-profiles',
    icon: Plug,
    permission: 'app.meta_profiles.manage',
    keywords: ['facebook', 'profiles', 'tokens', 'proxies', 'connections'],
  },
  { title: 'Ad Accounts', href: '/ad-accounts', icon: Briefcase, anyPermission: READ_ACCESS.adAccounts, keywords: ['accounts', 'billing', 'status'] },
  { title: 'Campaigns', href: '/campaigns', icon: Megaphone, anyPermission: READ_ACCESS.campaigns, keywords: ['ads', 'ad sets', 'budgets'] },
  {
    title: 'Launch',
    href: '/launch',
    icon: Rocket,
    permission: 'app.campaigns.launch',
    matchPrefixes: ['/launches'],
    keywords: ['create', 'wizard', 'new campaign', 'launch history'],
  },
  { title: 'Templates', href: '/templates', icon: LayoutTemplate, permission: 'app.templates.manage', keywords: ['presets'] },
  { title: 'Creatives', href: '/creatives', icon: Images, permission: 'app.creatives.manage', keywords: ['images', 'videos', 'media', 'uploads'] },
  { title: 'Statistics', href: '/statistics', icon: ChartColumn, permission: 'app.statistics.view', keywords: ['insights', 'reports', 'spend'] },
  { title: 'Auto Rules', href: '/rules', icon: Workflow, permission: 'app.rules.manage', keywords: ['automation', 'rules'] },
  { title: 'Notifications', href: '/notifications', icon: Bell, keywords: ['alerts', 'inbox'] },
  { title: 'Settings', href: '/settings/profile', icon: Settings, keywords: ['account', 'profile', 'preferences'] },
];

export const ADMIN_NAV: NavItem[] = [
  { title: 'Admin Dashboard', href: '/admin', icon: Gauge, permission: 'admin.dashboard.view', keywords: ['administration'] },
  { title: 'Users', href: '/admin/users', icon: Users, permission: 'admin.users.view', keywords: ['accounts', 'members'] },
  { title: 'Roles & Permissions', href: '/admin/roles', icon: ShieldCheck, permission: 'admin.users.view', keywords: ['access', 'rbac'] },
  { title: 'System settings', href: '/admin/settings/general', icon: SlidersHorizontal, permission: 'admin.settings.view', keywords: ['configuration'] },
  { title: 'SMTP', href: '/admin/settings/smtp', icon: Mail, permission: ['admin.settings.view', 'admin.smtp.manage'], keywords: ['email', 'mail server'] },
  { title: 'Telegram', href: '/admin/settings/telegram', icon: Send, permission: ['admin.settings.view', 'admin.telegram.manage'], keywords: ['bot'] },
  { title: 'Storage & Files', href: '/admin/settings/files', icon: HardDrive, permission: ['admin.settings.view', 'admin.storage.manage'], keywords: ['limits', 'uploads', 's3'] },
  {
    title: 'Monitoring',
    href: '/admin/workers',
    icon: Cpu,
    anyPermission: ['admin.workers.view', 'admin.storage.manage', 'admin.backups.manage'],
    keywords: ['workers', 'queues', 'jobs', 'bullmq', 'scheduler', 'health', 'rate limits', 'storage', 'backups'],
  },
  { title: 'Logs', href: '/admin/logs', icon: ScrollText, permission: 'admin.logs.view', keywords: ['system logs', 'meta api'] },
  { title: 'Audit', href: '/admin/audit', icon: FileClock, permission: 'admin.audit.view', keywords: ['audit trail', 'history'] },
  { title: 'Broadcasts', href: '/admin/broadcasts', icon: Radio, permission: 'admin.broadcast.send', keywords: ['announcements', 'messages'] },
];

/** Section prefixes used for matching (e.g. "/admin/settings/general" matches everything under /admin/settings). */
function matchPrefixes(item: NavItem): string[] {
  const own = item.href === '/settings/profile' ? '/settings' : item.href === '/admin/settings/general' ? '/admin/settings' : item.href;
  return [own, ...(item.matchPrefixes ?? [])];
}

/** The item whose prefix is the longest match for the current path. */
export function findActiveNavItem(pathname: string, items: NavItem[]): NavItem | undefined {
  let best: NavItem | undefined;
  let bestLength = -1;
  for (const item of items) {
    for (const prefix of matchPrefixes(item)) {
      if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && prefix.length > bestLength) {
        best = item;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

export function filterNav(items: NavItem[], can: (p: PermissionKey | readonly PermissionKey[]) => boolean): NavItem[] {
  return items.filter(
    (item) => (!item.permission || can(item.permission)) && (!item.anyPermission || item.anyPermission.some((p) => can(p))),
  );
}
