/**
 * Central TanStack Query keys. Prefix arrays (e.g. `queryKeys.admin.users.all`) are used for broad
 * invalidation after mutations.
 */
export const queryKeys = {
  me: ['auth', 'me'] as const,
  account: {
    all: ['account'] as const,
    sessions: ['account', 'sessions'] as const,
    loginHistory: (params: Record<string, unknown>) => ['account', 'login-history', params] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: (params: Record<string, unknown>) => ['notifications', 'list', params] as const,
    latest: ['notifications', 'latest'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
    preferences: ['notifications', 'preferences'] as const,
    telegram: ['notifications', 'telegram'] as const,
  },
  metaProfiles: {
    all: ['meta-profiles'] as const,
    list: ['meta-profiles', 'list'] as const,
    detail: (id: string) => ['meta-profiles', 'detail', id] as const,
    assets: (id: string) => ['meta-profiles', 'assets', id] as const,
  },
  adAccounts: {
    all: ['ad-accounts'] as const,
    list: (params: Record<string, unknown>) => ['ad-accounts', 'list', params] as const,
    lookup: ['ad-accounts', 'lookup'] as const,
    detail: (id: string) => ['ad-accounts', 'detail', id] as const,
    history: (id: string) => ['ad-accounts', 'history', id] as const,
    pixels: (id: string) => ['ad-accounts', 'pixels', id] as const,
    audiences: (id: string) => ['ad-accounts', 'audiences', id] as const,
    pages: (id: string) => ['ad-accounts', 'pages', id] as const,
    activity: (id: string, params: Record<string, unknown>) => ['ad-accounts', 'activity', id, params] as const,
  },
  creatives: {
    all: ['creatives'] as const,
    list: (params: Record<string, unknown>) => ['creatives', 'list', params] as const,
    usage: ['creatives', 'usage'] as const,
    detail: (id: string) => ['creatives', 'detail', id] as const,
  },
  templates: {
    all: ['templates'] as const,
    list: (params: Record<string, unknown>) => ['templates', 'list', params] as const,
    detail: (id: string) => ['templates', 'detail', id] as const,
  },
  drafts: {
    all: ['drafts'] as const,
    list: (params: Record<string, unknown>) => ['drafts', 'list', params] as const,
    detail: (id: string) => ['drafts', 'detail', id] as const,
  },
  launches: {
    all: ['launches'] as const,
    list: (params: Record<string, unknown>) => ['launches', 'list', params] as const,
    detail: (id: string) => ['launches', 'detail', id] as const,
  },
  campaigns: {
    all: ['campaigns'] as const,
    list: (params: Record<string, unknown>) => ['campaigns', 'list', params] as const,
    detail: (id: string, params: Record<string, unknown>) => ['campaigns', 'detail', id, params] as const,
    bulk: (id: string) => ['campaigns', 'bulk', id] as const,
  },
  statistics: {
    all: ['statistics'] as const,
    table: (params: Record<string, unknown>) => ['statistics', 'table', params] as const,
  },
  rules: {
    all: ['rules'] as const,
    list: (params: Record<string, unknown>) => ['rules', 'list', params] as const,
    detail: (id: string) => ['rules', 'detail', id] as const,
    executions: (params: Record<string, unknown>) => ['rules', 'executions', params] as const,
  },
  dashboard: (params: Record<string, unknown>) => ['dashboard', params] as const,
  admin: {
    users: {
      all: ['admin', 'users'] as const,
      list: (params: Record<string, unknown>) => ['admin', 'users', 'list', params] as const,
      detail: (id: string) => ['admin', 'users', 'detail', id] as const,
      search: (q: string) => ['admin', 'users', 'search', q] as const,
    },
    roles: ['admin', 'roles'] as const,
    permissions: ['admin', 'permissions'] as const,
    settings: ['admin', 'settings'] as const,
    audit: (params: Record<string, unknown>) => ['admin', 'audit', params] as const,
    logs: (params: Record<string, unknown>) => ['admin', 'logs', params] as const,
    metaLogs: (params: Record<string, unknown>) => ['admin', 'meta-logs', params] as const,
    broadcasts: {
      all: ['admin', 'broadcasts'] as const,
      list: (params: Record<string, unknown>) => ['admin', 'broadcasts', 'list', params] as const,
    },
  },
} as const;
