// ============================================================
// プッシュ通知（Web Push）用の最小Service Worker
// ============================================================
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'シフト管理';
  const options = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
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
    const scopeUrl = new URL(self.registration.scope);
    const indexPath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : scopeUrl.pathname + '/';
    const allClients = await self.clients.matchAll({ type: 'window' });
    const indexClient = allClients.find(client => {
      try {
        const clientUrl = new URL(client.url);
        return clientUrl.origin === scopeUrl.origin &&
          (clientUrl.pathname === indexPath || clientUrl.pathname === indexPath + 'index.html');
      } catch (_) { return false; }
    });
    // login.html 等へ通知を渡すと、ログイン後に通知履歴が開かない。
    // 制御中のindexだけを再利用し、無ければ通知URLで新しいindexを開く。
    if (indexClient) {
      if ('focus' in indexClient) await indexClient.focus();
      indexClient.postMessage({ type: 'openNotif', notifId });
      return;
    }
    const url = './' + (notifId ? '?notif=' + encodeURIComponent(String(notifId)) : '');
    await self.clients.openWindow(url);
  })());
});
