export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  roleId: string;
  roleKey: string;
  permissions: string[];
  timezone: string;
  sessionId: string;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  isAdmin: boolean;
}

/** Snapshot of the user cached in Redis for request authentication. */
export interface CachedUser {
  id: string;
  email: string;
  name: string | null;
  status: 'ACTIVE' | 'BLOCKED' | 'DELETED';
  roleId: string;
  timezone: string;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
}

export interface CachedRole {
  key: string;
  permissions: string[];
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}
