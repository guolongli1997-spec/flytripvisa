# FlyTripVisa — Full-Stack Cloudflare Worker Application

AI-powered visa, flights, hotels & business setup platform for GCC & Asia.

## Features

- 🛂 **Visa Consultancy** — 40+ destinations across GCC & Asia
- ✈️ **Flight & Hotel Booking** — Real-time search via `/api/search-travel`
- 🏢 **Business Setup** — UAE & Asian corporate establishment
- 🤖 **AI Chat** — Powered by `@cf/moonshotai/kimi-k2.6` with SSE streaming
- 🔐 **D1-Backed Auth** — PBKDF2 password hashing, HttpOnly session cookies
- 📱 **Mobile-First UI** — Dark theme, bottom tab navigation, responsive
- 💬 **Telegram & WhatsApp Bots** — Webhook handlers with AI integration
- 🛡️ **Admin Dashboard** — Stats, user management, integration status
- 👤 **Admin Account** — Auto-seeded: `admin` / `pass1122`

## Project Structure

```
Flytripvisa/
├── public/
│   ├── index.html          # Homepage (mobile-first, auth modal)
│   ├── ai.html             # AI Chat UI (streaming SSE)
│   ├── visa.html           # Visa Services
│   ├── bussiness.html      # Business Setup
│   ├── flights&hotel.html  # Flights & Hotels (live search)
│   ├── login&sing.html     # Login / Signup portal
│   ├── admin.html          # Admin Dashboard
│   └── chat.js             # Frontend chat client
├── src/
│   ├── index.ts            # Main router, chat, search, webhooks
│   ├── admin.ts            # Auth, sessions, admin stats
│   └── types.ts            # TypeScript interfaces
├── wrangler.jsonc           # Cloudflare Worker config
├── tsconfig.json
├── package.json
└── schema.sql              # D1 database schema
```

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Create D1 database
```bash
npx wrangler d1 create flytripvisa-db
```

### 3. Update `wrangler.jsonc`
Replace the `database_id` in `d1_databases` with your new database ID.

### 4. Run schema
```bash
npx wrangler d1 execute flytripvisa-db --remote --file=schema.sql
```

### 5. Set secrets (optional, for bot webhooks)
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put WHATSAPP_API_TOKEN
```

### 6. Deploy
```bash
npm run deploy
```

### 7. Develop locally
```bash
npm run dev
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | AI chat (SSE streaming) |
| POST | `/api/signup` | User registration |
| POST | `/api/login` | User login |
| POST | `/api/logout` | User logout |
| GET | `/api/me` | Session validation |
| GET | `/api/admin/stats` | Admin dashboard stats |
| GET | `/api/search-travel` | Flight/hotel search |
| POST | `/api/telegram` | Telegram webhook |
| POST | `/api/whatsapp` | WhatsApp webhook |

## Pages

| Route | Page |
|-------|------|
| `/` | Homepage |
| `/ai` | AI Chat |
| `/visa` | Visa Services |
| `/bussiness` | Business Setup |
| `/flights&hotel` | Flights & Hotels |
| `/login&sing` | Login / Signup |
| `/admin` | Admin Dashboard |

## Tech Stack

- **Runtime:** Cloudflare Workers
- **AI:** Workers AI (Kimi K2.6)
- **Database:** Cloudflare D1 (SQLite)
- **Storage:** R2, KV, Durable Objects ready
- **Frontend:** Vanilla HTML/CSS/JS (no framework)
- **Auth:** PBKDF2 + HttpOnly cookies
- **Build:** TypeScript + Wrangler

## Security

- Passwords hashed with PBKDF2 (150k iterations, SHA-256)
- Session tokens: 32-byte cryptographically random
- HttpOnly, Secure, SameSite=Lax cookies
- Constant-time password comparison
- Admin auto-seed (idempotent, one-time)

## License

MIT
