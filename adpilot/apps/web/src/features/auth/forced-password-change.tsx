'use client';

import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Logo } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/api/query-keys';
import { ChangePasswordForm } from '@/features/account/change-password-form';
import { AuthCard } from './auth-card';
import { useAuth } from './auth-context';

/**
 * Blocking screen shown while `mustChangePassword` is set (after an administrator created the account
 * with a temporary password or reset it). Every other API call answers PASSWORD_CHANGE_REQUIRED until the
 * password is changed.
 */
export function ForcedPasswordChange() {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <AuthCard
          icon={<KeyRound />}
          title="Set a new password"
          description={
            <>
              Your administrator set a temporary password for <span className="font-medium text-foreground">{user.email}</span>.
              Choose your own password to continue.
            </>
          }
          footer={
            <Button variant="link" size="sm" onClick={() => void signOut()} className="text-muted-foreground">
              <LogOut />
              Sign out
            </Button>
          }
        >
          <ChangePasswordForm
            currentPasswordLabel="Temporary password"
            submitLabel="Save password and continue"
            fullWidthSubmit
            onSuccess={async () => {
              toast.success('Password updated', { description: 'Welcome to AdPilot.' });
              await queryClient.invalidateQueries({ queryKey: queryKeys.me });
            }}
          />
        </AuthCard>
      </div>
    </div>
  );
}
