import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
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
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const searchParams = new URLSearchParams();
  if (params?.unreadOnly) searchParams.set('unread_only', 'true');
  if (params?.page !== undefined) searchParams.set('page', String(params.page));
  if (params?.pageSize !== undefined) searchParams.set('page_size', String(params.pageSize));
  const query = searchParams.toString();
  const path = `/api/v1/notifications${query ? `?${query}` : ''}`;

  return useQuery({
    queryKey: ['notifications', params?.unreadOnly, params?.page, params?.pageSize],
    queryFn: () => api.get<NotificationsResponse>(path),
    enabled: isAuthenticated,
  });
}

export function useUnreadCount() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const setUnreadCount = useNotificationStore((state) => state.setUnreadCount);
  const queryClient = useQueryClient();
  // Remember the last-seen count so a poll that observes a HIGHER count (a new
  // notification arrived) can refresh the notification *list* too. Without this,
  // the polled count badge updates but the bell dropdown / notifications page
  // keep showing stale rows until a manual reload — the "doesn't appear until
  // refresh" gap. There is no notification push channel server-side (no WS/SSE
  // endpoint exists), so the poll is the live signal; we fan it out to the list.
  const prevCountRef = useRef<number | null>(null);

  return useQuery({
    queryKey: ['notification-unread-count'],
    queryFn: async () => {
      const data = await api.get<NotificationUnreadCountResponse>('/api/v1/notifications/unread-count');
      setUnreadCount(data.count);

      const prev = prevCountRef.current;
      prevCountRef.current = data.count;
      // First load (prev === null) is hydrated by the list query's own fetch;
      // only react to a subsequent INCREASE so we don't refetch on every poll.
      if (prev !== null && data.count > prev) {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }

      return data;
    },
    refetchInterval: 30000,
    enabled: isAuthenticated,
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
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api.get<PreferencesResponse>('/api/v1/notifications/preferences'),
    enabled: isAuthenticated,
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
