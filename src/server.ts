export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") { ... }

    // ── WebSocket route (direct, no DO needed) ──
    if (url.pathname === "/ws") { ... }

    // ── API routes ──
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    // ── Agent routes (Durable Object) ──
    if (url.pathname.startsWith("/agent/")) {
      const id = env.MyAgent.idFromName("default");
      const stub = env.MyAgent.get(id);
      return stub.fetch(request);
    }

    // ── Static assets ──
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
