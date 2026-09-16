self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Process Server Solutions', body: 'New order update available.' };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Process Server Solutions', {
      body: data.body || 'Open the dashboard for details.',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: data.url || '/'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data || '/';
  event.waitUntil(clients.openWindow(target));
});
