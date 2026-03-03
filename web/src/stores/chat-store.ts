import { create } from 'zustand';

interface ChatState {
  activeChannelId: string | null;
  setActiveChannel: (id: string | null) => void;
  typingUsers: Record<string, string[]>;
  setTyping: (channelId: string, userIds: string[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeChannelId: null,
  setActiveChannel: (id) => { set({ activeChannelId: id }); },
  typingUsers: {},
  setTyping: (channelId, userIds) => {
    set((state) => ({
      typingUsers: { ...state.typingUsers, [channelId]: userIds },
    }));
  },
}));
