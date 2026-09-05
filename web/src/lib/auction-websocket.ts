import { resolveWsBase } from './constants';
import { ConnectionStability, backoffDelayMs } from '@/lib/ws-backoff';

export type AuctionMessageType = 'bid_event' | 'auction_state' | 'snipe_extended' | 'auction_ended';

export interface AuctionMessage {
  type: AuctionMessageType;
  job_id: string;
  data?: {
    type: string;
    job_id: string;
    amount_cents: number;
    timestamp: string;
  };
  error?: string;
}

type AuctionMessageListener = (message: AuctionMessage) => void;

export type AuctionConnectionStatus = 'connecting' | 'connected' | 'disconnected';
type StatusListener = (status: AuctionConnectionStatus) => void;

/** Refreshes the access token; resolves true if a fresh token is now available. */
type TokenRefresher = () => Promise<boolean>;

class AuctionWebSocketManager {
  private ws: WebSocket | null = null;
  private jobId: string | null = null;
  private tokenGetter: (() => string | null) | null = null;
  /**
   * Refreshes the access token before a reconnect. The 15-min token can expire
   * while a user idles on an auction page with no HTTP activity; re-dialing
   * with the stale token would 401 and loop on backoff. We refresh first so
   * tokenGetter() then returns a fresh token (BUG 2).
   */
  private tokenRefresher: TokenRefresher | null = null;
  private messageListeners: Set<AuctionMessageListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private reconnectAttempts = 0;
  private readonly stability = new ConnectionStability();
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: AuctionConnectionStatus = 'disconnected';
  private connectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private auctionEnded = false;

  connect(
    jobId: string,
    token: string,
    tokenGetter?: () => string | null,
    tokenRefresher?: TokenRefresher,
  ): void {
    // Debounce for React StrictMode
    if (this.connectDebounceTimer) {
      clearTimeout(this.connectDebounceTimer);
    }

    this.connectDebounceTimer = setTimeout(() => {
      this.doConnect(jobId, token, tokenGetter, tokenRefresher);
    }, 100);
  }

  private doConnect(
    jobId: string,
    token: string,
    tokenGetter?: () => string | null,
    tokenRefresher?: TokenRefresher,
  ): void {
    if (this.ws && this.jobId === jobId) return;

    this.disconnect();
    this.jobId = jobId;
    this.auctionEnded = false;
    if (tokenGetter) {
      this.tokenGetter = tokenGetter;
    }
    if (tokenRefresher) {
      this.tokenRefresher = tokenRefresher;
    }

    const wsBase = resolveWsBase();
    const url = `${wsBase}/ws/auction/${jobId}`;

    this.updateStatus('connecting');
    // JWT rides as a second subprotocol — browsers cannot set Authorization
    // on WebSocket. URL must not contain ?token=.
    this.ws = new WebSocket(url, ['nomarkup.bearer.v1', token]);

    this.ws.onopen = () => {
      // Do NOT reset the attempt counter here. The gateway accepts the
      // upgrade before dialing the backend, so during an outage the browser
      // sees onopen immediately followed by onclose — resetting here pinned
      // the delay at ~1s and produced a reconnect hot loop. The reset happens
      // in onclose, and only if the socket stayed open long enough to count
      // as a real connection. See @/lib/ws-backoff.
      this.stability.opened();
      this.updateStatus('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const message: AuctionMessage = JSON.parse(event.data as string) as AuctionMessage;
        this.messageListeners.forEach((listener) => {
          listener(message);
        });
        // Once the server signals the auction is over, stop reconnect attempts.
        // Otherwise the badge would flicker between connecting/disconnected for
        // an auction that no longer accepts subscribers.
        if (message.type === 'auction_ended') {
          this.auctionEnded = true;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      // Drop the reference to the dead socket. doConnect() guards on
      // `this.ws && this.jobId === jobId` and would otherwise short-circuit the
      // reconnect (the closed socket would look like a live one for the same
      // job), so a dropped auction socket would never actually re-dial.
      this.ws = null;
      this.updateStatus('disconnected');
      // Reset the backoff only for a connection that survived the stability
      // window. An open that closed immediately was a failed attempt and must
      // keep escalating — see @/lib/ws-backoff.
      if (this.stability.closed()) {
        this.reconnectAttempts = 0;
      }
      if (!this.auctionEnded) {
        this.attemptReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  disconnect(): void {
    if (this.connectDebounceTimer) {
      clearTimeout(this.connectDebounceTimer);
      this.connectDebounceTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.jobId = null;
    this.tokenGetter = null;
    this.tokenRefresher = null;
    this.reconnectAttempts = 0;
    this.updateStatus('disconnected');
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || !this.jobId) return;

    const freshToken = this.tokenGetter ? this.tokenGetter() : null;
    if (!freshToken) return;

    const delay = backoffDelayMs(this.reconnectAttempts);
    this.reconnectAttempts++;

    // Capture the hooks now: doConnect() calls disconnect() first, which nulls
    // them, so we must re-pass them through to keep getter/refresher alive
    // across successive reconnects.
    const tokenGetter = this.tokenGetter;
    const tokenRefresher = this.tokenRefresher;

    this.reconnectTimer = setTimeout(() => {
      // Refresh the (possibly expired) token before re-dialing so reconnect
      // uses a fresh token instead of looping on 401 (BUG 2). Reconnect even
      // if the refresh fails — tokenGetter may still yield a usable token, and
      // a hard auth failure should surface through the normal close/retry path.
      const refresh = tokenRefresher
        ? tokenRefresher()
        : Promise.resolve(false);
      void refresh.finally(() => {
        const jobId = this.jobId;
        const token = tokenGetter ? tokenGetter() : null;
        if (jobId && token) {
          this.doConnect(jobId, token, tokenGetter ?? undefined, tokenRefresher ?? undefined);
        }
      });
    }, delay);
  }

  private updateStatus(status: AuctionConnectionStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => {
      listener(status);
    });
  }

  onMessage(listener: AuctionMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): AuctionConnectionStatus {
    return this.status;
  }
}

export const auctionWsManager = new AuctionWebSocketManager();
