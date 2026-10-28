/**
 * Flytripvisa - Type Definitions
 * Env bindings, ChatMessage, UserSession
 */

export interface Env {
  // AI & Search
  AI: Ai;
  AI_Search?: any;
  namespace?: any;

  // Assets & Compute
  ASSETS: Fetcher;
  Browser?: any;
  Flagship?: any;
  Images?: any;
  Stream?: any;
  Service?: Fetcher;

  // Data & Storage
  D1: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;

  // Secrets (set via `wrangler secret put`)
  TELEGRAM_BOT_TOKEN?: string;
  WHATSAPP_API_TOKEN?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  is_admin: number;
  created_at?: number;
}

export interface UserSession {
  userId: string;
  email: string;
  role: "user" | "admin";
  createdAt: number;
  expiresAt: number;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AdminStats {
  totalUsers: number;
  totalBookings: number;
  totalVisaApplications: number;
  activeSessions: number;
}

export interface TravelSearchResult {
  id: string;
  type: "flight" | "hotel";
  provider: string;
  price: number;
  currency: string;
  details: Record<string, any>;
}
