import { attemptRefresh } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { resolveWsBase } from '@/lib/constants';
import {
  ConnectionStability,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  RECONNECT_BACKOFF_MULTIPLIER,
  jitter,
} from '@/lib/ws-backoff';

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
  /** Peer MarkRead watermark — flips Sent → Seen without REST poll. */
  READ_RECEIPT: 'read_receipt',
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

export interface WsReadReceiptPayload {
  type: typeof WS_SERVER_MSG.READ_RECEIPT;
  channel_id: string;
  user_id: string;
  /** RFC3339 peer MarkRead watermark. */
  last_read_at?: string;
}

export type WsServerMessage =
  | WsMessagePayload
  | WsTypingPayload
  | WsUnreadUpdatePayload
  | WsReadReceiptPayload;

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

/**
 * Debounce delay for connect(). This absorbs React StrictMode's
 * rapid mount -> unmount -> remount cycle so we never open a WebSocket
 * that gets immediately closed before the handshake completes.
 */
const CONNECT_DEBOUNCE_MS = 100;

// ─── Singleton WebSocket Manager ─────────────────────────────────
class WebSocketManager {
  private socket: WebSocket | null = null;
  private messageListeners: Set<MessageListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private status: ConnectionStatus = CONNECTION_STATUS.DISCONNECTED;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private readonly stability = new ConnectionStability();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private outboundQueue: WsClientMessage[] = [];
  private intentionalClose = false;
  /**
   * Channels the app currently wants a live subscription to. The server
   * subscription state lives on the socket, so it is lost on every drop;
   * we replay a `subscribe` frame for each tracked channel on (re)open so a
   * reconnected socket isn't silently subscription-less (BUG 1).
   */
  private activeSubscriptions: Set<string> = new Set();

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  get isConnected(): boolean {
    return this.status === CONNECTION_STATUS.CONNECTED;
  }

  /**
   * Request a WebSocket connection. The actual socket open is debounced
   * by CONNECT_DEBOUNCE_MS so that React StrictMode's rapid
   * mount -> cleanup -> remount cycle cancels the first attempt
   * via disconnect() before the socket is ever created.
   */
  connect(): void {
    // If already connected or mid-handshake, nothing to do.
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    // Clear intentional-close so the debounced open will proceed
    // even after a StrictMode cleanup called disconnect().
    this.intentionalClose = false;

    // If a connect is already scheduled, let it stand.
    if (this.connectTimer !== null) {
      return;
    }

    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      this.openSocket();
    }, CONNECT_DEBOUNCE_MS);
  }

  /**
   * Actually opens the WebSocket. Called after the debounce window
   * so that a StrictMode unmount can cancel it via disconnect().
   */
  private openSocket(): void {
    // Re-check: disconnect() may have been called during the debounce.
    if (this.intentionalClose) {
      return;
    }

    // Guard against double-open.
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const token = getAccessToken();
    if (!token) {
      return;
    }

    this.setStatus(CONNECTION_STATUS.CONNECTING);

    // Derive WebSocket URL. Prefer the shared resolver so everything (chat,
    // auction, spectator, marketplace) uses same-origin proxy when possible.
    const wsBase =
      resolveWsBase() ||
      (typeof window !== 'undefined'
        ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
        : '');
    // JWT rides as a second subprotocol — browsers cannot set Authorization
    // on WebSocket. URL must not contain ?token=.
    this.socket = new WebSocket(`${wsBase}/ws/chat`, ['nomarkup.bearer.v1', token]);

    this.socket.onopen = () => {
      this.setStatus(CONNECTION_STATUS.CONNECTED);
      // Deliberately NOT resetting the backoff here. The gateway accepts the
      // upgrade before dialing the chat backend, so during a backend outage
      // the browser sees onopen followed immediately by onclose — resetting
      // here kept the delay pinned at 1s forever, and because the reconnect
      // path also calls attemptRefresh(), each open tab generated ~2 gateway
      // requests per second for the duration of the outage. The reset now
      // happens in onclose, only if the socket stayed open long enough to
      // count as a real connection.
      this.stability.opened();
      // Re-establish subscriptions FIRST (before flushing the disconnect-time
      // queue) so a reconnected socket is subscribed to the active channel(s)
      // even when nothing was queued. Without this the socket shows
      // "connected" but receives no messages/typing for the channel.
      this.replaySubscriptions();
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

      // A connection that survived the stability window was genuinely healthy,
      // so the next outage starts from the base delay again. One that closed
      // immediately was a failed attempt and must keep escalating.
      if (this.stability.closed()) {
        this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      }

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

    // Cancel a pending debounced connect so the socket never opens.
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.outboundQueue = [];
    this.activeSubscriptions.clear();
    // An explicit disconnect ends the session, so a later connect() is a fresh
    // start and must not inherit backoff accumulated during an old outage.
    // This used to happen implicitly because onopen reset the delay on every
    // open; now that the reset is gated on a stably-held connection, the
    // teardown path has to do it explicitly.
    this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    this.stability.reset();
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
    // Remember the channel so we can re-subscribe on every (re)connect.
    this.activeSubscriptions.add(channelId);
    this.send({ type: WS_CLIENT_MSG.SUBSCRIBE, channel_id: channelId });
  }

  unsubscribe(channelId: string): void {
    this.activeSubscriptions.delete(channelId);
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
      // Refresh the access token before re-dialing. An idle socket's 15-min
      // token may have expired while down; reconnecting with the stale token
      // would 401 and loop on backoff forever. attemptRefresh() updates the
      // in-memory token (no-op/fast if still valid) so openSocket() reads a
      // fresh one. We reconnect regardless of refresh outcome — a failed
      // refresh still lets connect() retry (and surface auth failure normally).
      void attemptRefresh().finally(() => {
        if (!this.intentionalClose) {
          this.connect();
        }
      });
    }, jitter(this.reconnectDelay));

    this.reconnectDelay = Math.min(
      this.reconnectDelay * RECONNECT_BACKOFF_MULTIPLIER,
      MAX_RECONNECT_DELAY_MS,
    );
  }

  /**
   * Re-send a `subscribe` frame for every channel the app is tracking. Called
   * on each socket open so a fresh socket (after a reconnect) is subscribed to
   * the active channel(s). Sends directly (not via subscribe()) to avoid
   * mutating the tracking set while iterating it.
   */
  private replaySubscriptions(): void {
    for (const channelId of this.activeSubscriptions) {
      this.send({ type: WS_CLIENT_MSG.SUBSCRIBE, channel_id: channelId });
    }
  }

  private flushQueue(): void {
    const pending = [...this.outboundQueue];
    this.outboundQueue = [];
    for (const msg of pending) {
      // Subscribe/unsubscribe frames are replayed authoritatively from
      // activeSubscriptions in replaySubscriptions(); skip the queued copies so
      // we don't double-send a subscribe (or resurrect a since-unsubscribed
      // channel). Only transient frames (typing) flow through here.
      if (msg.type === WS_CLIENT_MSG.SUBSCRIBE || msg.type === WS_CLIENT_MSG.UNSUBSCRIBE) {
        continue;
      }
      this.send(msg);
    }
  }
}

/** Singleton instance for the entire application */
export const wsManager = new WebSocketManager();
