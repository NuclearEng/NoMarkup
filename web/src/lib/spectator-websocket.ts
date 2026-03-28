import { API_BASE_URL } from './constants';

export type SpectatorMessageType = 'bid_event' | 'spectator_count' | 'auction_state';

export interface SpectatorMessage {
  type: SpectatorMessageType;
  job_id: string;
  data?: {
    type: string;
    amount_cents: number;
    timestamp: string;
  };
  spectator_count?: number;
}

type SpectatorMessageListener = (message: SpectatorMessage) => void;

export type SpectatorConnectionStatus = 'connecting' | 'connected' | 'disconnected';
type StatusListener = (status: SpectatorConnectionStatus) => void;

class SpectatorWebSocketManager {
  private ws: WebSocket | null = null;
  private jobId: string | null = null;
  private messageListeners: Set<SpectatorMessageListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: SpectatorConnectionStatus = 'disconnected';
  private connectDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  connect(jobId: string): void {
    // Debounce for React StrictMode.
    if (this.connectDebounceTimer) {
      clearTimeout(this.connectDebounceTimer);
    }

    this.connectDebounceTimer = setTimeout(() => {
      this.doConnect(jobId);
    }, 100);
  }

  private doConnect(jobId: string): void {
    if (this.ws && this.jobId === jobId) return;

    this.disconnect();
    this.jobId = jobId;

    const wsBase = API_BASE_URL.replace(/^http/, 'ws');
    const url = `${wsBase}/ws/auction/${jobId}/spectate`;

    this.updateStatus('connecting');
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.updateStatus('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const message: SpectatorMessage = JSON.parse(event.data as string) as SpectatorMessage;
        this.messageListeners.forEach((listener) => {
          listener(message);
        });
      } catch {
        // Ignore malformed messages.
      }
    };

    this.ws.onclose = () => {
      this.updateStatus('disconnected');
      this.attemptReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this.
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
    this.reconnectAttempts = 0;
    this.updateStatus('disconnected');
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || !this.jobId) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (this.jobId) {
        this.doConnect(this.jobId);
      }
    }, delay);
  }

  private updateStatus(status: SpectatorConnectionStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => {
      listener(status);
    });
  }

  onMessage(listener: SpectatorMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): SpectatorConnectionStatus {
    return this.status;
  }
}

export const spectatorWsManager = new SpectatorWebSocketManager();
