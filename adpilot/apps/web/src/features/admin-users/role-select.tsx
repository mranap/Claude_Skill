'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/features/auth/auth-context';
import type { RoleDto } from '@/lib/api/types';
import { isPrivilegedRole } from './hooks';

/** Role picker. Administrative roles are disabled for non-Super-Admins (the API rejects them anyway). */
export function RoleSelect({
  roles,
  value,
  onValueChange,
  id,
  disabled,
  'aria-invalid': ariaInvalid,
}: {
  roles: RoleDto[] | undefined;
  value: string | undefined;
  onValueChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
}) {
  const { isSuperAdmin } = useAuth();
  return (
    <Select value={value ?? ''} onValueChange={onValueChange} disabled={disabled || !roles}>
      <SelectTrigger id={id} aria-invalid={ariaInvalid}>
        <SelectValue placeholder={roles ? 'Select a role' : 'Loading roles…'} />
      </SelectTrigger>
      <SelectContent>
        {(roles ?? []).map((role) => {
          const privileged = isPrivilegedRole(role);
          const locked = privileged && !isSuperAdmin;
          return (
            <SelectItem
              key={role.id}
              value={role.id}
              disabled={locked}
              description={
                locked
                  ? 'Only a Super Admin can assign administrative roles'
                  : (role.description ?? (privileged ? 'Administrative role' : undefined))
              }
            >
              {role.name}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
