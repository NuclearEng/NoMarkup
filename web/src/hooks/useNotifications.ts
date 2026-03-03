import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { useNotificationStore } from '@/stores/notification-store';
import type {
  NotificationsResponse,
  NotificationUnreadCountResponse,
  PreferencesResponse,
  UpdatePreferencesInput,
} from '@/types';

interface NotificationsParams {
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export function useNotifications(params?: NotificationsParams) {
  const searchParams = new URLSearchParams();
  if (params?.unreadOnly) searchParams.set('unread_only', 'true');
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.pageSize !== undefined) searchParams.set('page_size', String(params.pageSize));
  const query = searchParams.toString();
  const path = `/api/v1/notifications${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['notifications', params?.unreadOnly, params?.page, params?.pageSize],
    queryFn: () => api.get<NotificationsResponse>(path),
  });
}

export function useUnreadCount() {
  const setUnreadCount = useNotificationStore((state) => state.setUnreadCount);

  return useQuery({
    queryKey: ['notification-unread-count'],
    queryFn: async () => {
      const data = await api.get<NotificationUnreadCountResponse>('/api/v1/notifications/unread-count');
      setUnreadCount(data.count);
      return data;
    },
    refetchInterval: 30000,
  });
}

export function useMarkAsRead() {
  const queryClient = useQueryClient();
  const decrementUnread = useNotificationStore((state) => state.decrementUnread);

  return useMutation({
    mutationFn: (notificationId: string) =>
      api.post<unknown>(`/api/v1/notifications/${notificationId}/read`),
    onSuccess: () => {
      decrementUnread();
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] });
    },
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();
  const resetUnread = useNotificationStore((state) => state.resetUnread);

  return useMutation({
    mutationFn: () =>
      api.post<{ marked_count: number }>('/api/v1/notifications/read-all'),
    onSuccess: () => {
      resetUnread();
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['notification-unread-count'] });
    },
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api.get<PreferencesResponse>('/api/v1/notifications/preferences'),
  });
}

export function useUpdatePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdatePreferencesInput) =>
      api.put<PreferencesResponse>('/api/v1/notifications/preferences', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });
}
