import { beforeEach, describe, expect, it } from 'vitest';

import { useNotificationStore } from '@/stores/notification-store';

describe('useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ unreadCount: 0 });
  });

  describe('initial state', () => {
    it('starts with unreadCount of 0', () => {
      const state = useNotificationStore.getState();
      expect(state.unreadCount).toBe(0);
    });
  });

  describe('setUnreadCount', () => {
    it('sets the unread count to a specific value', () => {
      useNotificationStore.getState().setUnreadCount(5);
      expect(useNotificationStore.getState().unreadCount).toBe(5);
    });

    it('overwrites the previous value', () => {
      useNotificationStore.getState().setUnreadCount(10);
      useNotificationStore.getState().setUnreadCount(3);
      expect(useNotificationStore.getState().unreadCount).toBe(3);
    });

    it('accepts zero', () => {
      useNotificationStore.getState().setUnreadCount(7);
      useNotificationStore.getState().setUnreadCount(0);
      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });
  });

  describe('decrementUnread', () => {
    it('decreases the unread count by 1', () => {
      useNotificationStore.getState().setUnreadCount(3);
      useNotificationStore.getState().decrementUnread();
      expect(useNotificationStore.getState().unreadCount).toBe(2);
    });

    it('does not go below 0 when called on zero', () => {
      useNotificationStore.getState().decrementUnread();
      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });

    it('clamps to 0 when called repeatedly past available count', () => {
      useNotificationStore.getState().setUnreadCount(2);
      useNotificationStore.getState().decrementUnread();
      useNotificationStore.getState().decrementUnread();
      useNotificationStore.getState().decrementUnread();
      useNotificationStore.getState().decrementUnread();
      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });
  });

  describe('resetUnread', () => {
    it('resets the count to 0', () => {
      useNotificationStore.getState().setUnreadCount(42);
      useNotificationStore.getState().resetUnread();
      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });

    it('is a no-op when count is already 0', () => {
      useNotificationStore.getState().resetUnread();
      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });
  });
});
