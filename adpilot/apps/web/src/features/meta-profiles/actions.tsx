'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { getErrorMessage, getErrorTitle } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { pluralize } from '@/lib/utils/format';
import { metaProfilesApi } from './api';
import type { MetaProfileDto } from './types';

/** Token validation, sync and delete actions shared by the list and detail pages. */
export function useProfileActions() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.metaProfiles.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts.all }),
    ]);

  const validate = useMutation({
    mutationFn: (profile: MetaProfileDto) => metaProfilesApi.validate(profile.id),
    onSuccess: async (inspection, profile) => {
      if (inspection.valid && !inspection.missingRequired.length)
        toast.success(`Token of “${profile.name}” is valid`, { description: inspection.message });
      else if (inspection.valid)
        toast.warning('Token works, but permissions are missing', {
          description: inspection.missingRequired.join(', '),
        });
      else toast.error('Token check failed', { description: inspection.message });
      await invalidate();
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  const sync = useMutation({
    mutationFn: (profile: MetaProfileDto) => metaProfilesApi.sync(profile.id),
    onSuccess: async (_res, profile) => {
      toast.success('Synchronisation started', {
        description: `Business Managers, ad accounts, pages and pixels of “${profile.name}” are being refreshed.`,
      });
      await invalidate();
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  const testProxy = useMutation({
    mutationFn: (profile: MetaProfileDto) => metaProfilesApi.testProxy(profile.id),
    onSuccess: async (result) => {
      if (result.ok) toast.success('Proxy connection works', { description: result.message });
      else toast.error('Proxy test failed', { description: result.message });
      await invalidate();
    },
    onError: (error) => toast.error(getErrorTitle(error), { description: getErrorMessage(error) }),
  });

  return { validate, sync, testProxy, invalidate };
}

export function DeleteProfileDialog({
  profile,
  open,
  onOpenChange,
  redirectTo,
}: {
  profile: MetaProfileDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  redirectTo?: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title={`Delete “${profile.name}”?`}
      description={
        <>
          The access token{profile.hasAppSecret ? ', app secret' : ''}
          {profile.proxy?.hasPassword ? ' and proxy password are' : ' is'} destroyed.{' '}
          {profile.counts.connectedAdAccounts
            ? `${pluralize(profile.counts.connectedAdAccounts, 'connected ad account')} stop being monitored and automated rules on them stop acting.`
            : 'No connected ad accounts are affected.'}{' '}
          Campaigns already running at Meta are not changed.
        </>
      }
      confirmText={profile.name}
      confirmLabel="Delete profile"
      onConfirm={async () => {
        await metaProfilesApi.remove(profile.id);
        toast.success(`Profile “${profile.name}” deleted`);
        queryClient.removeQueries({ queryKey: queryKeys.metaProfiles.detail(profile.id) });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.metaProfiles.all }),
          queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts.all }),
        ]);
        if (redirectTo) router.push(redirectTo);
      }}
    />
  );
}

/** Small state helper for dialogs that act on one profile at a time. */
export function useProfileDialog() {
  const [state, setState] = useState<{ kind: 'edit' | 'delete'; profile: MetaProfileDto } | null>(null);
  return {
    state,
    open: (kind: 'edit' | 'delete', profile: MetaProfileDto) => setState({ kind, profile }),
    close: () => setState(null),
  };
}
