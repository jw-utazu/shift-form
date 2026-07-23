// ============================================================
// プッシュ通知（Web Push, POC）用の最小Service Worker
// ============================================================
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'シフト管理';
  const options = {
    body: data.body || '',
    icon: './logo.png',
    badge: './logo.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('./'));
});
