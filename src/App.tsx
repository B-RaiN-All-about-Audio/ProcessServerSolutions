import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import './App.css';

type Role = 'agency_admin' | 'process_server' | 'client';

type User = {
  id: number;
  full_name: string;
  agency: string;
  email: string;
  role: Role;
};

type Order = {
  id: number;
  title: string;
  details: string;
  status: string;
  deadline: string | null;
  client_name: string;
  assigned_server_name: string | null;
  created_at: string;
};

type Notification = {
  id: number;
  order_id: number | null;
  message: string;
  channel: 'in_app' | 'email_stub' | 'push_stub';
  created_at: string;
  read_at: string | null;
};

const statusOptions = ['new', 'assigned', 'attempted', 'completed', 'affidavit_ready'];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    ...init
  });

  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? 'Request failed');
  }

  return json;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [servers, setServers] = useState<User[]>([]);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [message, setMessage] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const [signinForm, setSigninForm] = useState({ email: '', password: '' });
  const [signupForm, setSignupForm] = useState({ fullName: '', agency: '', email: '', password: '' });
  const [orderForm, setOrderForm] = useState({ title: '', details: '', deadline: '' });
  const [attemptForm, setAttemptForm] = useState({ orderId: '', notes: '', gpsLat: '', gpsLng: '', physicalDescription: '', timelineNote: '', evidenceUrl: '' });
  const [statusForm, setStatusForm] = useState({ orderId: '', status: 'assigned' });
  const [assignForm, setAssignForm] = useState({ orderId: '', serverId: '' });

  const isAuthed = Boolean(user);

  const dashboardStats = useMemo(() => {
    const all = orders.length;
    const completed = orders.filter((order) => order.status === 'completed').length;
    const deadlineWatch = orders.filter((order) => order.deadline).length;
    return { all, completed, deadlineWatch };
  }, [orders]);

  async function refreshSessionAndData() {
    const session = await api<{ user: User | null }>('/api/auth/session', { method: 'GET' });
    setUser(session.user);

    if (session.user) {
      const [orderData, noticeData] = await Promise.all([
        api<{ orders: Order[] }>('/api/orders', { method: 'GET' }),
        api<{ notifications: Notification[] }>('/api/notifications', { method: 'GET' })
      ]);
      setOrders(orderData.orders);
      setNotifications(noticeData.notifications);

      if (session.user.role === 'agency_admin') {
        const serverData = await api<{ users: User[] }>('/api/users/process-servers', { method: 'GET' });
        setServers(serverData.users);
      } else {
        setServers([]);
      }
    } else {
      setOrders([]);
      setNotifications([]);
      setServers([]);
    }
  }

  useEffect(() => {
    refreshSessionAndData().catch((error: unknown) => setMessage((error as Error).message));
  }, []);

  useEffect(() => {
    if (!isAuthed) return;

    const timer = setInterval(() => {
      refreshSessionAndData().catch(() => undefined);
    }, 12000);

    return () => clearInterval(timer);
  }, [isAuthed]);

  async function onSignIn(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await api('/api/auth/signin', { method: 'POST', body: JSON.stringify(signinForm) });
      await refreshSessionAndData();
      setMessage('Signed in successfully.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onSignUp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          ...signupForm,
          agency: signupForm.agency || 'Independent'
        })
      });
      await refreshSessionAndData();
      setMessage('Trial account created.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onSignOut() {
    await api('/api/auth/signout', { method: 'POST' });
    await refreshSessionAndData();
    setMessage('Signed out.');
  }

  async function onCreateOrder(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/api/orders', { method: 'POST', body: JSON.stringify(orderForm) });
      setOrderForm({ title: '', details: '', deadline: '' });
      await refreshSessionAndData();
      setMessage('Order created.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function onAssign(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/orders/${assignForm.orderId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ serverId: Number(assignForm.serverId) })
      });
      await refreshSessionAndData();
      setMessage('Server assigned.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function onStatusUpdate(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/orders/${statusForm.orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: statusForm.status })
      });
      await refreshSessionAndData();
      setMessage('Status updated.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function onAttempt(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/orders/${attemptForm.orderId}/attempts`, {
        method: 'POST',
        body: JSON.stringify({
          notes: attemptForm.notes,
          gpsLat: attemptForm.gpsLat ? Number(attemptForm.gpsLat) : null,
          gpsLng: attemptForm.gpsLng ? Number(attemptForm.gpsLng) : null,
          physicalDescription: attemptForm.physicalDescription,
          timelineNote: attemptForm.timelineNote,
          evidenceUrl: attemptForm.evidenceUrl
        })
      });
      setAttemptForm({ orderId: '', notes: '', gpsLat: '', gpsLng: '', physicalDescription: '', timelineNote: '', evidenceUrl: '' });
      await refreshSessionAndData();
      setMessage('Attempt logged.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function onDraftAffidavit(orderId: number) {
    try {
      const result = await api<{ affidavit: string }>(`/api/orders/${orderId}/affidavit-draft`, { method: 'POST' });
      setMessage(`Affidavit draft ready for order #${orderId}.\n\n${result.affidavit}`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function onGenerateInvoice(orderId: number) {
    try {
      await api(`/api/orders/${orderId}/invoice-stub`, { method: 'POST' });
      await refreshSessionAndData();
      setMessage(`Invoice stub generated for order #${orderId}.`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function onEnablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setMessage('This browser does not support Push API.');
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const keyData = await api<{ publicKey: string }>('/api/push/public-key', { method: 'GET' });
      if (!keyData.publicKey) {
        setMessage('VAPID public key is not configured yet.');
        return;
      }

      const convertedKey = urlBase64ToUint8Array(keyData.publicKey);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey as BufferSource
      });
      const jsonSubscription = subscription.toJSON();
      await api('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: jsonSubscription.endpoint,
          p256dh: jsonSubscription.keys?.p256dh,
          auth: jsonSubscription.keys?.auth
        })
      });

      setMessage('Push subscription enabled.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  return (
    <div className="app">
      <header className="hero">
        <h1>Process Server Solutions CRM</h1>
        <p>Dispatch smarter. Serve faster. Keep clients informed with website, email, and push updates.</p>
        <div className="plans">
          <article><h3>Solo</h3><p>$29/mo</p><small>30-day free trial</small></article>
          <article><h3>Professional</h3><p>$59/mo</p><small>30-day free trial</small></article>
          <article><h3>Agency</h3><p>$99/mo</p><small>30-day free trial</small></article>
        </div>
      </header>

      {!user ? (
        <section className="card auth-card">
          <div className="tabs">
            <button className={authMode === 'signin' ? 'active' : ''} onClick={() => setAuthMode('signin')} type="button">Sign in</button>
            <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')} type="button">Start free trial</button>
          </div>

          {authMode === 'signin' ? (
            <form onSubmit={onSignIn}>
              <input placeholder="Email" type="email" value={signinForm.email} onChange={(event) => setSigninForm((value) => ({ ...value, email: event.target.value }))} required />
              <input placeholder="Password" type="password" value={signinForm.password} onChange={(event) => setSigninForm((value) => ({ ...value, password: event.target.value }))} required />
              <button disabled={loading} type="submit">Sign in</button>
            </form>
          ) : (
            <form onSubmit={onSignUp}>
              <input placeholder="Full name" value={signupForm.fullName} onChange={(event) => setSignupForm((value) => ({ ...value, fullName: event.target.value }))} required />
              <input placeholder="Agency / Firm" value={signupForm.agency} onChange={(event) => setSignupForm((value) => ({ ...value, agency: event.target.value }))} />
              <input placeholder="Email" type="email" value={signupForm.email} onChange={(event) => setSignupForm((value) => ({ ...value, email: event.target.value }))} required />
              <input placeholder="Password" type="password" value={signupForm.password} onChange={(event) => setSignupForm((value) => ({ ...value, password: event.target.value }))} required />
              <button disabled={loading} type="submit">Create trial account</button>
            </form>
          )}
        </section>
      ) : (
        <>
          <section className="card account-bar">
            <p>
              Signed in as <strong>{user.full_name}</strong> ({user.role}) — {user.agency}
            </p>
            <div className="action-row">
              <button type="button" onClick={onEnablePush}>Enable push notifications</button>
              <button type="button" onClick={onSignOut}>Sign out</button>
            </div>
          </section>

          <section className="grid stats">
            <article className="card"><h4>All Orders</h4><p>{dashboardStats.all}</p></article>
            <article className="card"><h4>Completed Orders</h4><p>{dashboardStats.completed}</p></article>
            <article className="card"><h4>Deadline Watch</h4><p>{dashboardStats.deadlineWatch}</p></article>
          </section>

          {(user.role === 'agency_admin' || user.role === 'client') && (
            <section className="card">
              <h2>Jobs & Intake / Service Orders</h2>
              <form onSubmit={onCreateOrder} className="stacked">
                <input placeholder="Order title" value={orderForm.title} onChange={(event) => setOrderForm((value) => ({ ...value, title: event.target.value }))} required />
                <textarea placeholder="Case details" value={orderForm.details} onChange={(event) => setOrderForm((value) => ({ ...value, details: event.target.value }))} required />
                <input type="datetime-local" value={orderForm.deadline} onChange={(event) => setOrderForm((value) => ({ ...value, deadline: event.target.value || '' }))} />
                <button type="submit">Create service order</button>
              </form>
            </section>
          )}

          {user.role === 'agency_admin' && (
            <section className="grid split">
              <article className="card">
                <h2>Case Dispatch & Operations</h2>
                <form onSubmit={onAssign} className="stacked">
                  <input placeholder="Order ID" value={assignForm.orderId} onChange={(event) => setAssignForm((value) => ({ ...value, orderId: event.target.value }))} required />
                  <select value={assignForm.serverId} onChange={(event) => setAssignForm((value) => ({ ...value, serverId: event.target.value }))} required>
                    <option value="">Select process server</option>
                    {servers.map((server) => <option key={server.id} value={server.id}>{server.full_name}</option>)}
                  </select>
                  <button type="submit">Assign server</button>
                </form>
              </article>
              <article className="card">
                <h2>Status & Billing</h2>
                <form onSubmit={onStatusUpdate} className="stacked">
                  <input placeholder="Order ID" value={statusForm.orderId} onChange={(event) => setStatusForm((value) => ({ ...value, orderId: event.target.value }))} required />
                  <select value={statusForm.status} onChange={(event) => setStatusForm((value) => ({ ...value, status: event.target.value }))}>
                    {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <button type="submit">Update status</button>
                </form>
              </article>
            </section>
          )}

          {(user.role === 'process_server' || user.role === 'agency_admin') && (
            <section className="card">
              <h2>Field Attempts & Evidence Logging</h2>
              <form onSubmit={onAttempt} className="stacked">
                <input placeholder="Order ID" value={attemptForm.orderId} onChange={(event) => setAttemptForm((value) => ({ ...value, orderId: event.target.value }))} required />
                <textarea placeholder="Attempt notes" value={attemptForm.notes} onChange={(event) => setAttemptForm((value) => ({ ...value, notes: event.target.value }))} required />
                <div className="grid two-up">
                  <input placeholder="GPS latitude" value={attemptForm.gpsLat} onChange={(event) => setAttemptForm((value) => ({ ...value, gpsLat: event.target.value }))} />
                  <input placeholder="GPS longitude" value={attemptForm.gpsLng} onChange={(event) => setAttemptForm((value) => ({ ...value, gpsLng: event.target.value }))} />
                </div>
                <input placeholder="Physical description" value={attemptForm.physicalDescription} onChange={(event) => setAttemptForm((value) => ({ ...value, physicalDescription: event.target.value }))} />
                <input placeholder="Attempt timeline note" value={attemptForm.timelineNote} onChange={(event) => setAttemptForm((value) => ({ ...value, timelineNote: event.target.value }))} />
                <input placeholder="Evidence URL (R2 path or signed URL)" value={attemptForm.evidenceUrl} onChange={(event) => setAttemptForm((value) => ({ ...value, evidenceUrl: event.target.value }))} />
                <button type="submit">Log field attempt</button>
              </form>
            </section>
          )}

          <section className="card">
            <h2>{user.role === 'client' ? 'Client Portal / Live Status' : 'All Orders Dashboard'}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Client</th>
                    <th>Server</th>
                    <th>Deadline</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.id}</td>
                      <td>{order.title}</td>
                      <td>{order.status}</td>
                      <td>{order.client_name}</td>
                      <td>{order.assigned_server_name ?? 'Unassigned'}</td>
                      <td>{order.deadline || '—'}</td>
                      <td>
                        <button type="button" onClick={() => onDraftAffidavit(order.id)}>Draft affidavit</button>
                        {user.role === 'agency_admin' && (
                          <button type="button" onClick={() => onGenerateInvoice(order.id)}>Invoice stub</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Activity Feed / Notifications</h2>
            <ul className="activity-feed">
              {notifications.map((item) => (
                <li key={item.id}>
                  <strong>{item.channel}</strong> — {item.message}
                  <small>{item.created_at}</small>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section className="features">
        <article className="card"><h3>Client CRM + Portal</h3><p>Clients can track service orders, see attempt timeline updates, and receive real-time activity feed events.</p></article>
        <article className="card"><h3>Affidavits & Proof</h3><p>Generate affidavit drafts from logged attempts to accelerate proof-of-service document workflows.</p></article>
        <article className="card"><h3>Billing Automation</h3><p>Create invoice stubs and connect Stripe checkout links when owner-side credentials are configured.</p></article>
        <article className="card"><h3>Notifications</h3><p>Every status change emits in-app updates plus email and push stubs for production integration.</p></article>
      </section>

      {message && <pre className="card message">{message}</pre>}
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray;
}

export default App;
