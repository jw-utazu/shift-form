// ============================================================
// PW_GWS 共通ログイン画面
//
// 3つのアプリ（フォーム / 管理 / シフト作成）の入口を1つにまとめたもの。
// ここで Google 認証 → サーバーで権限確認 → 権限に応じた行き先へ振り分ける。
// 各アプリの app.js / index.js には依存しない自己完結の実装にしてある
// （このページが壊れると誰もログインできなくなるため、依存を最小にする）。
// ============================================================
const API_URL   = 'https://nqtswiynoxawccldqcwi.supabase.co/functions/v1/api';
const ANON_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdHN3aXlub3hhd2NjbGRxY3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzQxNjIsImV4cCI6MjA5ODMxMDE2Mn0.M-AnCBnXBI1FIyouoa5ttF6mb8PF2YqHfv180PqQWQU';
const CLIENT_ID = '538467678510-7ltuvmuj0d1mmgngtj980me3daenqmm7.apps.googleusercontent.com';

const APP_FORM   = 'https://jw-utazu.github.io/shift-form/';
const APP_ADMIN  = 'https://jw-utazu.github.io/admin/';
const APP_CREATE = 'https://jw-utazu.github.io/admin/shift-create.html';

let _returnUrl = '';

// ============================================================
// 共通ユーティリティ
// ============================================================
function q(id) { return document.getElementById(id); }

function show(name) {
  ['signin', 'choose', 'recovery'].forEach(s => {
    q('sec-' + s).style.display = (s === name) ? 'block' : 'none';
  });
}

function setBusy(on, msg) {
  q('busy').style.display = on ? 'flex' : 'none';
  if (msg) q('busy-text').textContent = msg;
}

function showErr(msg) {
  const el = q('err');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function api(action, params) {
  const url = API_URL + '?action=' + encodeURIComponent(action) +
              '&params=' + encodeURIComponent(JSON.stringify(params || {}));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  return fetch(url, { redirect: 'follow', signal: ctrl.signal,
                      headers: { 'Authorization': 'Bearer ' + ANON_KEY } })
    .then(r => { clearTimeout(timer); return r.json(); })
    .catch(err => {
      clearTimeout(timer);
      throw new Error(err.name === 'AbortError' ? '通信タイムアウト' : '通信エラー');
    });
}

// Googleが返す ID トークン（JWT）のペイロードを取り出す。
// atob() はバイト列を1文字1バイトの文字列として返すため、そのまま JSON.parse すると
// 日本語（UTF-8で複数バイト）の氏名が文字化けする。TextDecoder で正しく復号する
function decodeJwtPayload(credential) {
  const b64   = credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bin   = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

// 戻り先URLは同一オリジンのものだけ許可する（外部サイトへ飛ばされるのを防ぐ）
function safeReturnUrl(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw, location.href);
    if (u.origin !== location.origin) return '';
    return u.href;
  } catch (_) { return ''; }
}

// ============================================================
// 起動
// ============================================================
(function init() {
  const sp = new URLSearchParams(location.search);
  _returnUrl = safeReturnUrl(sp.get('return'));

  const reason = sp.get('reason');
  if (reason === 'noadmin') {
    showErr('このアカウントには管理者権限がありません。別のアカウントでログインしてください。');
  } else if (reason === 'expired') {
    showErr('ログインの有効期限が切れました。もう一度ログインしてください。');
  } else if (reason === 'unauthorized') {
    showErr('このアカウントはアクセスが許可されていません。区域係にお問い合わせください。');
  }

  // 既にログイン済みならそのまま行き先へ
  const s = pwgwsGetSession();
  const rec = pwgwsGetRecoveryToken();
  if (s || rec) {
    setBusy(true, 'ログイン状態を確認中...');
    resumeExisting(s, rec);
    return;
  }
  show('signin');
})();

// 保存済みのログインを検証して、有効なら行き先へ進む
async function resumeExisting(s, recToken) {
  try {
    // 救済ログイン中はそちらを優先（Googleアカウントが使えない状態のため）
    if (recToken) {
      const r = await api('validateRecoverySession', { sessionToken: recToken });
      if (r.ok) { routeByPermission(r, r.name); return; }
    }
    if (s) {
      const res = await authByEmail(s.email);
      // 表示名はサーバー（会衆の登録名）を優先する。保存済みのGoogle表示名は
      // 以前のバージョンで文字化けしたまま保存されている可能性があるため
      if (res && res.ok && !res.needsRegister) { routeByPermission(res, res.name || s.name); return; }
    }
  } catch (_) { /* 検証に失敗したらログイン画面を出す */ }
  setBusy(false);
  show('signin');
}

// auth は email をクエリで渡す仕様のため専用に組み立てる
function authByEmail(email) {
  const url = API_URL + '?action=auth&source=form&email=' + encodeURIComponent(email);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  return fetch(url, { redirect: 'follow', signal: ctrl.signal,
                      headers: { 'Authorization': 'Bearer ' + ANON_KEY } })
    .then(r => { clearTimeout(timer); return r.json(); })
    .catch(err => {
      clearTimeout(timer);
      throw new Error(err.name === 'AbortError' ? '通信タイムアウト' : '通信エラー');
    });
}

// ============================================================
// Google ログイン
// ============================================================
function initGoogleLogin() {
  try {
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: onGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: false,
      ux_mode: 'popup',
    });
    google.accounts.id.renderButton(q('g-btn'), {
      type: 'standard', theme: 'filled_blue', size: 'large',
      width: 280, text: 'signin_with', locale: 'ja',
    });
  } catch (e) {
    showErr('Googleログインの読み込みに失敗しました。ページを再読み込みしてください。');
  }
}

async function onGoogleCredential(response) {
  setBusy(true, 'アカウントを確認中...');
  showErr('');
  try {
    const payload = decodeJwtPayload(response.credential);
    const email   = payload.email   || '';
    const name    = payload.name    || '';
    const picture = payload.picture || '';

    const res = await authByEmail(email);
    if (!res.ok) {
      setBusy(false);
      showErr(res.reason === 'unauthorized'
        ? 'このアカウントはアクセスが許可されていません。区域係にお問い合わせください。'
        : '認証エラーが発生しました。');
      show('signin');
      return;
    }

    // 共通セッションを保存（権限は保存しない。各アプリが毎回サーバーに問い合わせる）
    pwgwsSaveSession(email, name, picture);

    // 初回登録が必要な人はフォームアプリ側の登録画面へ送る
    // （uid が未確定でアイコンを保存できないため、保存は登録完了後に行う）
    if (res.needsRegister) { location.replace(APP_FORM); return; }

    // Googleのアイコンをサーバーに保存する。この URL は Google ログインを通った
    // 瞬間にしか取得できないため、ここで渡しておく必要がある。
    // アイコンは無くても使えるので、失敗してもログインは続行する
    if (picture) {
      setBusy(true, 'プロフィールを準備中...');
      try { await api('saveGoogleAvatar', { email, pictureUrl: picture }); } catch (_) {}
    }

    routeByPermission(res, res.name || name);
  } catch (e) {
    setBusy(false);
    showErr('ログインに失敗しました: ' + e.message);
    show('signin');
  }
}

// ============================================================
// 権限に応じた振り分け
// ============================================================
function routeByPermission(res, displayName) {
  // 戻り先が指定されている場合は、その画面に入る権限があるかを確認してから戻す
  if (_returnUrl) {
    const needsAdmin = _returnUrl.indexOf('/admin/') !== -1;
    if (!needsAdmin || res.isAdmin) { location.replace(_returnUrl); return; }
    // 管理アプリに戻ろうとしたが権限がない場合はフォームアプリへ
    setBusy(false);
    showErr('このアカウントには管理者権限がありません。');
    show('signin');
    return;
  }

  // 戻り先の指定が無い場合：管理者は行き先を選べるようにする
  if (res.isAdmin) {
    setBusy(false);
    q('choose-name').textContent = (displayName || '') + ' さん';
    show('choose');
    return;
  }
  location.replace(APP_FORM);
}

function goApp(which) {
  location.replace(which === 'admin' ? APP_ADMIN : which === 'create' ? APP_CREATE : APP_FORM);
}

function switchAccount() {
  pwgwsClearSession();
  try { google.accounts.id.disableAutoSelect(); } catch (_) {}
  location.replace('login.html');
}

// ============================================================
// 救済ログイン（Googleアカウントが使えない場合）
// ============================================================
function getDeviceToken() {
  let t = '';
  try { t = localStorage.getItem('pwgws_device_token') || ''; } catch (_) {}
  if (!t) {
    t = (crypto.randomUUID ? crypto.randomUUID()
         : String(Date.now()) + Math.random().toString(36).slice(2));
    try { localStorage.setItem('pwgws_device_token', t); } catch (_) {}
  }
  return t;
}

function openRecovery() { showErr(''); show('recovery'); }
function backToSignin() { showErr(''); show('signin'); }

function setRecMsg(id, text, isErr) {
  const el = q(id);
  el.textContent = text;
  el.className = 'rec-msg' + (isErr ? ' err' : '');
}

async function submitRecoveryRequest() {
  const name      = q('rec-name').value.trim();
  const email     = q('rec-email').value.trim();
  const sharedKey = q('rec-key').value.trim();
  if (!name)      { setRecMsg('rec-msg', 'お名前を入力してください。', true); return; }
  if (!sharedKey) { setRecMsg('rec-msg', '合言葉を入力してください。', true); return; }

  const btn = q('btn-rec-submit');
  btn.disabled = true;
  setRecMsg('rec-msg', '送信中...', false);
  try {
    const res = await api('requestRecoveryLogin', {
      name: name, email: email, sharedKey: sharedKey, deviceToken: getDeviceToken()
    });
    if (!res.ok) {
      const msgs = {
        bad_key:      '合言葉が違います。区域係にご確認ください。',
        rate_limited: '試行回数が多すぎます。しばらく時間をおいてからお試しください。',
      };
      setRecMsg('rec-msg', msgs[res.reason] || '申請できませんでした。入力内容をご確認ください。', true);
      btn.disabled = false;
      return;
    }
    q('rec-step-form').style.display = 'none';
    q('rec-step-otp').style.display  = 'block';
    setRecMsg('rec-msg', '', false);
  } catch (e) {
    setRecMsg('rec-msg', '通信エラーが発生しました。', true);
    btn.disabled = false;
  }
}

async function submitRecoveryOtp() {
  const otp = q('rec-otp').value.trim();
  if (!/^\d{6}$/.test(otp)) { setRecMsg('rec-otp-msg', '6桁の数字を入力してください。', true); return; }

  const btn = q('btn-rec-otp');
  btn.disabled = true;
  setRecMsg('rec-otp-msg', '確認中...', false);
  try {
    const res = await api('verifyRecoveryOtp', { otp: otp, deviceToken: getDeviceToken() });
    if (!res.ok) {
      const msgs = {
        not_approved:      'まだ承認されていません。区域係からの連絡をお待ちください。',
        otp_expired:       'パスコードの有効期限が切れました。もう一度申請してください。',
        too_many_attempts: '入力を間違えた回数が上限に達しました。もう一度申請してください。',
        bad_otp:           'パスコードが違います。' +
                           (typeof res.remaining === 'number' ? '（残り' + res.remaining + '回）' : ''),
        rate_limited:      '試行回数が多すぎます。しばらく時間をおいてからお試しください。',
      };
      setRecMsg('rec-otp-msg', msgs[res.reason] || 'ログインできませんでした。', true);
      btn.disabled = false;
      return;
    }
    try { localStorage.setItem('pwgws_recovery_session', res.sessionToken); } catch (_) {}
    alert('ログインしました。\n\nこのログインは ' + res.days + '日間 有効です。\n' +
          '期限が切れる前に、区域係に連絡してメールアドレスの変更を済ませてください。');
    routeByPermission(res, res.name);
  } catch (e) {
    setRecMsg('rec-otp-msg', '通信エラーが発生しました。', true);
    btn.disabled = false;
  }
}
