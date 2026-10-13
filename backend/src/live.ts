import { DurableObject } from "cloudflare:workers";

// One room every open hub tab joins over a WebSocket. When a ticket is
// submitted, sys.ts calls broadcast() and each tab gets it at once.
// Hibernation API: idle sockets cost nothing while nobody is sending.
export class LiveRoom extends DurableObject {
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message: string) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {}
    }
  }

  // Tabs only listen; anything they send is ignored.
  webSocketMessage() {}

  webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {}
  }
}

export const liveRoom = (ns: DurableObjectNamespace<LiveRoom>) => ns.get(ns.idFromName("hub"));
