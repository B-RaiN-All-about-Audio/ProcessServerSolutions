# Process Server Solutions (Cloudflare MVP)

Cloudflare Pages + Functions MVP for **Process Server Solutions CRM**, aligned to the live product structure at https://processserve-crm.pages.dev.

## What is implemented

### Roles + auth
- Email/password auth with secure HTTP-only cookie sessions
- Roles: `agency_admin`, `process_server`, `client`
- 30-day trial signup flow (trial metadata stored per user)

### Core workflows
- Create service order (job intake)
- Assign process server (agency admin)
- Log field attempt with GPS, notes, physical description, timeline note, evidence URL
- Update order status
- Client portal/all-orders dashboard view (role-filtered)
- Affidavit/proof draft generation from attempt timeline
- Invoice stub generation (Stripe-ready placeholder URL)

### Notifications
- Status-change event fanout to:
  - In-app notifications
  - Email stub notifications
  - Push stub notifications (if push subscription exists)
- Browser push subscription flow via VAPID public key endpoint
- Service worker included for web push display

### Cloudflare resources wired
- **Pages SPA** (Vite React TypeScript build output)
- **Pages Functions API** (`functions/api/[[route]].ts`)
- **D1** schema + seed migrations
- **R2 binding** declared for evidence workflows

---

## Quick start

### 1) Install deps
```bash
npm install
```

### 2) Create Cloudflare resources
1. Create D1 database in Cloudflare dashboard
2. Create R2 bucket(s) for evidence
3. Update `wrangler.toml`:
   - `database_id`
   - `bucket_name` / `preview_bucket_name`

### 3) Configure env vars
```bash
cp .dev.vars.example .dev.vars
```
Fill required values for local testing.

### 4) Apply migrations + seed
```bash
wrangler d1 execute processserver-solutions-db --local --file=./migrations/0001_init.sql
wrangler d1 execute processserver-solutions-db --local --file=./migrations/0002_seed.sql
```

### 5) Build + run
```bash
npm run build
npm run cf:dev
```

---

## Demo seed accounts
Use password `Passw0rd!` for all:
- `admin@processserve.demo` (agency admin)
- `server@processserve.demo` (process server)
- `client@northstarlaw.demo` (client)

---

## API overview (MVP)
- `POST /api/auth/signup` (self-service client signup)
- `POST /api/auth/signin`
- `POST /api/auth/signout`
- `GET /api/auth/session`
- `GET /api/orders`
- `POST /api/orders`
- `PATCH /api/orders/:id/assign`
- `PATCH /api/orders/:id/status`
- `POST /api/orders/:id/attempts`
- `POST /api/orders/:id/affidavit-draft`
- `POST /api/orders/:id/invoice-stub`
- `GET /api/notifications`
- `GET /api/push/public-key`
- `POST /api/push/subscribe`

---

## Environment variables (`.dev.vars`)
Required/important:
- `SESSION_SECRET` - random long secret
- `VAPID_PUBLIC_KEY` - web push subscription key for browser clients

Optional stubs/integrations:
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

> Do **not** commit real secrets.

---

## Owner-only Cloudflare dashboard steps still needed
- Replace placeholder D1/R2 identifiers in `wrangler.toml`
- Provision production VAPID keys
- Wire real email sending (Resend) in place of stub notifications
- Wire Stripe checkout + webhook handling in place of invoice stub URL
- Configure custom domain and production Pages environment variables
