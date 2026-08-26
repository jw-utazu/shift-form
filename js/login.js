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
// 「別のアカウントを追加」から来たとき（?add=1）。
// 既にログイン済みでも素通りさせず、必ず Google の選択画面を出す
let _addMode = false;
let _recoveryStartGoogleIdentity = '';

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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const headers = { 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' };
  const token = pwgwsGetSessionToken();
  if (token) headers['X-PWGWS-Session'] = token;
  return fetch(API_URL, { method: 'POST', redirect: 'follow', signal: ctrl.signal,
                      headers: headers, body: JSON.stringify(Object.assign({ action: action }, params || {})) })
    .then(async r => {
      clearTimeout(timer);
      let data = null;
      try { data = await r.json(); } catch (_) {}
      if (r.status === 401) {
        pwgwsInvalidateCurrentToken();
        throw new Error('ログインの有効期限が切れました');
      }
      if (r.status === 403) throw new Error((data && data.error) || 'このアカウントは許可されていません');
      if (!r.ok) throw new Error((data && data.error) || ('通信エラー (' + r.status + ')'));
      return data;
    })
    .catch(err => {
      clearTimeout(timer);
      throw new Error(err.name === 'AbortError' ? '通信タイムアウト' : (err.message || '通信エラー'));
    });
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
  _addMode   = sp.get('add') === '1';

  const reason = sp.get('reason');
  if (reason === 'noadmin') {
    showErr('このアカウントには管理者権限がありません。別のアカウントでログインしてください。');
  } else if (reason === 'expired') {
    showErr('ログインの有効期限が切れました。もう一度ログインしてください。');
  } else if (reason === 'unauthorized') {
    showErr('このアカウントはアクセスが許可されていません。区域係にお問い合わせください。');
  }

  // アカウント追加モード：今のログインで素通りさせず、選択画面を出す。
  // 追加をやめたときに戻れるよう「キャンセル」を出す（戻り先が分かる場合のみ）
  if (_addMode) {
    q('add-mode-note').style.display = 'block';
    if (_returnUrl) q('btn-add-cancel').style.display = 'inline-block';
    show('signin');
    return;
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

// アカウント追加をやめて元の画面へ戻る（今のログインはそのまま）
function cancelAddAccount() {
  if (_returnUrl) location.replace(_returnUrl);
}

// 保存済みのログインを検証して、有効なら行き先へ進む
async function resumeExisting(s, recToken) {
  try {
    // 救済ログイン中はそちらを優先（Googleアカウントが使えない状態のため）
    if (recToken) {
      const r = await api('validateRecoverySession', {});
      if (r.ok) { routeByPermission(r, r.name); return; }
    }
    if (s && s.token) {
      const res = await authByEmail(s.email);
      // 表示名はサーバー（会衆の登録名）を優先する。保存済みのGoogle表示名は
      // 以前のバージョンで文字化けしたまま保存されている可能性があるため
      if (res && res.ok && !res.needsRegister) { routeByPermission(res, res.name || s.name); return; }
    }
  } catch (_) { /* 検証に失敗したらログイン画面を出す */ }
  setBusy(false);
  show('signin');
}

// email は旧呼び出しとの互換引数。本人性はsession headerからサーバーが復元する。
function authByEmail(_email) { return api('auth', { source: 'form' }); }

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
    // 追加モードでは前回のアカウントが自動で選ばれないようにする。
    // これをしないと「別のアカウントを追加」で同じアカウントに戻ってしまう
    if (_addMode) { try { google.accounts.id.disableAutoSelect(); } catch (_) {} }
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
    // credential の中身をブラウザでは信用しない。署名・iss/aud/時刻・sub/email は
    // サーバーがGoogle JWKSで検証し、不透明なsession tokenへ交換する。
    const exchanged = await api('exchangeGoogleCredential', { credential: response.credential });
    const email = exchanged.email || '';
    const name = exchanged.name || '';
    const picture = exchanged.picture || '';
    pwgwsSaveSession(email, name, picture, exchanged.sessionToken, exchanged.expiresAt);

    const res = await authByEmail(email);
    if (!res.ok) {
      setBusy(false);
      showErr(res.reason === 'unauthorized'
        ? 'このアカウントはアクセスが許可されていません。区域係にお問い合わせください。'
        : '認証エラーが発生しました。');
      show('signin');
      return;
    }

    // 初回登録が必要な人はフォームアプリ側の登録画面へ送る
    // （uid が未確定でアイコンを保存できないため、保存は登録完了後に行う）
    if (res.needsRegister) { location.replace(APP_FORM); return; }

    // Googleのアイコンをサーバーに保存する。この URL は Google ログインを通った
    // 瞬間にしか取得できないため、ここで渡しておく必要がある。
    // アイコンは無くても使えるので、失敗してもログインは続行する
    if (picture) {
      setBusy(true, 'プロフィールを準備中...');
      try { await api('saveGoogleAvatar', { pictureUrl: picture }); } catch (_) {}
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

// 「別のアカウントでログイン」。今のアカウントは一覧に残したまま追加モードで開き直す
// （消してしまうと、行き来したいという複数アカウント運用が成り立たない）
function switchAccount() {
  try { google.accounts.id.disableAutoSelect(); } catch (_) {}
  location.replace('login.html?add=1' + (_returnUrl ? '&return=' + encodeURIComponent(_returnUrl) : ''));
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

function currentGoogleIdentity() {
  const s = pwgwsGetSession();
  return s ? s.email + ':' + (s.token || '') : '';
}
function openRecovery() {
  _recoveryStartGoogleIdentity = currentGoogleIdentity();
  showErr('');
  show('recovery');
}
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
    const googleIdentityChanged = currentGoogleIdentity() !== _recoveryStartGoogleIdentity;
    if (!pwgwsSaveRecoveryToken(res.sessionToken, _recoveryStartGoogleIdentity)) {
      setRecMsg('rec-otp-msg', googleIdentityChanged
        ? 'Googleログインへ切り替わったため、救済ログインは適用しませんでした。画面を更新します。'
        : 'ログイン情報をこの端末に保存できませんでした。ブラウザの保存設定をご確認ください。', true);
      btn.disabled = false;
      if (googleIdentityChanged) setTimeout(() => location.reload(), 0);
      return;
    }
    alert('ログインしました。\n\nこのログインは ' + res.days + '日間 有効です。\n' +
          '期限が切れる前に、区域係に連絡してメールアドレスの変更を済ませてください。');
    routeByPermission(res, res.name);
  } catch (e) {
    setRecMsg('rec-otp-msg', '通信エラーが発生しました。', true);
    btn.disabled = false;
  }
}
