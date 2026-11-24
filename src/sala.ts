export class Sala {
  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const par = new WebSocketPair();
      const servidor = par[1];
      if (!servidor) return new Response("sin socket", { status: 500 });
      this.ctx.acceptWebSocket(servidor);
      return new Response(null, { status: 101, webSocket: par[0] });
    }

    if (request.method === "POST") {
      const aviso = await request.text();
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(aviso);
        } catch {
          /* un navegador ya se fue */
        }
      }
      return new Response("ok");
    }

    return new Response("no encontrado", { status: 404 });
  }

  async webSocketMessage(): Promise<void> {}

  async webSocketClose(socket: WebSocket): Promise<void> {
    try {
      socket.close();
    } catch {
      /* el navegador ya cerró */
    }
  }
}
