import type { NotificationChannelPref, NotificationType } from '@adpilot/shared';
import { api } from '@/lib/api/client';
import type {
  NotificationListResponse,
  NotificationPreferenceDto,
  OkResponse,
  TelegramLinkDto,
  TelegramStatusDto,
} from '@/lib/api/types';

export const notificationsApi = {
  list: (params: { page?: number; pageSize?: number; unreadOnly?: boolean }) =>
    api.get<NotificationListResponse>('/notifications', {
      page: params.page,
      pageSize: params.pageSize,
      unreadOnly: params.unreadOnly ? 'true' : undefined,
    }),
  unreadCount: () => api.get<{ unread: number }>('/notifications/unread-count'),
  markRead: (id: string) => api.post<OkResponse>(`/notifications/${id}/read`),
  markAllRead: () => api.post<{ updated: number }>('/notifications/read-all'),
  preferences: () => api.get<NotificationPreferenceDto[]>('/notifications/preferences'),
  savePreferences: (preferences: { type: NotificationType; channel: NotificationChannelPref }[]) =>
    api.put<NotificationPreferenceDto[]>('/notifications/preferences', { preferences }),
  sendTest: () => api.post<{ notificationId: string }>('/notifications/test'),
  telegramStatus: () => api.get<TelegramStatusDto>('/notifications/telegram'),
  telegramLink: () => api.post<TelegramLinkDto>('/notifications/telegram/link'),
  telegramUnlink: () => api.delete<OkResponse>('/notifications/telegram'),
};
