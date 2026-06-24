import { resolveWsBase } from './constants';

// ─── Wire-format types (mirror gateway/internal/handler/marketplace_spectator_ws.go) ───

export type MarketplaceSpectatorMessageType = 'bid_event' | 'spectator_count';

/**
 * Server payload pushed for a bid_event. The 3-second anti-front-running delay
 * is enforced server-side; the client just delivers whatever it receives.
 */
export type MarketplaceBidEventType = 'bid_placed' | 'bid_withdrawn' | (string & {});

export interface MarketplaceBidEventData {
  type: MarketplaceBidEventType;
  listing_id: string;
  amount_cents: number;
  snipe_extension: boolean;
  snipe_extension_count: number;
  new_auction_ends_at: string | null;
  timestamp: string;
}

export interface MarketplaceSpectatorMessage {
  type: MarketplaceSpectatorMessageType;
  listing_id: string;
  data?: MarketplaceBidEventData;
  spectator_count?: number;
}

export type MarketplaceConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type BidListener = (event: MarketplaceBidEventData) => void;
type SpectatorCountListener = (count: number) => void;
type ConnectionListener = (status: MarketplaceConnectionStatus) => void;

export type MarketplaceSpectatorEvent = 'bid' | 'spectator_count' | 'connection';

/**
 * Spectator WebSocket client for the goods marketplace listing detail page.
 *
 * Server contract: GET /ws/marketplace/{listingId}/spectate (anonymous, same-origin).
 * Server pushes:
 *   - { type: "bid_event", listing_id, data: {...} }   (with 3s anti-front-running delay)
 *   - { type: "spectator_count", listing_id, spectator_count }   (every 10s)
 *
 * The client supports auto-reconnect with exponential backoff (1s → 30s cap)
 * and replies to ping frames automatically (browser WebSocket built-in).
 */
export class MarketplaceSpectatorClient {
  private ws: WebSocket | null = null;
  private listingId: string | null = null;
  private bidListeners: Set<BidListener> = new Set();
  private spectatorCountListeners: Set<SpectatorCountListener> = new Set();
  private connectionListeners: Set<ConnectionListener> = new Set();
  private status: MarketplaceConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitlyClosed = false;

  /** Connect to the spectator stream for a listing. Debounced 100ms (StrictMode-safe). */
  connect(listingId: string): void {
    this.explicitlyClosed = false;

    if (this.connectDebounceTimer) {
      clearTimeout(this.connectDebounceTimer);
    }

    this.connectDebounceTimer = setTimeout(() => {
      this.doConnect(listingId);
    }, 100);
  }

  private doConnect(listingId: string): void {
    if (this.ws && this.listingId === listingId && this.ws.readyState !== WebSocket.CLOSED) {
      return;
    }

    this.closeSocket();
    this.listingId = listingId;

    const wsBase = resolveWsBase();
    const url = `${wsBase}/ws/marketplace/${listingId}/spectate`;

    this.updateStatus('connecting');

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.updateStatus('disconnected');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.updateStatus('connected');
    };

    this.ws.onmessage = (event) => {
      this.handleRawMessage(event.data);
    };

    this.ws.onclose = () => {
      this.updateStatus('disconnected');
      if (!this.explicitlyClosed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror; reconnect is handled there.
    };
  }

  private handleRawMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let parsed: MarketplaceSpectatorMessage;
    try {
      parsed = JSON.parse(raw) as MarketplaceSpectatorMessage;
    } catch {
      return;
    }

    if (parsed.type === 'bid_event' && parsed.data) {
      this.bidListeners.forEach((listener) => {
        listener(parsed.data as MarketplaceBidEventData);
      });
      return;
    }

    if (parsed.type === 'spectator_count' && typeof parsed.spectator_count === 'number') {
      const count = parsed.spectator_count;
      this.spectatorCountListeners.forEach((listener) => {
        listener(count);
      });
    }
  }

  /** Permanently disconnect; cancels any pending reconnect. */
  disconnect(): void {
    this.explicitlyClosed = true;

    if (this.connectDebounceTimer) {
      clearTimeout(this.connectDebounceTimer);
      this.connectDebounceTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.closeSocket();
    this.listingId = null;
    this.reconnectAttempts = 0;
    this.updateStatus('disconnected');
  }

  private closeSocket(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.explicitlyClosed) return;
    if (!this.listingId) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      if (this.listingId && !this.explicitlyClosed) {
        this.doConnect(this.listingId);
      }
    }, delayMs);
  }

  private updateStatus(status: MarketplaceConnectionStatus): void {
    this.status = status;
    this.connectionListeners.forEach((listener) => {
      listener(status);
    });
  }

  /** Subscribe to a server-event channel. Returns an unsubscribe function. */
  on(event: 'bid', listener: BidListener): () => void;
  on(event: 'spectator_count', listener: SpectatorCountListener): () => void;
  on(event: 'connection', listener: ConnectionListener): () => void;
  on(
    event: MarketplaceSpectatorEvent,
    listener: BidListener | SpectatorCountListener | ConnectionListener,
  ): () => void {
    if (event === 'bid') {
      const l = listener as BidListener;
      this.bidListeners.add(l);
      return () => {
        this.bidListeners.delete(l);
      };
    }
    if (event === 'spectator_count') {
      const l = listener as SpectatorCountListener;
      this.spectatorCountListeners.add(l);
      return () => {
        this.spectatorCountListeners.delete(l);
      };
    }
    const l = listener as ConnectionListener;
    this.connectionListeners.add(l);
    // Match real-status replay so fresh subscribers see current state.
    l(this.status);
    return () => {
      this.connectionListeners.delete(l);
    };
  }

  getStatus(): MarketplaceConnectionStatus {
    return this.status;
  }
}

/** Singleton instance — only one spectator socket per page. */
export const marketplaceSpectatorClient = new MarketplaceSpectatorClient();
