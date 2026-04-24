import { API_BASE_URL } from './constants';

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

class AuctionWebSocketManager {
  private ws: WebSocket | null = null;
  private jobId: string | null = null;
  private tokenGetter: (() => string | null) | null = null;
  private messageListeners: Set<AuctionMessageListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: AuctionConnectionStatus = 'disconnected';
  private connectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private auctionEnded = false;

  connect(jobId: string, token: string, tokenGetter?: () => string | null): void {
    // Debounce for React StrictMode
    if (this.connectDebounceTimer) {
      clearTimeout(this.connectDebounceTimer);
    }

    this.connectDebounceTimer = setTimeout(() => {
      this.doConnect(jobId, token, tokenGetter);
    }, 100);
  }

  private doConnect(jobId: string, token: string, tokenGetter?: () => string | null): void {
    if (this.ws && this.jobId === jobId) return;

    this.disconnect();
    this.jobId = jobId;
    this.auctionEnded = false;
    if (tokenGetter) {
      this.tokenGetter = tokenGetter;
    }

    const wsBase = API_BASE_URL.replace(/^http/, 'ws');
    const url = `${wsBase}/ws/auction/${jobId}?token=${encodeURIComponent(token)}`;

    this.updateStatus('connecting');
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
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
      this.updateStatus('disconnected');
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
    this.reconnectAttempts = 0;
    this.updateStatus('disconnected');
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || !this.jobId) return;

    const freshToken = this.tokenGetter ? this.tokenGetter() : null;
    if (!freshToken) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      const token = this.tokenGetter ? this.tokenGetter() : null;
      if (this.jobId && token) {
        this.doConnect(this.jobId, token);
      }
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
