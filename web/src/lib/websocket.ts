import { getAccessToken } from '@/lib/auth';
import { API_BASE_URL } from '@/lib/constants';

// ─── WebSocket message types (Client → Server) ───────────────────
const WS_CLIENT_MSG = {
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  TYPING: 'typing',
} as const;
type WsClientMsgType = (typeof WS_CLIENT_MSG)[keyof typeof WS_CLIENT_MSG];

// ─── WebSocket message types (Server → Client) ───────────────────
export const WS_SERVER_MSG = {
  MESSAGE: 'message',
  TYPING: 'typing',
  UNREAD_UPDATE: 'unread_update',
} as const;
export type WsServerMsgType = (typeof WS_SERVER_MSG)[keyof typeof WS_SERVER_MSG];

// ─── Outbound message shapes ─────────────────────────────────────
interface WsClientMessage {
  type: WsClientMsgType;
  channel_id: string;
}

// ─── Inbound message shapes ─────────────────────────────────────
export interface WsMessagePayload {
  type: typeof WS_SERVER_MSG.MESSAGE;
  channel_id: string;
  message: {
    id: string;
    channel_id: string;
    sender_id: string;
    message_type: string;
    content: string;
    attachment_url?: string;
    attachment_name?: string;
    flagged_contact_info: boolean;
    is_deleted: boolean;
    created_at: string;
  };
}

export interface WsTypingPayload {
  type: typeof WS_SERVER_MSG.TYPING;
  channel_id: string;
  user_id: string;
}

export interface WsUnreadUpdatePayload {
  type: typeof WS_SERVER_MSG.UNREAD_UPDATE;
  channel_id: string;
  unread_count: number;
}

export type WsServerMessage = WsMessagePayload | WsTypingPayload | WsUnreadUpdatePayload;

// ─── Connection status ───────────────────────────────────────────
export const CONNECTION_STATUS = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
} as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

// ─── Listener callback type ──────────────────────────────────────
type MessageListener = (message: WsServerMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;

// ─── Configuration ───────────────────────────────────────────────
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const RECONNECT_BACKOFF_MULTIPLIER = 2;

// ─── Singleton WebSocket Manager ─────────────────────────────────
class WebSocketManager {
  private socket: WebSocket | null = null;
  private messageListeners: Set<MessageListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private status: ConnectionStatus = CONNECTION_STATUS.DISCONNECTED;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private outboundQueue: WsClientMessage[] = [];
  private intentionalClose = false;

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  get isConnected(): boolean {
    return this.status === CONNECTION_STATUS.CONNECTED;
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const token = getAccessToken();
    if (!token) {
      return;
    }

    this.intentionalClose = false;
    this.setStatus(CONNECTION_STATUS.CONNECTING);

    const wsUrl = API_BASE_URL.replace(/^http/, 'ws');
    this.socket = new WebSocket(`${wsUrl}/ws/chat?token=${encodeURIComponent(token)}`);

    this.socket.onopen = () => {
      this.setStatus(CONNECTION_STATUS.CONNECTED);
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.flushQueue();
    };

    this.socket.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as WsServerMessage;
        for (const listener of this.messageListeners) {
          listener(data);
        }
      } catch {
        // Malformed message; skip silently
      }
    };

    this.socket.onclose = () => {
      this.socket = null;
      this.setStatus(CONNECTION_STATUS.DISCONNECTED);

      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = () => {
      // The browser will fire onclose after onerror; reconnect is handled there.
    };
  }

  disconnect(): void {
    this.intentionalClose = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.outboundQueue = [];
    this.setStatus(CONNECTION_STATUS.DISCONNECTED);
  }

  send(message: WsClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      this.outboundQueue.push(message);
    }
  }

  subscribe(channelId: string): void {
    this.send({ type: WS_CLIENT_MSG.SUBSCRIBE, channel_id: channelId });
  }

  unsubscribe(channelId: string): void {
    this.send({ type: WS_CLIENT_MSG.UNSUBSCRIBE, channel_id: channelId });
  }

  sendTyping(channelId: string): void {
    this.send({ type: WS_CLIENT_MSG.TYPING, channel_id: channelId });
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_BACKOFF_MULTIPLIER,
      MAX_RECONNECT_DELAY_MS,
    );
  }

  private flushQueue(): void {
    const pending = [...this.outboundQueue];
    this.outboundQueue = [];
    for (const msg of pending) {
      this.send(msg);
    }
  }
}

/** Singleton instance for the entire application */
export const wsManager = new WebSocketManager();
