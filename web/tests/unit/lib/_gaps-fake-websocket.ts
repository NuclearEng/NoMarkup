// Scriptable WebSocket double for the lib/*-websocket.gaps.test.ts files.
// Records every constructed socket so a test can drive open / message / close
// by hand and count re-dials.
type Handler<E> = ((event: E) => void) | null;

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];
  /** When set, the next `new WebSocket()` throws this (then it is cleared). */
  static failNextConstruction: Error | null = null;

  static reset(): void {
    FakeWebSocket.instances = [];
    FakeWebSocket.failNextConstruction = null;
  }

  static last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error('no WebSocket has been constructed');
    return socket;
  }

  readyState: number = FakeWebSocket.CONNECTING;
  closeCalls = 0;
  onopen: Handler<Event> = null;
  onmessage: Handler<MessageEvent> = null;
  onclose: Handler<CloseEvent> = null;
  onerror: Handler<Event> = null;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    const failure = FakeWebSocket.failNextConstruction;
    if (failure) {
      FakeWebSocket.failNextConstruction = null;
      throw failure;
    }
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  /** Server accepted the connection. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  /** Server sent a frame; `data` is delivered as-is (string or binary). */
  receive(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /** Connection dropped from the far side. */
  drop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code: 1006 }));
  }
}
