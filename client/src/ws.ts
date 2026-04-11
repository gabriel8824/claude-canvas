import type { ClientMessage, ServerMessage } from './ws-types';

type AnyMessage = Record<string, unknown>;
type Handler = (msg: AnyMessage) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private queue: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[WS] connected');
      while (this.queue.length) this.ws!.send(this.queue.shift()!);
      this.emit('__connected', {});
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as AnyMessage;
        const handlers = this.handlers.get(msg.type as string);
        if (handlers) handlers.forEach(h => h(msg));
        const all = this.handlers.get('*');
        if (all) all.forEach(h => h(msg));
      } catch {}
    };

    this.ws.onclose = () => {
      console.log('[WS] disconnected, reconnecting...');
      this.emit('__disconnected', {});
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  send(msg: ClientMessage | AnyMessage) {
    const data = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
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
