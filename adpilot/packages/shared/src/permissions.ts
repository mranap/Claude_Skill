/**
 * Permission catalogue. Permissions are stored in the database (table `permissions`) and attached to
 * roles through `role_permissions`, so new roles can be created from the Super Admin UI without code
 * changes. New features only need a new key here plus a seed run (idempotent).
 *
 * Tenant data (Meta profiles, campaigns, rules, ...) is protected by ownership checks, not by these
 * permissions: a user always manages only their own data. The `app.*` permissions allow an operator to
 * switch individual features off for a role (e.g. a read-only analyst role).
 */
export const PERMISSIONS = {
  // Regular product features (granted to USER by default)
  APP_META_PROFILES_MANAGE: 'app.meta_profiles.manage',
  APP_CAMPAIGNS_LAUNCH: 'app.campaigns.launch',
  APP_CAMPAIGNS_MANAGE: 'app.campaigns.manage',
  APP_TEMPLATES_MANAGE: 'app.templates.manage',
  APP_CREATIVES_MANAGE: 'app.creatives.manage',
  APP_RULES_MANAGE: 'app.rules.manage',
  APP_STATISTICS_VIEW: 'app.statistics.view',

  // Administration
  ADMIN_DASHBOARD_VIEW: 'admin.dashboard.view',
  ADMIN_USERS_VIEW: 'admin.users.view',
  ADMIN_USERS_CREATE: 'admin.users.create',
  ADMIN_USERS_UPDATE: 'admin.users.update',
  ADMIN_USERS_BLOCK: 'admin.users.block',
  ADMIN_USERS_DELETE: 'admin.users.delete',
  ADMIN_USERS_RESET_PASSWORD: 'admin.users.reset_password',
  ADMIN_USERS_SESSIONS: 'admin.users.sessions',
  ADMIN_ROLES_MANAGE: 'admin.roles.manage',
  ADMIN_SETTINGS_VIEW: 'admin.settings.view',
  ADMIN_SETTINGS_MANAGE: 'admin.settings.manage',
  ADMIN_SMTP_MANAGE: 'admin.smtp.manage',
  ADMIN_TELEGRAM_MANAGE: 'admin.telegram.manage',
  ADMIN_STORAGE_MANAGE: 'admin.storage.manage',
  ADMIN_META_MANAGE: 'admin.meta.manage',
  ADMIN_SECURITY_MANAGE: 'admin.security.manage',
  ADMIN_WORKERS_VIEW: 'admin.workers.view',
  ADMIN_WORKERS_MANAGE: 'admin.workers.manage',
  ADMIN_AUDIT_VIEW: 'admin.audit.view',
  ADMIN_LOGS_VIEW: 'admin.logs.view',
  ADMIN_BROADCAST_SEND: 'admin.broadcast.send',
  ADMIN_BACKUPS_MANAGE: 'admin.backups.manage',
  ADMIN_MAINTENANCE_MANAGE: 'admin.maintenance.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.values(PERMISSIONS);

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, { group: string; description: string }> = {
  'app.meta_profiles.manage': { group: 'Product', description: 'Connect Meta profiles, tokens and proxies' },
  'app.campaigns.launch': { group: 'Product', description: 'Create and launch campaigns' },
  'app.campaigns.manage': {
    group: 'Product',
    description: 'Pause/start campaigns, change budgets, bulk actions',
  },
  'app.templates.manage': { group: 'Product', description: 'Create and edit campaign templates' },
  'app.creatives.manage': { group: 'Product', description: 'Upload and manage creatives' },
  'app.rules.manage': { group: 'Product', description: 'Create and manage automated rules' },
  'app.statistics.view': { group: 'Product', description: 'View statistics and dashboards' },
  'admin.dashboard.view': { group: 'Administration', description: 'View the admin dashboard' },
  'admin.users.view': { group: 'Users', description: 'View users' },
  'admin.users.create': { group: 'Users', description: 'Create users' },
  'admin.users.update': { group: 'Users', description: 'Edit users and change roles' },
  'admin.users.block': { group: 'Users', description: 'Block and unblock users' },
  'admin.users.delete': { group: 'Users', description: 'Deactivate/delete users' },
  'admin.users.reset_password': { group: 'Users', description: 'Reset user passwords and 2FA' },
  'admin.users.sessions': { group: 'Users', description: 'View and terminate user sessions' },
  'admin.roles.manage': { group: 'Access control', description: 'Manage roles and permissions' },
  'admin.settings.view': { group: 'System', description: 'View system settings' },
  'admin.settings.manage': {
    group: 'System',
    description: 'Change general, file, statistics and queue settings',
  },
  'admin.smtp.manage': { group: 'System', description: 'Configure SMTP' },
  'admin.telegram.manage': { group: 'System', description: 'Configure the Telegram bot' },
  'admin.storage.manage': { group: 'System', description: 'Manage storage and file limits' },
  'admin.meta.manage': { group: 'System', description: 'Configure Meta API settings' },
  'admin.security.manage': { group: 'System', description: 'Change security settings' },
  'admin.workers.view': { group: 'Operations', description: 'View queues, workers and schedulers' },
  'admin.workers.manage': { group: 'Operations', description: 'Retry/remove jobs, pause queues' },
  'admin.audit.view': { group: 'Operations', description: 'View the audit log' },
  'admin.logs.view': { group: 'Operations', description: 'View system and Meta API logs' },
  'admin.broadcast.send': { group: 'Operations', description: 'Send messages to platform users' },
  'admin.backups.manage': { group: 'Operations', description: 'Run and manage backups' },
  'admin.maintenance.manage': { group: 'Operations', description: 'Maintenance mode and data retention' },
};

export const SYSTEM_ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;
export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

const USER_DEFAULTS: PermissionKey[] = [
  'app.meta_profiles.manage',
  'app.campaigns.launch',
  'app.campaigns.manage',
  'app.templates.manage',
  'app.creatives.manage',
  'app.rules.manage',
  'app.statistics.view',
];

/** Default permission sets for the system roles. SUPER_ADMIN implicitly has every permission. */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleKey, PermissionKey[]> = {
  USER: USER_DEFAULTS,
  ADMIN: [
    ...USER_DEFAULTS,
    'admin.dashboard.view',
    'admin.users.view',
    'admin.users.create',
    'admin.users.update',
    'admin.users.block',
    'admin.users.reset_password',
    'admin.users.sessions',
    'admin.settings.view',
    'admin.workers.view',
    'admin.audit.view',
    'admin.logs.view',
    'admin.broadcast.send',
  ],
  SUPER_ADMIN: ALL_PERMISSION_KEYS,
};

export function hasPermission(
  roleKey: string,
  granted: readonly string[],
  required: PermissionKey | readonly PermissionKey[],
): boolean {
  if (roleKey === SYSTEM_ROLES.SUPER_ADMIN) return true;
  const list = Array.isArray(required) ? required : [required];
  return list.every((p) => granted.includes(p));
}

export function isAdminRole(roleKey: string, granted: readonly string[]): boolean {
  return roleKey === SYSTEM_ROLES.SUPER_ADMIN || granted.some((p) => p.startsWith('admin.'));
}
