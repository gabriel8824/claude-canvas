import { WebSocket } from 'ws';

export type Msg = Record<string, any>;

export function send(ws: WebSocket, msg: Msg): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
