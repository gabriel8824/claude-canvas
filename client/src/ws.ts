import type { ClientMessage, ServerMessage } from './ws-types';

type AnyMessage = Record<string, unknown>;
type Handler = (msg: AnyMessage) => void;

const QUEUE_MAX      = 500;
const BACKOFF_BASE   = 1_000;   // 1s
const BACKOFF_MAX    = 30_000;  // 30s

class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private queue: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);

    this.ws.onopen = () => {
      this.attempts = 0;
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      // Flush queued messages
      while (this.queue.length) this.ws!.send(this.queue.shift()!);
      this.emit('__connected', {});
    };

    this.ws.onmessage = (e) => {
      let msg: AnyMessage;
      try { msg = JSON.parse(e.data) as AnyMessage; } catch { return; }
      this.handlers.get(msg.type as string)?.forEach(h => h(msg));
      this.handlers.get('*')?.forEach(h => h(msg));
    };

    this.ws.onclose = () => {
      this.emit('__disconnected', {});
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    // Exponential backoff: 1s, 2s, 4s, 8s … capped at 30s
    const delay = Math.min(BACKOFF_BASE * 2 ** this.attempts, BACKOFF_MAX);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(msg: ClientMessage | AnyMessage) {
    const data = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      // Drop oldest messages when queue is full to avoid unbounded growth
      if (this.queue.length >= QUEUE_MAX) this.queue.shift();
      this.queue.push(data);
      this.connect();
    }
  }

  on<T extends ServerMessage['type']>(
    type: T,
    handler: (msg: Extract<ServerMessage, { type: T }>) => void
  ): () => void;
  on(type: string, handler: Handler): () => void;
  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  private emit(type: string, msg: AnyMessage) {
    this.handlers.get(type)?.forEach(h => h(msg));
  }
}

export const ws = new WSClient();
ws.connect();
