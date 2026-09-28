'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import { notificationsApi } from './api';
import { PreferencesCard } from './preferences-card';
import { TelegramCard } from './telegram-card';

export function NotificationSettings() {
  const telegram = useQuery({
    queryKey: queryKeys.notifications.telegram,
    queryFn: notificationsApi.telegramStatus,
  });
  return (
    <div className="grid gap-6">
      <TelegramCard />
      <PreferencesCard telegramConnected={!!telegram.data?.connected} />
    </div>
  );
}
