/**
 * Flytripvisa - Main Worker Entry & Multi-page Router
 * Serves static assets, routes API calls, handles AI chat,
 * travel search, and messaging webhooks.
 */

import { Env, ChatMessage, TravelSearchResult } from "./types";
import {
  handleLogin,
  handleSignup,
  handleLogout,
  handleMe,
  handleAdminStats,
  ensureAdmin,
  getSession,
  json,
} from "./admin";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_ID = "@cf/moonshotai/kimi-k2.6";
const SYSTEM_PROMPT =
  "You are Fly AI by flytripvisa.site — a professional travel, visa, flights, and hotels assistant for GCC & Asia. " +
  "Provide concise, accurate, and helpful responses. For visa questions, mention requirements vary and users should confirm with our consultants.";

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- API Routes ----
    if (path === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }
    if (path === "/api/login" && request.method === "POST") {
      return handleLogin(request, env);
    }
    if (path === "/api/signup" && request.method === "POST") {
      return handleSignup(request, env);
    }
    if (path === "/api/logout" && request.method === "POST") {
      return handleLogout();
    }
    if (path === "/api/me" && request.method === "GET") {
      return handleMe(request, env);
    }
    if (path === "/api/admin/stats" && request.method === "GET") {
      return handleAdminStats(env);
    }
    if (path === "/api/search-travel" && request.method === "GET") {
      return handleTravelSearch(url);
    }
    if (path === "/api/telegram" && request.method === "POST") {
      return handleTelegramWebhook(request, env);
    }
    if (path === "/api/whatsapp" && request.method === "POST") {
      return handleWhatsAppWebhook(request, env);
    }

    // ---- Page Routes (serve from ASSETS binding) ----
    const assetMap: Record<string, string> = {
      "/": "index.html",
      "/index": "index.html",
      "/ai": "ai.html",
      "/visa": "visa.html",
      "/bussiness": "bussiness.html",
      "/flights&hotel": "flights&hotel.html",
      "/login&sing": "login&sing.html",
      "/admin": "admin.html",
    };

    const assetKey = assetMap[path];
    if (assetKey) {
      return env.ASSETS.fetch(new Request(`${url.origin}/${assetKey}`));
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// AI Chat (streaming SSE via Workers AI)
// ---------------------------------------------------------------------------

async function handleChat(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as any;
    const incoming: ChatMessage[] = body.messages ?? (body.message ? [{ role: "user", content: body.message }] : []);

    if (!Array.isArray(incoming) || incoming.length === 0) {
      return json({ error: "No messages provided." }, 400);
    }

    // Ensure system prompt is first
    const messages: ChatMessage[] = incoming.filter((m) => m.role === "system");
    if (messages.length === 0) messages.push({ role: "system", content: SYSTEM_PROMPT });
    incoming.filter((m) => m.role !== "system").forEach((m) => messages.push(m));

    const stream = await env.AI.run(MODEL_ID, {
      messages,
      max_tokens: 1024,
      stream: true,
    } as any);

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return json({ error: "Failed to process chat request." }, 500);
  }
}

// ---------------------------------------------------------------------------
// Travel Search (mock/live results)
// ---------------------------------------------------------------------------

function handleTravelSearch(url: URL): Response {
  const type = url.searchParams.get("type") ?? "all";
  const destination = url.searchParams.get("destination")?.toLowerCase() ?? "";

  const all: TravelSearchResult[] = [
    { id: "f1", type: "flight", provider: "FlyAir", price: 450, currency: "USD", details: { from: "DAC", to: "DXB" } },
    { id: "f2", type: "flight", provider: "GulfWings", price: 520, currency: "USD", details: { from: "DAC", to: "RUH" } },
    { id: "f3", type: "flight", provider: "AsiaAir", price: 380, currency: "USD", details: { from: "DAC", to: "KUL" } },
    { id: "h1", type: "hotel", provider: "StaySuite", price: 120, currency: "USD", details: { nights: 3, location: "Dubai Marina" } },
    { id: "h2", type: "hotel", provider: "Oasis Resorts", price: 95, currency: "USD", details: { nights: 2, location: "Riyadh" } },
    { id: "h3", type: "hotel", provider: "Marina Bay Stays", price: 210, currency: "USD", details: { nights: 3, location: "Singapore" } },
  ];

  let results = all;
  if (type !== "all") results = all.filter((r) => r.type === type);
  if (destination) results = results.filter((r) => JSON.stringify(r.details).toLowerCase().includes(destination));

  return json(results);
}

// ---------------------------------------------------------------------------
// Telegram Webhook
// ---------------------------------------------------------------------------

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const update = (await request.json()) as any;
    const message = update?.message;
    if (!message?.text) return json({ ok: true });

    const chatId = message.chat?.id;
    const text = message.text;

    // Build AI context
    const aiMessages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ];

    const aiResp = await env.AI.run(MODEL_ID, { messages: aiMessages, max_tokens: 512 } as any);
    const reply = (aiResp as any)?.response ?? "Sorry, I could not process that.";

    const token = env.TELEGRAM_BOT_TOKEN;
    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: "Markdown" }),
      });
    }

    return json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return json({ ok: true }); // Always 200 to Telegram
  }
}

// ---------------------------------------------------------------------------
// WhatsApp Webhook (Meta Cloud API)
// ---------------------------------------------------------------------------

async function handleWhatsAppWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as any;
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    const messages = changes?.messages;
    if (!messages || messages.length === 0) return json({ ok: true });

    const msg = messages[0];
    const from = msg.from;
    const text = msg.text?.body;
    if (!text) return json({ ok: true });

    const aiMessages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ];

    const aiResp = await env.AI.run(MODEL_ID, { messages: aiMessages, max_tokens: 512 } as any);
    const reply = (aiResp as any)?.response ?? "Sorry, I could not process that.";

    const token = env.WHATSAPP_API_TOKEN;
    const phoneNumberId = changes?.metadata?.phone_number_id;
    if (token && phoneNumberId && from) {
      await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: reply },
        }),
      });
    }

    return json({ ok: true });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    return json({ ok: true }); // Always 200 to Meta
  }
}
