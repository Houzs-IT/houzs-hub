import { DurableObject } from "cloudflare:workers";

// Every open hub tab holds a WebSocket here; a submitted ticket is broadcast to all of them.
export class LiveRoom extends DurableObject {
  async fetch() {
    const [browserSocket, serverSocket] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(serverSocket);
    return new Response(null, { status: 101, webSocket: browserSocket });
  }

  broadcast(message: string) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {}
    }
  }

  webSocketMessage() {}

  webSocketClose(socket: WebSocket) {
    try {
      socket.close();
    } catch {}
  }
}

export const getLiveRoom = (rooms: DurableObjectNamespace<LiveRoom>) => rooms.get(rooms.idFromName("hub"));
