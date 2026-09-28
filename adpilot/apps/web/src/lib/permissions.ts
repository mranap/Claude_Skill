import type { PermissionKey } from '@adpilot/shared';

/**
 * Read access shared by several features, mirroring the API (`apps/api/src/common/permissions/read-access.ts`):
 * holding any one of these permissions lets a user read the area (the launch wizard reads templates and
 * creatives, rules and statistics read campaigns). Writes keep their specific permission.
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
