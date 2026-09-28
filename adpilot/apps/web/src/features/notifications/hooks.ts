'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { notificationsApi } from './api';

export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    select: (data) => data.unread,
  });
}

export function useLatestNotifications(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.notifications.latest,
    queryFn: () => notificationsApi.list({ page: 1, pageSize: 8 }),
    enabled,
    staleTime: 15_000,
  });
}

export function useNotificationList(params: { page: number; pageSize: number; unreadOnly: boolean }) {
  return useQuery({
    queryKey: queryKeys.notifications.list(params),
    queryFn: () => notificationsApi.list(params),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateNotifications() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
}

export function useMarkRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: notificationsApi.markRead,
    onSettled: invalidate,
  });
}

export function useMarkAllRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: (res) => {
      toast.success(
        res.updated
          ? `Marked ${res.updated} notification${res.updated === 1 ? '' : 's'} as read`
          : 'Everything is already read',
      );
    },
    onError: (err) =>
      toast.error('Could not mark notifications as read', { description: getErrorMessage(err) }),
    onSettled: invalidate,
  });
}
