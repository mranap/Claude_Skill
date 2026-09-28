import { SETTING_PERMISSIONS, type PermissionKey, type SettingKey } from '@adpilot/shared';
import {
  Activity,
  Archive,
  ChartColumn,
  Construction,
  DatabaseBackup,
  Globe,
  HardDrive,
  Layers,
  Mail,
  Send,
  Shield,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface SettingsCategory {
  slug: string;
  key: SettingKey;
  title: string;
  description: string;
  icon: LucideIcon;
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    slug: 'general',
    key: 'general',
    title: 'General',
    description: 'Platform name, support contact and default time zone.',
    icon: SlidersHorizontal,
  },
  {
    slug: 'security',
    key: 'security',
    title: 'Security',
    description: 'Sessions, sign-in protection and the 2FA policy.',
    icon: Shield,
  },
  {
    slug: 'files',
    key: 'files',
    title: 'Files & storage',
    description: 'Upload limits and per-user storage quota.',
    icon: HardDrive,
  },
  {
    slug: 'statistics',
    key: 'statistics',
    title: 'Statistics',
    description: 'How often insights are synchronised from Meta.',
    icon: ChartColumn,
  },
  {
    slug: 'account-checks',
    key: 'accountChecks',
    title: 'Account checks',
    description: 'Intervals for ad account status checks.',
    icon: Activity,
  },
  {
    slug: 'rules',
    key: 'rules',
    title: 'Auto rules',
    description: 'Limits for automated rules.',
    icon: Workflow,
  },
  {
    slug: 'meta',
    key: 'meta',
    title: 'Meta API',
    description: 'App credentials, throttling and sync intervals.',
    icon: Globe,
  },
  { slug: 'smtp', key: 'smtp', title: 'SMTP', description: 'Outgoing e-mail server.', icon: Mail },
  {
    slug: 'telegram',
    key: 'telegram',
    title: 'Telegram',
    description: 'Notification bot and delivery mode.',
    icon: Send,
  },
  {
    slug: 'queue',
    key: 'queue',
    title: 'Queues',
    description: 'Background job concurrency and retries.',
    icon: Layers,
  },
  {
    slug: 'retention',
    key: 'retention',
    title: 'Data retention',
    description: 'How long logs and history are kept.',
    icon: Archive,
  },
  {
    slug: 'maintenance',
    key: 'maintenance',
    title: 'Maintenance',
    description: 'Temporarily restrict the platform to administrators.',
    icon: Construction,
  },
  {
    slug: 'backups',
    key: 'backups',
    title: 'Backups',
    description: 'Scheduled database backups.',
    icon: DatabaseBackup,
  },
];

export const SETTINGS_SLUGS = SETTINGS_CATEGORIES.map((c) => c.slug);

export function categoryBySlug(slug: string): SettingsCategory | undefined {
  return SETTINGS_CATEGORIES.find((c) => c.slug === slug);
}

export function managePermission(key: SettingKey): PermissionKey {
  return SETTING_PERMISSIONS[key] as PermissionKey;
}
