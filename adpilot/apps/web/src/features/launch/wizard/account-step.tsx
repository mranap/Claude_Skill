'use client';

import { Briefcase, Plug } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorAlert } from '@/components/shared/error-alert';
import { FormField } from '@/components/shared/form';
import { KeyValueList } from '@/components/shared/key-value';
import { AdAccountStatusBadge, MetaProfileStatusBadge } from '@/components/product/status';
import { formatAmount } from '@/lib/utils/money';
import { useConnectedAdAccounts } from '../../ad-accounts/api';
import type { AdAccountDto } from '../../ad-accounts/types';
import { SelectInput, SettingsSection } from '../../campaign-settings/fields';
import type { WizardValues } from './steps';

export function AccountStep({ disabled }: { disabled?: boolean }) {
  const form = useFormContext<WizardValues>();
  const accounts = useConnectedAdAccounts();
  const [profileId, adAccountId] = useWatch({ control: form.control, name: ['profileId', 'adAccountId'] });
  const all = useMemo(() => accounts.data ?? [], [accounts.data]);
  const profiles = useMemo(() => [...new Map(all.map((a) => [a.profileId, { id: a.profileId, name: a.profileName, status: a.profileStatus }])).values()], [all]);
  const profileAccounts = all.filter((a) => a.profileId === profileId);
  const account = all.find((a) => a.id === adAccountId);
  const profile = profiles.find((p) => p.id === profileId);

  // Convenience: preselect the only profile / account.
  useEffect(() => {
    if (disabled || accounts.isLoading) return;
    if (!form.getValues('profileId') && profiles.length === 1) form.setValue('profileId', profiles[0]!.id, { shouldDirty: true });
  }, [disabled, accounts.isLoading, profiles, form]);

  if (accounts.isLoading) return <Skeleton className="h-64 rounded-lg" />;
  if (accounts.isError) return <ErrorAlert error={accounts.error} onRetry={() => void accounts.refetch()} />;
  if (!all.length) {
    return (
      <SettingsSection title="Where to launch" description="Launches go to a connected ad account of one of your Meta profiles.">
        <EmptyState
          icon={Briefcase}
          title="No connected ad accounts"
          description="Add a Meta profile and connect at least one ad account before launching."
          action={
            <Button asChild>
              <Link href="/meta-profiles">
                <Plug />
                Meta profiles
              </Link>
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Where to launch" description="The Meta profile's token and proxy are used for every request of this launch.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="profileId"
          label="Meta profile"
          required
          render={({ field, controlProps }) => (
            <SelectInput
              controlProps={controlProps}
              value={field.value || undefined}
              disabled={disabled}
              placeholder="Choose a profile"
              onChange={(v) => {
                field.onChange(v);
                const current = form.getValues('adAccountId');
                if (current && !all.some((a) => a.id === current && a.profileId === v)) form.setValue('adAccountId', '', { shouldDirty: true });
              }}
              options={profiles.map((p) => ({ value: p.id, label: p.name, description: p.status === 'ACTIVE' ? 'Token active' : `Token ${p.status.toLowerCase().replace('_', ' ')}` }))}
            />
          )}
        />
        <FormField
          control={form.control}
          name="adAccountId"
          label="Ad account"
          required
          description={profileId && !profileAccounts.length ? 'This profile has no connected ad accounts.' : undefined}
          render={({ field, controlProps }) => (
            <SelectInput
              controlProps={controlProps}
              value={field.value || undefined}
              onChange={field.onChange}
              disabled={disabled || !profileId}
              placeholder={profileId ? 'Choose an ad account' : 'Choose a profile first'}
              options={profileAccounts.map((a) => ({ value: a.id, label: a.name, description: `act_${a.metaAccountId} · ${a.currency} · ${a.statusLabel}` }))}
            />
          )}
        />
      </div>
      {profile && profile.status !== 'ACTIVE' ? (
        <Alert variant="destructive">
          <AlertTitle>The token of this profile is not active</AlertTitle>
          <AlertDescription>Launches need a working token. Fix it on the Meta profile page first.</AlertDescription>
        </Alert>
      ) : null}
      {account ? <AccountSummary account={account} /> : null}
    </SettingsSection>
  );
}

function AccountSummary({ account }: { account: AdAccountDto }) {
  return (
    <div className="grid gap-3 rounded-lg border bg-surface-subtle p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{account.name}</span>
        <AdAccountStatusBadge statusKey={account.statusKey} label={account.statusLabel} tone={account.statusTone} size="sm" />
        {account.profileStatus !== 'ACTIVE' ? <MetaProfileStatusBadge status={account.profileStatus} size="sm" /> : null}
      </div>
      <KeyValueList
        items={[
          { label: 'Account id', value: `act_${account.metaAccountId}`, mono: true },
          { label: 'Currency', value: `${account.currency} — every amount of this launch is in ${account.currency}` },
          { label: 'Time zone', value: account.timezoneName },
          { label: 'Minimum daily budget', value: formatAmount(account.minDailyBudget, account.currency) },
          { label: 'DSA beneficiary / payer', value: account.defaultDsaBeneficiary || account.defaultDsaPayor ? `${account.defaultDsaBeneficiary ?? '—'} / ${account.defaultDsaPayor ?? '—'}` : 'No defaults (required for EU targeting)' },
        ]}
      />
      {account.statusTone === 'danger' ? (
        <p className="text-sm text-destructive-fg">This account cannot run ads right now ({account.statusLabel}{account.disableReasonLabel ? ` — ${account.disableReasonLabel}` : ''}).</p>
      ) : null}
    </div>
  );
}
