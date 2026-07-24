// ============================================================
// プッシュ通知（Web Push）用の最小Service Worker
// ============================================================
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'シフト管理';
  const options = {
    body: data.body || '',
    icon: './logo.png',
    badge: './logo.png',
    data: { notifId: data.notifId },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifId = event.notification.data && event.notification.data.notifId;
  const url = './' + (notifId ? '?notif=' + notifId : '');
  event.waitUntil(self.clients.openWindow(url));
});
