
/**
 * FlyTripVisa - Main Worker Entry & Multi-page Router
 * Cloudflare Workers + Workers AI
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
// AI Configuration
// ---------------------------------------------------------------------------

const MODEL_ID = "@cf/google/gemma-4-26b-a4b-it";

const SYSTEM_PROMPT =
  "You are Fly AI, the official AI travel assistant of FlyTripVisa (flytripvisa.site). " +
  "You are a professional assistant specializing in international visas, " +
  "flight bookings, hotels, tourism, and business setup across the GCC and Asia. " +
  "Communicate clearly, professionally, and helpfully. " +
  "Support English, Bengali, Chinese, Arabic, and other languages. " +
  "Always reply in the language used by the user unless they request another language. " +
  "For visa questions, explain that requirements depend on nationality, destination, " +
  "and travel purpose. Never invent visa approvals, prices, bookings, or official requirements. " +
  "Ask users to confirm current requirements with FlyTripVisa consultants.";

// ---------------------------------------------------------------------------
// Worker Export & Router
// ---------------------------------------------------------------------------

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- AI Chat API ----
    if (path === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    // ---- Authentication APIs ----
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

    // ---- Admin API ----
    if (path === "/api/admin/stats" && request.method === "GET") {
      return handleAdminStats(env);
    }

    // ---- Travel Search API ----
    if (path === "/api/search-travel" && request.method === "GET") {
      return handleTravelSearch(url);
    }

    // ---- Messaging Webhooks ----
    if (path === "/api/telegram" && request.method === "POST") {
      return handleTelegramWebhook(request, env);
    }

    if (path === "/api/whatsapp" && request.method === "POST") {
      return handleWhatsAppWebhook(request, env);
    }

    // ---- Static Pages ----
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
      return env.ASSETS.fetch(
        new Request(`${url.origin}/${assetKey}`)
      );
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------------------
// AI CHAT - Cloudflare Workers AI Streaming
// POST /api/chat
// ---------------------------------------------------------------------------

async function handleChat(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Parse request
    const body = await request.json() as any;

    const incoming: ChatMessage[] =
      body.messages ??
      (body.message
        ? [{ role: "user", content: body.message }]
        : []);

    // Validate messages
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return json(
        { error: "No messages provided." },
        400
      );
    }

    // Accept only valid user and assistant messages.
    // System prompt is controlled by the Worker.
    const validMessages: ChatMessage[] = incoming
      .filter((m: any) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
      )
      .slice(-20)
      .map((m: any) => ({
        role: m.role,
        content: m.content.trim(),
      }));

    if (validMessages.length === 0) {
      return json(
        { error: "No valid messages provided." },
        400
      );
    }

    // Build trusted AI conversation context.
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      ...validMessages,
    ];

    // Run Cloudflare Workers AI.
    const stream = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_completion_tokens: 1024,
        stream: true,
        chat_template_kwargs: {
          enable_thinking: false,
        },
      } as any
    );

    // Return streaming response to website.
    return new Response(stream as any, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });

  } catch (error) {
    console.error("FlyTripVisa AI Chat Error:", error);

    const errorMessage =
      error instanceof Error
        ? error.message
        : String(error);

    return json(
      {
        error: "AI service failed: " + errorMessage,
      },
      500
    );
  }
}

// ---------------------------------------------------------------------------
// Travel Search
// ---------------------------------------------------------------------------

function handleTravelSearch(url: URL): Response {
  const type =
    url.searchParams.get("type") ?? "all";

  const destination =
    url.searchParams.get("destination")?.toLowerCase() ?? "";

  const all: TravelSearchResult[] = [
    {
      id: "f1",
      type: "flight",
      provider: "FlyAir",
      price: 450,
      currency: "USD",
      details: { from: "DAC", to: "DXB" },
    },
    {
      id: "f2",
      type: "flight",
      provider: "GulfWings",
      price: 520,
      currency: "USD",
      details: { from: "DAC", to: "RUH" },
    },
    {
      id: "f3",
      type: "flight",
      provider: "AsiaAir",
      price: 380,
      currency: "USD",
      details: { from: "DAC", to: "KUL" },
    },
    {
      id: "h1",
      type: "hotel",
      provider: "StaySuite",
      price: 120,
      currency: "USD",
      details: { nights: 3, location: "Dubai Marina" },
    },
    {
      id: "h2",
      type: "hotel",
      provider: "Oasis Resorts",
      price: 95,
      currency: "USD",
      details: { nights: 2, location: "Riyadh" },
    },
    {
      id: "h3",
      type: "hotel",
      provider: "Marina Bay Stays",
      price: 210,
      currency: "USD",
      details: { nights: 3, location: "Singapore" },
    },
  ];

  let results = all;

  if (type !== "all") {
    results = all.filter((r) => r.type === type);
  }

  if (destination) {
    results = results.filter((r) =>
      JSON.stringify(r.details)
        .toLowerCase()
        .includes(destination)
    );
  }

  return json(results);
}

// ---------------------------------------------------------------------------
// Telegram Webhook
// ---------------------------------------------------------------------------

async function handleTelegramWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const update = await request.json() as any;

    const message = update?.message;

    if (!message?.text) {
      return json({ ok: true });
    }

    const chatId = message.chat?.id;
    const text = message.text;

    const aiMessages: ChatMessage[] = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: text,
      },
    ];

    const aiResp = await env.AI.run(
      MODEL_ID,
      {
        messages: aiMessages,
        max_completion_tokens: 512,
        chat_template_kwargs: {
          enable_thinking: false,
        },
      } as any
    );

    const reply =
      (aiResp as any)?.response ??
      "Sorry, I could not process that.";

    const token = env.TELEGRAM_BOT_TOKEN;

    if (token && chatId) {
      await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: reply,
            parse_mode: "Markdown",
          }),
        }
      );
    }

    return json({ ok: true });

  } catch (error) {
    console.error("Telegram webhook error:", error);
    return json({ ok: true });
  }
}

// ---------------------------------------------------------------------------
// WhatsApp Webhook - Meta Cloud API
// ---------------------------------------------------------------------------

async function handleWhatsAppWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as any;

    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    const messages = changes?.messages;

    if (!messages || messages.length === 0) {
      return json({ ok: true });
    }

    const msg = messages[0];

    const from = msg.from;
    const text = msg.text?.body;

    if (!text) {
      return json({ ok: true });
    }

    const aiMessages: ChatMessage[] = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: text,
      },
    ];

    const aiResp = await env.AI.run(
      MODEL_ID,
      {
        messages: aiMessages,
        max_completion_tokens: 512,
        chat_template_kwargs: {
          enable_thinking: false,
        },
      } as any
    );

    const reply =
      (aiResp as any)?.response ??
      "Sorry, I could not process that.";

    const token = env.WHATSAPP_API_TOKEN;
    const phoneNumberId =
      changes?.metadata?.phone_number_id;

    if (token && phoneNumberId && from) {
      await fetch(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            text: {
              body: reply,
            },
          }),
        }
      );
    }

    return json({ ok: true });

  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    return json({ ok: true });
  }
}
