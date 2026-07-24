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
  event.waitUntil((async () => {
    // 既にアプリが開いているタブがあれば、そこへ直接メッセージを送って
    // 通知履歴を表示させる（openWindowだと既存タブを前面に出すだけで
    // ページの再読み込みが起きず、URLパラメータでの判定が効かない端末があるため）
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) await client.focus();
      client.postMessage({ type: 'openNotif', notifId });
      return;
    }
    const url = './' + (notifId ? '?notif=' + notifId : '');
    await self.clients.openWindow(url);
  })());
});
