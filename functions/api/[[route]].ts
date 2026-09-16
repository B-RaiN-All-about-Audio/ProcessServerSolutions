interface Env {
  DB: D1Database;
  EVIDENCE_BUCKET?: R2Bucket;
  SESSION_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  VAPID_PUBLIC_KEY?: string;
}

type Role = 'process_server' | 'client' | 'agency_admin';

type SessionUser = {
  id: number;
  full_name: string;
  agency: string;
  email: string;
  role: Role;
};

type OrderRecord = {
  id: number;
  title: string;
  details: string;
  status: string;
  deadline: string | null;
  archived: number;
  client_name: string;
  assigned_server_name: string | null;
  created_at: string;
};

const SESSION_COOKIE = 'pss_session';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key) {
      acc[key] = decodeURIComponent(rest.join('='));
    }
    return acc;
  }, {});
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return toHex(new Uint8Array(digest));
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`);
}

async function createPasswordBundle(password: string): Promise<{ salt: string; hash: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toHex(saltBytes);
  const hash = await hashPassword(password, salt);
  return { salt, hash };
}

async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const candidate = await hashPassword(password, salt);
  return candidate === expectedHash;
}

function makeSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toHex(bytes);
}

function buildCookie(token: string, requestUrl: URL): string {
  const secure = requestUrl.protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${7 * 24 * 60 * 60}`;
}

function clearCookie(requestUrl: URL): string {
  const secure = requestUrl.protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

async function getSessionUser(request: Request, db: D1Database): Promise<{ user: SessionUser; token: string } | null> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const row = await db
    .prepare(
      `SELECT u.id, u.full_name, u.agency, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .bind(token)
    .first<SessionUser>();

  if (!row) return null;
  return { user: row, token };
}

function canCreateOrder(role: Role): boolean {
  return role === 'agency_admin' || role === 'client';
}

function canAssignServer(role: Role): boolean {
  return role === 'agency_admin';
}

function canUpdateStatus(role: Role): boolean {
  return role === 'agency_admin' || role === 'process_server';
}

async function notifyOrderStatusChange(db: D1Database, orderId: number, message: string): Promise<void> {
  const order = await db
    .prepare('SELECT client_id, assigned_server_id, created_by FROM orders WHERE id = ?')
    .bind(orderId)
    .first<{ client_id: number; assigned_server_id: number | null; created_by: number }>();

  if (!order) return;

  const recipients = Array.from(new Set([order.client_id, order.created_by, order.assigned_server_id].filter(Boolean))) as number[];

  for (const userId of recipients) {
    await db
      .prepare('INSERT INTO notifications (user_id, order_id, message, channel, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
      .bind(userId, orderId, message, 'in_app')
      .run();

    await db
      .prepare('INSERT INTO notifications (user_id, order_id, message, channel, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
      .bind(userId, orderId, `[EMAIL STUB] ${message}`, 'email_stub')
      .run();

    const pushSubscription = await db
      .prepare('SELECT id FROM push_subscriptions WHERE user_id = ? LIMIT 1')
      .bind(userId)
      .first<{ id: number }>();

    if (pushSubscription) {
      await db
        .prepare('INSERT INTO notifications (user_id, order_id, message, channel, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
        .bind(userId, orderId, `[PUSH STUB] ${message}`, 'push_stub')
        .run();
    }
  }
}

async function listOrdersForUser(db: D1Database, user: SessionUser): Promise<OrderRecord[]> {
  if (user.role === 'agency_admin') {
    const result = await db
      .prepare(
        `SELECT o.id, o.title, o.details, o.status, o.deadline, o.archived, o.created_at,
                cu.full_name AS client_name,
                su.full_name AS assigned_server_name
         FROM orders o
         LEFT JOIN users cu ON cu.id = o.client_id
         LEFT JOIN users su ON su.id = o.assigned_server_id
         WHERE o.archived = 0
         ORDER BY o.created_at DESC`
      )
      .all<OrderRecord>();
    return result.results;
  }

  if (user.role === 'process_server') {
    const result = await db
      .prepare(
        `SELECT o.id, o.title, o.details, o.status, o.deadline, o.archived, o.created_at,
                cu.full_name AS client_name,
                su.full_name AS assigned_server_name
         FROM orders o
         LEFT JOIN users cu ON cu.id = o.client_id
         LEFT JOIN users su ON su.id = o.assigned_server_id
         WHERE o.archived = 0 AND o.assigned_server_id = ?
         ORDER BY o.created_at DESC`
      )
      .bind(user.id)
      .all<OrderRecord>();
    return result.results;
  }

  const result = await db
    .prepare(
      `SELECT o.id, o.title, o.details, o.status, o.deadline, o.archived, o.created_at,
              cu.full_name AS client_name,
              su.full_name AS assigned_server_name
       FROM orders o
       LEFT JOIN users cu ON cu.id = o.client_id
       LEFT JOIN users su ON su.id = o.assigned_server_id
       WHERE o.archived = 0 AND o.client_id = ?
       ORDER BY o.created_at DESC`
    )
    .bind(user.id)
    .all<OrderRecord>();
  return result.results;
}

async function parseBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (!path.startsWith('/api')) {
    return json({ error: 'Not found' }, 404);
  }

  if (request.method === 'GET' && path === '/api/health') {
    return json({ ok: true, service: 'processserver-solutions-api' });
  }

  if (request.method === 'GET' && path === '/api/push/public-key') {
    return json({ publicKey: env.VAPID_PUBLIC_KEY ?? '' });
  }

  if (request.method === 'POST' && path === '/api/auth/signup') {
    const body = await parseBody<{ fullName?: string; agency?: string; email?: string; password?: string }>(request);
    if (!body?.fullName || !body.email || !body.password) {
      return json({ error: 'fullName, email, and password are required' }, 400);
    }

    const normalizedRole: Role = 'client';

    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email.toLowerCase()).first();
    if (existing) {
      return json({ error: 'Email already exists' }, 409);
    }

    const bundle = await createPasswordBundle(body.password);
    const insertResult = await env.DB
      .prepare(
        `INSERT INTO users (full_name, agency, email, role, password_hash, password_salt, trial_ends_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+30 day'), datetime('now'))`
      )
      .bind(body.fullName.trim(), body.agency?.trim() ?? 'Independent', body.email.toLowerCase().trim(), normalizedRole, bundle.hash, bundle.salt)
      .run();

    const userId = Number(insertResult.meta.last_row_id);
    const token = makeSessionToken();
    const expiry = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();

    await env.DB
      .prepare('INSERT INTO sessions (user_id, token, expires_at, created_at) VALUES (?, ?, ?, datetime(\'now\'))')
      .bind(userId, token, expiry)
      .run();

    const user = await env.DB
      .prepare('SELECT id, full_name, agency, email, role FROM users WHERE id = ?')
      .bind(userId)
      .first<SessionUser>();

    return new Response(JSON.stringify({ user }), {
      status: 201,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': buildCookie(token, url)
      }
    });
  }

  if (request.method === 'POST' && path === '/api/auth/signin') {
    const body = await parseBody<{ email?: string; password?: string }>(request);
    if (!body?.email || !body.password) {
      return json({ error: 'email and password are required' }, 400);
    }

    const row = await env.DB
      .prepare('SELECT id, full_name, agency, email, role, password_hash, password_salt FROM users WHERE email = ?')
      .bind(body.email.toLowerCase().trim())
      .first<SessionUser & { password_hash: string; password_salt: string }>();

    if (!row) {
      return json({ error: 'Invalid credentials' }, 401);
    }

    const validPassword = await verifyPassword(body.password, row.password_salt, row.password_hash);
    if (!validPassword) {
      return json({ error: 'Invalid credentials' }, 401);
    }

    const token = makeSessionToken();
    const expiry = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();
    await env.DB
      .prepare('INSERT INTO sessions (user_id, token, expires_at, created_at) VALUES (?, ?, ?, datetime(\'now\'))')
      .bind(row.id, token, expiry)
      .run();

    const user: SessionUser = {
      id: row.id,
      full_name: row.full_name,
      agency: row.agency,
      email: row.email,
      role: row.role
    };

    return new Response(JSON.stringify({ user }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': buildCookie(token, url)
      }
    });
  }

  if (request.method === 'POST' && path === '/api/auth/signout') {
    const session = await getSessionUser(request, env.DB);
    if (session) {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(session.token).run();
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': clearCookie(url)
      }
    });
  }

  if (request.method === 'GET' && path === '/api/auth/session') {
    const session = await getSessionUser(request, env.DB);
    if (!session) {
      return json({ user: null }, 200);
    }

    return json({ user: session.user });
  }

  const session = await getSessionUser(request, env.DB);
  if (!session) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { user } = session;

  if (request.method === 'GET' && path === '/api/users/process-servers') {
    if (!canAssignServer(user.role)) {
      return json({ error: 'Forbidden' }, 403);
    }

    const servers = await env.DB
      .prepare('SELECT id, full_name, agency, email, role FROM users WHERE role = ? ORDER BY full_name')
      .bind('process_server')
      .all<SessionUser>();

    return json({ users: servers.results });
  }

  if (request.method === 'GET' && path === '/api/orders') {
    const orders = await listOrdersForUser(env.DB, user);
    return json({ orders });
  }

  if (request.method === 'POST' && path === '/api/orders') {
    if (!canCreateOrder(user.role)) {
      return json({ error: 'Forbidden' }, 403);
    }

    const body = await parseBody<{ title?: string; details?: string; deadline?: string; clientId?: number }>(request);
    if (!body?.title || !body.details) {
      return json({ error: 'title and details are required' }, 400);
    }

    const resolvedClientId = user.role === 'client' ? user.id : body.clientId;
    if (!resolvedClientId) {
      return json({ error: 'clientId is required for agency admin' }, 400);
    }

    const result = await env.DB
      .prepare(
        `INSERT INTO orders (title, details, status, deadline, client_id, created_by, archived, created_at, updated_at)
         VALUES (?, ?, 'new', ?, ?, ?, 0, datetime('now'), datetime('now'))`
      )
      .bind(body.title.trim(), body.details.trim(), body.deadline ?? null, resolvedClientId, user.id)
      .run();

    const orderId = Number(result.meta.last_row_id);
    await notifyOrderStatusChange(env.DB, orderId, `Order #${orderId} created: ${body.title.trim()}`);

    return json({ ok: true, orderId }, 201);
  }

  if (request.method === 'GET' && path === '/api/notifications') {
    const rows = await env.DB
      .prepare(
        `SELECT id, order_id, message, channel, created_at, read_at
         FROM notifications
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 100`
      )
      .bind(user.id)
      .all();

    return json({ notifications: rows.results });
  }

  if (request.method === 'POST' && path === '/api/push/subscribe') {
    const body = await parseBody<{ endpoint?: string; p256dh?: string; auth?: string }>(request);
    if (!body?.endpoint || !body.p256dh || !body.auth) {
      return json({ error: 'endpoint, p256dh, and auth are required' }, 400);
    }

    await env.DB
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
      )
      .bind(user.id, body.endpoint, body.p256dh, body.auth)
      .run();

    return json({ ok: true, vapidConfigured: Boolean(env.VAPID_PUBLIC_KEY) });
  }

  const assignMatch = path.match(/^\/api\/orders\/(\d+)\/assign$/);
  if (request.method === 'PATCH' && assignMatch) {
    if (!canAssignServer(user.role)) {
      return json({ error: 'Forbidden' }, 403);
    }

    const orderId = Number(assignMatch[1]);
    const body = await parseBody<{ serverId?: number }>(request);
    if (!body?.serverId) {
      return json({ error: 'serverId is required' }, 400);
    }

    await env.DB
      .prepare('UPDATE orders SET assigned_server_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(body.serverId, orderId)
      .run();

    await notifyOrderStatusChange(env.DB, orderId, `Order #${orderId} assigned to server #${body.serverId}`);
    return json({ ok: true });
  }

  const statusMatch = path.match(/^\/api\/orders\/(\d+)\/status$/);
  if (request.method === 'PATCH' && statusMatch) {
    if (!canUpdateStatus(user.role)) {
      return json({ error: 'Forbidden' }, 403);
    }

    const orderId = Number(statusMatch[1]);
    const body = await parseBody<{ status?: string }>(request);
    const status = body?.status?.trim().toLowerCase();
    if (!status) {
      return json({ error: 'status is required' }, 400);
    }

    await env.DB.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(status, orderId).run();
    await notifyOrderStatusChange(env.DB, orderId, `Order #${orderId} moved to status: ${status}`);
    return json({ ok: true });
  }

  const attemptsMatch = path.match(/^\/api\/orders\/(\d+)\/attempts$/);
  if (request.method === 'POST' && attemptsMatch) {
    if (user.role !== 'process_server' && user.role !== 'agency_admin') {
      return json({ error: 'Forbidden' }, 403);
    }

    const orderId = Number(attemptsMatch[1]);
    const body = await parseBody<{
      gpsLat?: number;
      gpsLng?: number;
      notes?: string;
      physicalDescription?: string;
      timelineNote?: string;
      evidenceUrl?: string;
    }>(request);

    if (!body?.notes) {
      return json({ error: 'notes are required' }, 400);
    }

    await env.DB
      .prepare(
        `INSERT INTO attempts (order_id, user_id, gps_lat, gps_lng, notes, physical_description, timeline_note, evidence_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(orderId, user.id, body.gpsLat ?? null, body.gpsLng ?? null, body.notes, body.physicalDescription ?? null, body.timelineNote ?? null, body.evidenceUrl ?? null)
      .run();

    await env.DB.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').bind('attempted', orderId).run();
    await notifyOrderStatusChange(env.DB, orderId, `New field attempt logged for order #${orderId}`);

    return json({ ok: true }, 201);
  }

  const affidavitMatch = path.match(/^\/api\/orders\/(\d+)\/affidavit-draft$/);
  if (request.method === 'POST' && affidavitMatch) {
    const orderId = Number(affidavitMatch[1]);
    const order = await env.DB
      .prepare(
        `SELECT o.id, o.title, o.status, o.created_at, c.full_name AS client_name, s.full_name AS server_name
         FROM orders o
         LEFT JOIN users c ON c.id = o.client_id
         LEFT JOIN users s ON s.id = o.assigned_server_id
         WHERE o.id = ?`
      )
      .bind(orderId)
      .first<{ id: number; title: string; status: string; created_at: string; client_name: string; server_name: string | null }>();

    if (!order) {
      return json({ error: 'Order not found' }, 404);
    }

    const attempts = await env.DB
      .prepare('SELECT created_at, notes, gps_lat, gps_lng FROM attempts WHERE order_id = ? ORDER BY created_at')
      .bind(orderId)
      .all<{ created_at: string; notes: string; gps_lat: number | null; gps_lng: number | null }>();

    const attemptLines = attempts.results.length
      ? attempts.results
          .map((attempt) => `- ${attempt.created_at}: ${attempt.notes}${attempt.gps_lat !== null && attempt.gps_lng !== null ? ` (GPS ${attempt.gps_lat}, ${attempt.gps_lng})` : ''}`)
          .join('\n')
      : '- No attempts logged yet.';

    const bodyText = [
      'AFFIDAVIT / PROOF OF SERVICE (DRAFT)',
      `Order #${order.id}: ${order.title}`,
      `Client: ${order.client_name}`,
      `Assigned Process Server: ${order.server_name ?? 'Unassigned'}`,
      `Current Status: ${order.status}`,
      '',
      'Attempt Timeline:',
      attemptLines,
      '',
      'I declare under penalty of perjury that the foregoing is true and correct.',
      'Signature: ________________________'
    ].join('\n');

    await env.DB
      .prepare(
        `INSERT INTO affidavits (order_id, drafted_by, body, status, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', datetime('now'), datetime('now'))
         ON CONFLICT(order_id) DO UPDATE SET body = excluded.body, drafted_by = excluded.drafted_by, updated_at = datetime('now')`
      )
      .bind(orderId, user.id, bodyText)
      .run();

    return json({ ok: true, affidavit: bodyText });
  }

  const invoiceMatch = path.match(/^\/api\/orders\/(\d+)\/invoice-stub$/);
  if (request.method === 'POST' && invoiceMatch) {
    if (user.role !== 'agency_admin') {
      return json({ error: 'Forbidden' }, 403);
    }

    const orderId = Number(invoiceMatch[1]);
    await env.DB
      .prepare(
        `INSERT INTO invoices (order_id, amount_cents, currency, status, stripe_checkout_url, created_at)
         VALUES (?, ?, 'usd', 'stub_pending', ?, datetime('now'))`
      )
      .bind(orderId, 5900, 'https://example.com/stripe-checkout-stub')
      .run();

    await notifyOrderStatusChange(env.DB, orderId, `Invoice stub generated for order #${orderId}`);
    return json({ ok: true, invoice: { orderId, amountCents: 5900, status: 'stub_pending' } }, 201);
  }

  return json({ error: 'Not found' }, 404);
};
