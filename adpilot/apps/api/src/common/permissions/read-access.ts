import { hasPermission, type PermissionKey } from '@adpilot/shared';
import type { AuthUser } from '../../modules/auth/auth.types';

/**
 * Read access shared by several features: data a user may see when holding any of these permissions (e.g.
 * the launch wizard reads templates and creatives, rules and statistics read campaigns). Writes keep their
 * specific `@RequirePermissions`.
 */
export const READ_ACCESS = {
  adAccounts: [
    'app.meta_profiles.manage',
    'app.campaigns.launch',
    'app.campaigns.manage',
    'app.templates.manage',
    'app.creatives.manage',
    'app.rules.manage',
    'app.statistics.view',
  ],
  campaigns: ['app.statistics.view', 'app.campaigns.manage', 'app.campaigns.launch', 'app.rules.manage'],
  creatives: ['app.creatives.manage', 'app.campaigns.launch'],
  templates: ['app.templates.manage', 'app.campaigns.launch'],
  drafts: ['app.campaigns.launch'],
  metaProfiles: ['app.meta_profiles.manage'],
} as const satisfies Record<string, readonly PermissionKey[]>;

export function canRead(user: Pick<AuthUser, 'roleKey' | 'permissions'>, area: keyof typeof READ_ACCESS): boolean {
  return READ_ACCESS[area].some((p) => hasPermission(user.roleKey, user.permissions, p));
}
