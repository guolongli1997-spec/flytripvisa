/**
 * Flytripvisa - Admin & Auth Backend
 * D1-backed registration, login, session validation, admin stats.
 * Admin auto-seed: admin / pass1122
 */

import { Env, User } from "./types";

const ADMIN_EMAIL = "admin";
const ADMIN_PASS = "pass1122";
const PBKDF2_ITERATIONS = 150_000;

let adminSeeded = false;

// ---------------------------------------------------------------------------
// Public API handlers
// ---------------------------------------------------------------------------

export async function handleSignup(request: Request, env: Env): Promise<Response> {
  await ensureAdmin(env);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const name = (body?.name ?? "").toString().trim();
  const email = (body?.email ?? "").toString().trim().toLowerCase();
  const password = (body?.password ?? "").toString();

  if (!name || name.length < 2) return json({ error: "Name must be at least 2 characters." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

  const existing = await env.D1.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return json({ error: "An account with this email already exists." }, 409);

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = Date.now();

  await env.D1.prepare(
    "INSERT INTO users (id, name, email, password_hash, salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)"
  ).bind(id, name, email, hash, salt, now).run();

  const token = randomToken();
  const expiresAt = now + 30 * 86400 * 1000;
  await env.D1.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, id, expiresAt).run();

  return json(
    { success: true, user: { id, name, email, is_admin: 0 } },
    201,
    { "Set-Cookie": sessionCookie(token) }
  );
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  await ensureAdmin(env);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const email = (body?.email ?? "").toString().trim().toLowerCase();
  const password = (body?.password ?? "").toString();

  if (!email || !password) return json({ error: "Email and password are required." }, 400);

  const user = await env.D1.prepare(
    "SELECT id, name, email, password_hash, salt, is_admin FROM users WHERE email = ?"
  ).bind(email).first() as any;

  // Constant-time padding even when user not found
  if (!user) {
    await hashPassword(password);
    return json({ error: "Invalid email or password." }, 401);
  }

  const ok = await verifyPassword(password, user.salt, user.password_hash);
  if (!ok) return json({ error: "Invalid email or password." }, 401);

  // Invalidate old sessions for this user (optional, keeps 1 active session)
  // await env.D1.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();

  const token = randomToken();
  const expiresAt = Date.now() + 30 * 86400 * 1000;
  await env.D1.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, user.id, expiresAt).run();

  return json(
    { success: true, user: { id: user.id, name: user.name, email: user.email, is_admin: user.is_admin } },
    200,
    { "Set-Cookie": sessionCookie(token) }
  );
}

export async function handleLogout(): Promise<Response> {
  return json(
    { success: true },
    200,
    { "Set-Cookie": "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" }
  );
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) return json({ user: null }, 401);
  return json({
    user: {
      id: session.id,
      name: session.name,
      email: session.email,
      is_admin: session.is_admin,
    },
  });
}

export async function handleAdminStats(env: Env): Promise<Response> {
  const users = await env.D1.prepare("SELECT COUNT(*) as c FROM users").first() as any;
  const sessions = await env.D1.prepare("SELECT COUNT(*) as c FROM sessions WHERE expires_at > ?").bind(Date.now()).first() as any;
  return json({
    totalUsers: users?.c ?? 0,
    totalBookings: 0,
    totalVisaApplications: 0,
    activeSessions: sessions?.c ?? 0,
  });
}

// ---------------------------------------------------------------------------
// Session lookup (shared with index.ts for chat auth if needed)
// ---------------------------------------------------------------------------

export async function getSession(request: Request, env: Env): Promise<any | null> {
  const token = getCookie(request, "session");
  if (!token) return null;
  const s = await env.D1.prepare(
    "SELECT u.id, u.name, u.email, u.is_admin, s.expires_at FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?"
  ).bind(token).first() as any;
  if (!s || s.expires_at < Date.now()) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Admin auto-seed (idempotent)
// ---------------------------------------------------------------------------

export async function ensureAdmin(env: Env): Promise<void> {
  if (adminSeeded) return;
  try {
    const existing = await env.D1.prepare("SELECT id FROM users WHERE email = ?").bind(ADMIN_EMAIL).first();
    if (!existing) {
      const { hash, salt } = await hashPassword(ADMIN_PASS);
      await env.D1.prepare(
        "INSERT INTO users (id, name, email, password_hash, salt, is_admin, created_at) VALUES (?, 'Administrator', ?, ?, ?, 1, ?)"
      ).bind(crypto.randomUUID(), ADMIN_EMAIL, hash, salt, Date.now()).run();
    }
  } catch (e) {
    // Table may not exist yet — surface via logs, don't crash worker
    console.error("ensureAdmin error (run schema.sql?):", e);
  }
  adminSeeded = true;
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

export async function hashPassword(password: string, saltHex?: string) {
  const salt = saltHex
    ? hexToBytes(saltHex)
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

export async function verifyPassword(password: string, saltHex: string, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPassword(password, saltHex);
  return constantTimeEqual(hash, expectedHash);
}

export function randomToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(h: string): Uint8Array {
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return a;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function getCookie(req: Request, name: string): string | null {
  const c = req.headers.get("Cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}

export function sessionCookie(token: string): string {
  const maxAge = 30 * 24 * 60 * 60;
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function json(data: any, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}
