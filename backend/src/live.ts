import { DurableObject } from "cloudflare:workers";
import { createMiddleware } from "hono/factory";
import type { Env } from "./types";

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

export const notifyTicketsChanged = (rooms: DurableObjectNamespace<LiveRoom>) =>
  getLiveRoom(rooms).broadcast(JSON.stringify({ type: "tickets.changed" }));

// After any successful ticket write, open hub tabs refresh their views.
export const broadcastTicketChanges = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  await next();
  if (c.req.method !== "GET" && c.res.ok) c.executionCtx.waitUntil(notifyTicketsChanged(c.env.LIVE));
});
