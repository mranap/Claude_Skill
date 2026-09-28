'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { ErrorAlert } from '@/components/shared/error-alert';
import { useAuth } from '@/features/auth/auth-context';
import { useAdminSettings } from './api';
import { categoryBySlug, managePermission } from './categories';
import { AccountChecksSettingsForm } from './forms/account-checks-form';
import { BackupsSettingsForm } from './forms/backups-form';
import { FilesSettingsForm } from './forms/files-form';
import { GeneralSettingsForm } from './forms/general-form';
import { MaintenanceSettingsForm } from './forms/maintenance-form';
import { MetaSettingsForm } from './forms/meta-form';
import { QueueSettingsForm } from './forms/queue-form';
import { RetentionSettingsForm } from './forms/retention-form';
import { RulesSettingsForm } from './forms/rules-form';
import { SecuritySettingsForm } from './forms/security-form';
import { SmtpSettingsForm } from './forms/smtp-form';
import { StatisticsSettingsForm } from './forms/statistics-form';
import { TelegramSettingsForm } from './forms/telegram-form';

export function SettingsCategoryPage({ slug }: { slug: string }) {
  const { can } = useAuth();
  const settings = useAdminSettings();
  const category = categoryBySlug(slug);

  if (!category) return null;
  if (settings.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }
  if (settings.error) return <ErrorAlert error={settings.error} onRetry={() => void settings.refetch()} />;

  const data = settings.data;
  const readOnly = !can(managePermission(category.key));
  const env = data.environment;

  switch (category.key) {
    case 'general':
      return <GeneralSettingsForm values={data.general} readOnly={readOnly} />;
    case 'security':
      return <SecuritySettingsForm values={data.security} readOnly={readOnly} />;
    case 'files':
      return <FilesSettingsForm values={data.files} readOnly={readOnly} environment={env} />;
    case 'statistics':
      return <StatisticsSettingsForm values={data.statistics} readOnly={readOnly} />;
    case 'accountChecks':
      return <AccountChecksSettingsForm values={data.accountChecks} readOnly={readOnly} />;
    case 'rules':
      return <RulesSettingsForm values={data.rules} readOnly={readOnly} />;
    case 'meta':
      return <MetaSettingsForm values={data.meta} readOnly={readOnly} environment={env} />;
    case 'smtp':
      return <SmtpSettingsForm values={data.smtp} readOnly={readOnly} />;
    case 'telegram':
      return <TelegramSettingsForm values={data.telegram} readOnly={readOnly} environment={env} />;
    case 'queue':
      return <QueueSettingsForm values={data.queue} readOnly={readOnly} />;
    case 'retention':
      return <RetentionSettingsForm values={data.retention} readOnly={readOnly} />;
    case 'maintenance':
      return <MaintenanceSettingsForm values={data.maintenance} readOnly={readOnly} />;
    case 'backups':
      return <BackupsSettingsForm values={data.backups} readOnly={readOnly} />;
    default:
      return null;
  }
}
