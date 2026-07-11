// ===== 定数 =====
const API_URL    = "https://nqtswiynoxawccldqcwi.supabase.co/functions/v1/api";
const ANON_KEY   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdHN3aXlub3hhd2NjbGRxY3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzQxNjIsImV4cCI6MjA5ODMxMDE2Mn0.M-AnCBnXBI1FIyouoa5ttF6mb8PF2YqHfv180PqQWQU";
const CLIENT_ID  = "538467678510-7ltuvmuj0d1mmgngtj980me3daenqmm7.apps.googleusercontent.com";
const SS_KEY     = "shiftapp_session";

// ============================================================
// テストアカウント専用：疑似日付シミュレーション
// ============================================================
const TEST_EMAIL = 'jw.utazu.test@gmail.com';

// テストアカウントでログイン中かつ疑似日付が設定されている場合のみ値を返す
function getDebugFakeNow() {
  if (!SESSION || SESSION.email !== TEST_EMAIL) return '';
  return localStorage.getItem('debugFakeNow') || '';
}

// 「今日」判定はすべてこれを介す：疑似日付が設定されていればそれを、なければ実際の現在時刻を返す
function getSimulatedToday() {
  const fakeNow = getDebugFakeNow();
  if (fakeNow) {
    const [y, m, d] = fakeNow.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

function _debugDateLabel(value) {
  if (!value) return '実日付';
  const DAY_NAMES = ['日','月','火','水','木','金','土'];
  const [y, m, d] = value.split('-').map(Number);
  return m + '/' + d + '(' + DAY_NAMES[new Date(y, m - 1, d).getDay()] + ')';
}
function initDebugDatePanel() {
  const panel = document.getElementById('debugDatePanel');
  if (!panel) return;
  if (!SESSION || SESSION.email !== TEST_EMAIL) { panel.style.display = 'none'; return; }
  panel.style.display = 'flex';
  const toggleBtn = document.getElementById('debugDateToggleBtn');
  const toggleLabel = document.getElementById('debugDateToggleLabel');
  const card = document.getElementById('debugDateCard');
  const input = document.getElementById('debugFakeNowInput');
  const clearBtn = document.getElementById('debugFakeNowClearBtn');
  const savedValue = localStorage.getItem('debugFakeNow') || '';
  input.value = savedValue;
  toggleLabel.textContent = _debugDateLabel(savedValue);
  toggleBtn.classList.toggle('active', !!savedValue);
  toggleBtn.onclick = (e) => { e.stopPropagation(); card.classList.toggle('show'); };
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target)) card.classList.remove('show');
  });
  input.onchange = () => {
    if (input.value) localStorage.setItem('debugFakeNow', input.value);
    else localStorage.removeItem('debugFakeNow');
    // 古い表示のまま一瞬固まって見えないよう、reload前にオーバーレイを出す
    showLoading('疑似日付を反映しています...');
    location.reload();
  };
  clearBtn.onclick = () => {
    localStorage.removeItem('debugFakeNow');
    showLoading('実際の日付に戻しています...');
    location.reload();
  };
}

// ===== JSONP通信ユーティリティ（CORSを回避）=====
// actionはAPIのルーターで受け付けるアクション名
// paramsはオブジェクト（APIにJSONで渡す）
// extraQueryはURLに直接付加するオブジェクト（email等）
// fetch方式（リダイレクト追従対応・Android Chrome対応）
function apiGet(action, params, extraQuery) {
  // type パラメータを自動付与（明示的に渡された type が優先）
  const effectiveType = currentPwType === 'limited' ? limitedPwType : currentPwType;
  const p = Object.assign({ type: effectiveType }, params || {});
  const fakeNow = getDebugFakeNow();
  if (fakeNow) p.fakeNow = fakeNow;
  let url = API_URL + '?action=' + encodeURIComponent(action);
  url += '&params=' + encodeURIComponent(JSON.stringify(p));
  // fakeNowが有効＝テストアカウントでのログイン中。email未指定だとサーバー側で
  // テストアカウント判定ができずfakeNowが無視されるため、ここで付与する
  if (fakeNow && SESSION && SESSION.email && (!extraQuery || !extraQuery.email)) {
    url += '&email=' + encodeURIComponent(SESSION.email);
  }
  if (extraQuery) {
    Object.entries(extraQuery).forEach(([k, v]) => {
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(v);
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  return fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'Authorization': 'Bearer ' + ANON_KEY } })
    .then(r => { clearTimeout(timer); return r.json(); })
    .catch(err => {
      clearTimeout(timer);
      console.error('[api]', action, err);
      if (err.name === 'AbortError') throw new Error('通信タイムアウト');
      throw new Error('通信エラー（サーバーへの接続に失敗）');
    });
}

// ===== API POST（PDF等の大容量データ用） =====
function apiPost(action, params) {
  const payload = Object.assign({ action }, params);
  const fakeNow = getDebugFakeNow();
  if (fakeNow) {
    payload.fakeNow = payload.fakeNow || fakeNow;
    if (SESSION && SESSION.email) payload.email = payload.email || SESSION.email;
  }
  return fetch(API_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json()).then(d => {
    if (d && d.error && !d.ok) throw new Error(d.error);
    return d;
  }).catch(err => {
    console.error('[api]', action, err);
    throw err;
  });
}

// ===== グローバル状態 =====
let currentPwType = 'normal'; // 'normal' | 'limited'
let limitedPwType = 'limited'; // 実際の限定PWタイプID（isLimitedMemberで確定）
let isLimitedMember = false;   // 限定PWメンバーかどうか
let limitedPwName = '限定PW'; // 限定PWの表示名
let LIMITED_APP_DATA  = null; // 限定PW の APP_DATA
let LIMITED_SHIFT_DATA = null; // 限定PW の SHIFT_DATA
let LIMITED_DETAIL    = null; // 限定PW の getFormDetail
let SESSION      = null; // { uid, name, email, token, isAdmin, isResponsible, isCart, proxyTargets }
let _isPreviewMode         = false;
let _previewOriginalSession = null;
let APP_DATA     = null; // APIから取得したデータ
let SHIFT_DATA   = null; // シフト表データ
let SHIFT_DATES  = [];   // 実施日一覧（カレンダーB10以降、'm/d'形式）
let SHIFT_DATES_MAP = {}; // 実施日→時間帯リスト { 'm_d': ['10:00〜12:00', ...] }
let NORMAL_SHIFT_DATES = [];     // 通常PW 実施日一覧（統合カレンダー用）
let NORMAL_SHIFT_DATES_MAP = {}; // 通常PW 実施日→時間帯リスト（統合カレンダー用）
let SLOTS        = [], LAST_MONTH = {}, THIS_MONTH = {};
let YEAR = 0, MONTH = 0;
let currentFormName = '';
let currentFormUid  = '';
let isCartUser = false;
let lastMonthOn = false;
const formState = { checkedMap: {}, cartNgMap: {}, noteMap: {} };
let deferredPrompt = null;
let shouldShowOneTap = false; // セッションなしの時だけtrueにしてOne Tapを表示
let shiftViewingDate = null; // 現在表示中のシフト日付
let staffEditMode = false;   // 奉仕者編集モード
let _modalInHistory = null;       // 戻るボタンで閉じるモーダル識別子
let _suppressNextPopstate = false; // モーダルを直接閉じた際のpopstate抑制フラグ
let _mainHistorySetup = false;     // main 下に __bottom__ エントリを1度だけ挿入したか

// ===== PWA =====
const _isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function _updateInstallBtn() {
  const b = document.getElementById('btn-install');
  if (b && (_isIOS || deferredPrompt)) b.style.display = 'flex';
}

window.addEventListener('beforeinstallprompt', e => {
  deferredPrompt = e;
  _updateInstallBtn();
  const s = document.getElementById('pwa-auto-section');
  if (s) s.style.display = 'block';
});

// iOS では起動時にボタンを表示し、手順セクションを有効化
if (_isIOS) {
  _updateInstallBtn();
  const s = document.getElementById('pwa-ios-section');
  if (s) s.style.display = 'block';
}

function installPWA() {
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  document.getElementById('pwa-install-overlay').classList.add('show');
}
function closePwaInstallModal() {
  document.getElementById('pwa-install-overlay').classList.remove('show');
}
function closePwaInstallOutside(e) {
  if (e.target === document.getElementById('pwa-install-overlay')) closePwaInstallModal();
}
async function installPWADirect() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  if (outcome === 'accepted') closePwaInstallModal();
}


// ===== ローディング =====
let _progressTimer  = null;
let _progressCurrent = 0;
let _hideResolve    = null; // hideLoading()が呼ばれたときに解決するPromise

function showLoading(msg) {
  const el = document.getElementById('loading-overlay');
  document.getElementById('loading-text').textContent = msg || '読み込み中...';
  if (!el.classList.contains('show')) {
    // 新規表示のときだけリセットして疑似プログレス開始
    _progressCurrent = 0;
    _setProgress(0);
    el.classList.add('show');
    _startProgress();
  } else {
    // すでに表示中はメッセージだけ更新（プログレスはそのまま継続）
  }
}

// hideLoading()はPromiseを返す。await hideLoading()で完全消滅を待てる
function hideLoading() {
  return new Promise(resolve => {
    clearInterval(_progressTimer);
    _progressTimer = null;
    // 現在値から100%までゆっくり上げてからフェードアウト
    _animateTo100(() => {
      setTimeout(() => {
        document.getElementById('loading-overlay').classList.remove('show');
        setTimeout(() => {
          _setProgress(0);
          _progressCurrent = 0;
          resolve();
        }, 600);
      }, 600); // 100%表示後600ms待機
    });
  });
}

// 現在値→100%までアニメーション（800msかけて滑らかに）
function _animateTo100(callback) {
  const startPct  = _progressCurrent;
  const startTime = performance.now();
  const duration  = 800;
  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    // easeOutCubic
    const eased = 1 - Math.pow(1 - t, 3);
    const pct = Math.round(startPct + (100 - startPct) * eased);
    _setProgress(pct);
    _progressCurrent = pct;
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      if (callback) callback();
    }
  }
  requestAnimationFrame(step);
}

function _setProgress(pct) {
  const bar = document.getElementById('loading-progress-bar');
  const txt = document.getElementById('loading-progress-pct');
  if (bar) bar.style.width = pct + '%';
  if (txt) txt.textContent = pct + '%';
}

function _startProgress() {
  clearInterval(_progressTimer);
  _progressCurrent = 0;
  _progressTimer = setInterval(() => {
    if (_progressCurrent >= 99) { clearInterval(_progressTimer); return; }
    let randFactor;
    if (_progressCurrent < 80) {
      // 0%→80%：ランダム性のある速度で進める
      randFactor = 0.02 + Math.random() * 0.05;
    } else {
      // 80%→99%：処理中はごくゆっくり上げ続ける
      randFactor = 0.003 + Math.random() * 0.005;
    }
    const ceiling  = _progressCurrent < 80 ? 80 : 99;
    const remaining = ceiling - _progressCurrent;
    const step = Math.max(0.1, remaining * randFactor);
    _progressCurrent = Math.min(ceiling, _progressCurrent + step);
    _setProgress(Math.round(_progressCurrent));
  }, 120);
}

// ===== 画面切替 =====
const SCREENS = ['login','register','main','form','shift','request','bug','road-permit'];
// 画面ごとの display 値
const SCREEN_DISPLAY = {
  login:    'flex',
  register: 'flex',
  main:     'block',
  form:           'block',
  shift:          'block',
  request:        'block',
  bug:            'block',
  'road-permit':  'block'
};
// ===== History API による戻るボタン対応 =====
// 戻るボタンで履歴を積まない画面（ログイン画面のみ底とする）
const HISTORY_NO_PUSH = new Set(['login']);

// 画面の「深さ」（進む/戻るの方向判定用）
const SCREEN_DEPTH = { login: 0, register: 1, main: 2, form: 3, shift: 3, request: 3, bug: 3, 'road-permit': 3 };
let _currentScreenName = 'login';

function showScreen(name, fromPopstate) {
  window.scrollTo(0, 0);
  const isBack = fromPopstate || SCREEN_DEPTH[name] < SCREEN_DEPTH[_currentScreenName];
  const animClass = isBack ? 'screen-enter-back' : 'screen-enter-forward';

  SCREENS.forEach(s => {
    const el = document.getElementById('screen-' + s);
    if (s === name) {
      el.style.display = SCREEN_DISPLAY[s] || 'block';
      // アニメーションクラスをリセットしてから再付与
      el.classList.remove('screen-enter-forward', 'screen-enter-back');
      void el.offsetWidth; // reflow で animation をリセット
      el.classList.add(animClass);
    } else {
      el.style.display = 'none';
      el.classList.remove('screen-enter-forward', 'screen-enter-back');
    }
  });

  _currentScreenName = name;

  if (name === 'form')          _showFormScreen();
  if (name === 'shift')         _showShiftScreen();
  if (name === 'road-permit')   _initRoadPermitScreen();

  // form-back-btnのonclickを設定（動的IDのため）
  const formBackBtn = document.getElementById('form-back-btn');
  if (formBackBtn) {
    formBackBtn.onclick = () => history.back();
  }

  // popstateからの呼び出しでなければ履歴に積む
  if (!fromPopstate && !HISTORY_NO_PUSH.has(name)) {
    if (name === 'main') {
      if (!_mainHistorySetup) {
        _mainHistorySetup = true;
        // main の直下に番兵エントリを1度だけ挿入し、ここまで戻ると確認ダイアログを表示
        history.pushState({ screen: '__bottom__' }, '');
      }
      history.pushState({ screen: 'main' }, '');
    } else {
      history.pushState({ screen: name }, '');
    }
  }
}

// 戻るボタン（ブラウザ・スマホ）が押されたとき
window.addEventListener('popstate', function(e) {
  // モーダルを直接閉じた際のpopstateを抑制（履歴エントリ除去のhistry.go(-1)由来）
  if (_suppressNextPopstate) {
    _suppressNextPopstate = false;
    return;
  }

  // モーダル・編集モードが履歴に積まれていた場合は閉じるだけで画面遷移しない
  if (_modalInHistory) {
    const which = _modalInHistory;
    _modalInHistory = null;
    if (which === 'help')        document.getElementById('help-overlay').classList.remove('show');
    else if (which === 'roadPdf')  document.getElementById('road-pdf-view-modal').style.display = 'none';
    else if (which === 'adminPdf') {
      document.getElementById('admin-pdf-preview-overlay').style.display = 'none';
      document.getElementById('admin-pdf-preview-iframe').src = '';
    }
    else if (which === 'staffEdit')   exitStaffEditMode();
    else if (which === 'roadPdfEdit') document.getElementById('road-pdf-edit-overlay').style.display = 'none';
    return;
  }

  const state = e.state;
  const screen = state && state.screen;

  if (!screen) {
    // 念のため main に戻す
    history.replaceState({ screen: 'main' }, '');
    showScreen('main', true);
    return;
  }

  // main 下の番兵エントリ → 「アプリを閉じますか？」確認ダイアログ
  if (screen === '__bottom__') {
    if (SESSION) {
      const leave = confirm('アプリを閉じますか？');
      if (leave) {
        const closed = (function() { try { window.close(); return true; } catch(ex) { return false; } })();
        if (!closed) {
          _suppressNextPopstate = true;
          history.go(1);
        }
      } else {
        _suppressNextPopstate = true;
        history.go(1);
      }
    } else {
      _suppressNextPopstate = true;
      history.go(1);
    }
    return;
  }

  // shift画面の詳細→一覧の内部遷移（前進で detail エントリに戻った場合）
  // ※ quickJump（メイン画面から直接開いた詳細）はこの内部遷移の対象外
  if (screen === 'shift' && state.subScreen === 'detail' && !state.quickJump) {
    _shiftDetailBack();
    return;
  }

  showScreen(screen, true);
});

// フォーム画面：SLOTSが未取得なら getFormDetail を取得してから表示
async function _showFormScreen() {
  if (SLOTS && SLOTS.length > 0) {
    // キャッシュ済み → 即表示
    initFormScreen();
    return;
  }
  showLoading('フォームデータを読み込み中...');
  try {
    const detail = await apiGet('getFormDetail');
    SLOTS      = detail.slots      || [];
    LAST_MONTH = detail.lastMonthData || {};
    // thisMonthDataはdataMini取得済みだが、getFormDetailが最新値を返すので上書き
    if (detail.thisMonthData) THIS_MONTH = detail.thisMonthData;
    // staffJSONをAPP_DATAに統合
    if (APP_DATA) APP_DATA.staffJSON = detail.staffJSON || [];
    await hideLoading();
    initFormScreen();
  } catch (e) {
    hideLoading();
    alert('フォームデータの読み込みに失敗しました: ' + e.message);
  }
}

// シフト表画面：SHIFT_DATAが未取得なら getShiftTable を取得してから表示
async function _showShiftScreen() {
  if (SHIFT_DATA) {
    // キャッシュ済み（BG取得済み含む）→ 即表示
    initShiftScreen();
    return;
  }
  showLoading('シフト表を読み込み中...');
  try {
    const shiftData = await apiGet('getShiftTable');
    SHIFT_DATA = shiftData;
    await hideLoading();
    initShiftScreen();
  } catch (e) {
    hideLoading();
    alert('シフト表の読み込みに失敗しました: ' + e.message);
  }
}

// ===== sessionStorage =====
function saveSession(s) {
  try { localStorage.setItem(SS_KEY, JSON.stringify(s)); } catch (_) {}
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SS_KEY) || 'null'); } catch (_) { return null; }
}
function clearSession() {
  try { localStorage.removeItem(SS_KEY); } catch (_) {}
}

// ===== Google Identity Services 初期化 =====
// GISライブラリ読み込み後に自動で呼ばれるコールバック
function initGoogleLogin() {
  try {
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: onGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: false,
      ux_mode: 'popup',        // リダイレクトではなくポップアップ
    });
    const btnDiv = document.getElementById('g-btn-container');
    if (btnDiv) {
      google.accounts.id.renderButton(btnDiv, {
        type: 'standard',
        theme: 'filled_green',
        size: 'large',
        width: 280,
        text: 'signin_with',
        locale: 'ja',
      });
    }
    // One Tap：セッションなし（未ログイン）の時だけ表示
    if (shouldShowOneTap) {
      google.accounts.id.prompt();
    }
  } catch (e) {
    // GISが未ロードなら何もしない（ボタンはHTMLに既にある）
    console.warn('GIS init error:', e);
  }
}

async function onGoogleCredential(response) {
  showLoading('認証中...');
  try {
    const parts   = response.credential.split('.');
    const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
    const email   = payload.email   || '';
    const name    = payload.name    || '';
    const picture = payload.picture || '';
    await handleAuth(email, response.credential, name, picture);
  } catch (e) {
    hideLoading();
    showLoginError('ユーザー情報の取得に失敗しました。ページを再読み込みしてください。');
  }
}

async function handleAuth(email, token, displayName, picture) {
  showLoading('認証中...');
  try {
    const data = await apiGet('auth', null, { source: 'form', email });
    hideLoading();

    if (!data.ok) {
      if (data.reason === 'unauthorized') {
        showLoginError('このアカウントはアクセス許可されていません。\n管理者にお問い合わせください。');
      } else {
        showLoginError('認証エラーが発生しました: ' + (data.reason || ''));
      }
      return;
    }

    if (data.needsRegister) {
      saveSession({ email, token, needsRegister: true, members: data.members, picture: picture || '' });
      buildRegisterScreen(data.members, email, token, displayName, picture || '');
      return;
    }

    // ログイン成功
    SESSION = {
      uid: data.uid, name: data.name, email: email, token: token,
      isAdmin: data.isAdmin, isResponsible: data.isResponsible,
      isCart: data.isCart, isAccountant: data.isAccountant || false,
      proxyTargets: data.proxyTargets || [],
      picture: picture || ''
    };
    saveSession({ email, token, picture: picture || '' });
    // One Tapが表示中なら閉じる
    shouldShowOneTap = false;
    try { google.accounts.id.cancel(); } catch(_) {}
    await initApp();
  } catch (e) {
    hideLoading();
    showLoginError('通信エラーが発生しました。ページを再読み込みしてください。');
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-err');
  el.textContent = msg;
  el.classList.add('show');
  showScreen('login');
}

// ===== 初回登録 =====
function buildRegisterScreen(members, email, token, displayName, picture) {
  const sel = document.getElementById('sel-register-name');
  sel.innerHTML = '<option value="">-- 選択してください --</option>';
  members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = m.name;
    sel.appendChild(opt);
  });
  // メタ情報を一時保存
  sel.dataset.email   = email;
  sel.dataset.token   = token;
  sel.dataset.picture = picture || '';
  showScreen('register');
}

async function doRegister() {
  const sel   = document.getElementById('sel-register-name');
  const name  = sel.value;
  const email = sel.dataset.email;
  if (!name) { alert('名前を選択してください。'); return; }
  const btn = document.getElementById('btn-register');
  btn.disabled = true;
  showLoading('登録中...');
  try {
    const data = await apiGet('register', { email, name });
    if (!data.ok) throw new Error(data.error || '登録に失敗しました');
    SESSION = {
      uid: data.uid, name: data.name, email: email, token: sel.dataset.token,
      isAdmin: data.isAdmin, isResponsible: data.isResponsible,
      isCart: data.isCart, isAccountant: data.isAccountant || false,
      proxyTargets: data.proxyTargets || [],
      picture: sel.dataset.picture || ''
    };
    saveSession({ email, token: sel.dataset.token, picture: sel.dataset.picture || '' });
    await initApp();
  } catch (e) {
    await hideLoading();
    const msg = document.getElementById('register-msg');
    msg.className = 'msg error';
    msg.textContent = '⚠️ ' + e.message;
    btn.disabled = false; btn.textContent = '登録する';
  }
}

// ===== プロフィールポップアップ =====
function updateAvatarUI() {
  if (!SESSION) return;
  const pic = SESSION.picture || '';
  // すべての画面のヘッダーアバターを更新（ページ遷移後も維持）
  if (pic && !_isPreviewMode) {
    document.querySelectorAll('.hdr-avatar').forEach(el => {
      const img = document.createElement('img');
      img.src = pic;
      img.alt = SESSION.name || '';
      img.onerror = () => { el.innerHTML = '<span class="hdr-avatar-fallback">👤</span>'; };
      el.innerHTML = '';
      el.appendChild(img);
    });
    const ppAvatar = document.getElementById('pp-avatar');
    if (ppAvatar) {
      const img = document.createElement('img');
      img.src = pic;
      img.alt = SESSION.name || '';
      img.onerror = () => { ppAvatar.innerHTML = '<span style="font-size:22px;">👤</span>'; };
      ppAvatar.innerHTML = '';
      ppAvatar.appendChild(img);
    }
  } else if (_isPreviewMode) {
    document.querySelectorAll('.hdr-avatar').forEach(el => {
      el.innerHTML = '<span class="hdr-avatar-fallback">👤</span>';
    });
    const ppAvatar = document.getElementById('pp-avatar');
    if (ppAvatar) ppAvatar.innerHTML = '<span style="font-size:22px;">👤</span>';
  }
  // ポップアップ内情報
  const ppName  = document.getElementById('pp-name');
  const ppEmail = document.getElementById('pp-email');
  const ppRoles = document.getElementById('pp-roles');
  if (ppName)  ppName.textContent  = SESSION.name;
  if (ppEmail) ppEmail.textContent = SESSION.email;
  if (ppRoles) {
    ppRoles.innerHTML = '';
    if (SESSION.isAdmin && !SESSION.uid) {
      // 管理アカウント（uidなし）：オーナーのみ
      ppRoles.innerHTML = '<span class="badge" style="background:#fef9c3;color:#713f12;">オーナー</span>';
    } else {
      // メンバー全員：奉仕者を必ず最初に表示、その後役割バッジを追加
      ppRoles.innerHTML += '<span class="badge badge-staff">奉仕者</span>';
      if (SESSION.isAdmin)       ppRoles.innerHTML += '<span class="badge" style="background:#fef9c3;color:#713f12;">管理者</span>';
      if (SESSION.isAccountant)  ppRoles.innerHTML += '<span class="badge" style="background:#dbeafe;color:#1e40af;">会計者</span>';
      if (SESSION.isResponsible) ppRoles.innerHTML += '<span class="badge badge-resp">責任者</span>';
      if (SESSION.isCart)        ppRoles.innerHTML += '<span class="badge badge-cart">カート担当</span>';
    }
  }
}
function toggleProfilePopup() {
  const popup   = document.getElementById('profile-popup');
  const overlay = document.getElementById('profile-overlay');
  const isOpen  = popup.classList.contains('show');
  if (isOpen) {
    popup.classList.remove('show');
    overlay.classList.remove('show');
  } else {
    updateAvatarUI();
    popup.classList.add('show');
    overlay.classList.add('show');
  }
}
function closeProfilePopup() {
  document.getElementById('profile-popup').classList.remove('show');
  document.getElementById('profile-overlay').classList.remove('show');
}

// ===== メンバープレビュー（オーナー専用） =====
let _previewMemberList = [];

async function openMemberPreview() {
  const overlay = document.getElementById('member-preview-overlay');
  const modal   = document.getElementById('member-preview-modal');
  const list    = document.getElementById('member-preview-list');
  list.innerHTML = '<div style="padding:16px;text-align:center;color:#6b7280;font-size:14px;">読み込み中...</div>';
  overlay.style.display = 'block';
  modal.style.display   = 'flex';
  try {
    const data = await apiGet('getMemberList');
    _previewMemberList = (data.members || []);
    renderPreviewMemberList(_previewMemberList);
  } catch (e) {
    list.innerHTML = '<div style="padding:16px;color:#dc2626;font-size:14px;">読み込みに失敗しました</div>';
  }
}

function renderPreviewMemberList(members) {
  const list = document.getElementById('member-preview-list');
  if (!members.length) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:#6b7280;font-size:14px;">メンバーが見つかりません</div>';
    return;
  }
  list.innerHTML = members.map(m =>
    `<button onclick="startPreview('${esc(m.uid)}','${esc(m.name)}','${esc(m.email||'')}')" style="width:100%;background:none;border:none;text-align:left;padding:12px 16px;cursor:pointer;font-size:14px;color:#1f2937;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;gap:10px;">
      <span style="font-size:18px;">${m.gender === 'M' ? '👨' : '👩'}</span>
      <span style="font-weight:600;">${esc(m.name)}</span>
      ${m.isResponsible ? '<span style="font-size:10px;background:#dbeafe;color:#1e40af;padding:1px 5px;border-radius:4px;">責任者</span>' : ''}
      ${m.isCart        ? '<span style="font-size:10px;background:#dcfce7;color:#15803d;padding:1px 5px;border-radius:4px;">カート</span>' : ''}
    </button>`
  ).join('');
}

function filterPreviewMembers() {
  const q = document.getElementById('member-preview-search').value.trim();
  if (!q) { renderPreviewMemberList(_previewMemberList); return; }
  renderPreviewMemberList(_previewMemberList.filter(m => m.name.includes(q) || (m.furigana || '').includes(q)));
}

function closeMemberPreviewModal() {
  document.getElementById('member-preview-overlay').style.display = 'none';
  document.getElementById('member-preview-modal').style.display   = 'none';
  document.getElementById('member-preview-search').value = '';
}

async function startPreview(uid, name, email) {
  closeMemberPreviewModal();
  showLoading(name + 'さんのデータを読み込み中...');
  try {
    // 切替時もオーナーのセッションを使う（プレビュー中は SESSION がメンバーに置き換わっているため）
    const ownerSession = _isPreviewMode ? _previewOriginalSession : SESSION;
    const data = await apiGet('previewMember', null, { adminEmail: ownerSession.email, targetUid: uid });
    if (!data.ok) throw new Error(data.reason || '取得失敗');
    if (!_isPreviewMode) _previewOriginalSession = Object.assign({}, SESSION); // 初回のみ保存
    _isPreviewMode = true;
    SESSION = {
      uid:          data.uid,
      name:         data.name,
      email:        data.email || email,
      token:        ownerSession.token,
      picture:      '',
      isAdmin:      data.isAdmin,
      isResponsible:data.isResponsible,
      isCart:       data.isCart,
      isAccountant: data.isAccountant,
      proxyTargets: data.proxyTargets || []
    };
    // バナー表示
    const banner = document.getElementById('preview-banner');
    document.getElementById('preview-banner-name').textContent = data.name;
    banner.style.display = 'flex';
    // 画面上部にバナー分の余白を追加
    document.body.style.paddingTop = '40px';
    await initApp();
  } catch (e) {
    hideLoading();
    alert('プレビューの開始に失敗しました: ' + e.message);
  }
}

function exitPreview() {
  if (!_previewOriginalSession) return;
  SESSION = _previewOriginalSession;
  _previewOriginalSession = null;
  _isPreviewMode = false;
  document.getElementById('preview-banner').style.display = 'none';
  document.body.style.paddingTop = '';
  initApp();
}

// ===== シフト自動更新チェック =====
let _knownTimestamp = null;
let _updateCheckerTimer = null;
let _updateCheckerListening = false;

async function checkShiftUpdate() {
  if (!SESSION) return;
  try {
    const res = await apiGet('getShiftLastUpdated');
    if (!res || !res.ok) return;
    if (_knownTimestamp === null) {
      _knownTimestamp = res.lastUpdated;
      return;
    }
    if (res.lastUpdated !== _knownTimestamp) {
      document.getElementById('shift-update-banner').style.display = 'block';
    }
  } catch (e) { console.warn('[checkShiftUpdate]', e); }
}

async function reloadShiftData() {
  document.getElementById('shift-update-banner').style.display = 'none';
  _knownTimestamp = null;
  await initApp();
}

function startUpdateChecker() {
  clearInterval(_updateCheckerTimer);
  _updateCheckerTimer = setInterval(checkShiftUpdate, 5 * 60 * 1000);
  if (!_updateCheckerListening) {
    _updateCheckerListening = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkShiftUpdate();
    });
  }
  checkShiftUpdate();
}

// ===== ログアウト =====
function logout() {
  clearInterval(_updateCheckerTimer);
  _knownTimestamp = null;
  document.getElementById('shift-update-banner').style.display = 'none';
  clearSession();
  SESSION = null; APP_DATA = null; SHIFT_DATA = null; SHIFT_DATES = []; SHIFT_DATES_MAP = {};
  { const panel = document.getElementById('debugDatePanel'); if (panel) panel.style.display = 'none'; }
  SLOTS = []; LAST_MONTH = {}; THIS_MONTH = {};
  currentPwType = 'normal'; limitedPwType = 'limited'; isLimitedMember = false; limitedPwName = '限定PW';
  LIMITED_APP_DATA = null; LIMITED_SHIFT_DATA = null; LIMITED_DETAIL = null;
  _mainHistorySetup = false; // 再ログイン時に __bottom__ を再挿入するためリセット
  closeProfilePopup();
  google.accounts.id.disableAutoSelect();
  showScreen('login');
  // ログアウト後はOne Tapを表示（initialize()は初回のみ呼び出し済みなので prompt() だけでよい）
  shouldShowOneTap = true;
  setTimeout(() => {
    try { google.accounts.id.prompt(); } catch(_) {}
  }, 100);
}

// ===== アプリ初期化 =====
async function initApp() {
  initDebugDatePanel();
  showLoading('データを読み込み中...');
  // 再読み込み時は一旦通常PWとして再構築し、必要なら最後に限定PWビューへ戻す
  const prevPwType = currentPwType;
  currentPwType = 'normal';
  const _tabN = document.getElementById('pw-tab-form-normal');
  const _tabL = document.getElementById('pw-tab-form-limited');
  if (_tabN) _tabN.className = 'pw-type-tab-form active';
  if (_tabL) _tabL.className = 'pw-type-tab-form limited';
  try {
    // isLimitedMember チェックと dataMini・getFormDetail・getShiftTable を並列取得
    const uid = SESSION ? SESSION.uid : '';
    const [limRes, formData, detail, shiftData] = await Promise.all([
      uid ? apiGet('isLimitedMember', { uid }) : Promise.resolve({ ok: true, isLimited: false }),
      apiGet('dataMini', { type: 'normal' }),
      apiGet('getFormDetail', { type: 'normal' }),
      apiGet('getShiftTable', { type: 'normal' })
    ]);

    isLimitedMember = limRes.ok && limRes.isLimited;
    if (isLimitedMember && limRes.type) limitedPwType = limRes.type;
    if (isLimitedMember && limRes.name) limitedPwName = limRes.name;

    // 限定PWタブの表示制御
    const pwBar = document.getElementById('pw-type-bar-form');
    if (pwBar) pwBar.style.display = isLimitedMember ? 'flex' : 'none';
    const tabLimited = document.getElementById('pw-tab-form-limited');
    if (tabLimited && isLimitedMember) tabLimited.textContent = limitedPwName;

    // 限定PWメンバーの場合は統合カレンダー用に限定PW側データも取得
    if (isLimitedMember) {
      const [limFormData, limDetail, limShiftData] = await Promise.all([
        apiGet('dataMini',      { type: limitedPwType }),
        apiGet('getFormDetail', { type: limitedPwType }),
        apiGet('getShiftTable', { type: limitedPwType })
      ]);
      LIMITED_APP_DATA  = limFormData;
      LIMITED_SHIFT_DATA = limShiftData;
      LIMITED_DETAIL    = limDetail;
    }

    APP_DATA    = formData;
    SHIFT_DATA  = shiftData;
    // getFormDetail側のthisMonthDataはslots付きで正しく生成されているのでそちらを優先
    THIS_MONTH  = (detail.thisMonthData && Object.keys(detail.thisMonthData).length > 0)
                    ? detail.thisMonthData
                    : (formData.thisMonthData || {});
    SLOTS       = detail.slots         || [];
    LAST_MONTH  = detail.lastMonthData || {};
    if (APP_DATA) APP_DATA.staffJSON = detail.staffJSON || [];

    YEAR        = formData.year  || 0;
    MONTH       = formData.month || 0;
    SHIFT_DATES = formData.shiftDates || [];
    SHIFT_DATES_MAP = {};
    (formData.shiftSlots || []).forEach(s => {
      const key = s.m + '_' + s.d;
      if (!SHIFT_DATES_MAP[key]) SHIFT_DATES_MAP[key] = [];
      if (!SHIFT_DATES_MAP[key].includes(s.time)) SHIFT_DATES_MAP[key].push(s.time);
    });
    // 通常PW の実施日を統合カレンダー用に保存
    NORMAL_SHIFT_DATES     = SHIFT_DATES.slice();
    NORMAL_SHIFT_DATES_MAP = Object.assign({}, SHIFT_DATES_MAP);

    try {
      buildMainScreen();
    } catch (buildErr) {
      console.error('buildMainScreen error:', buildErr);
      await hideLoading();
      alert('画面の構築に失敗しました: ' + buildErr.message);
      return;
    }
    await hideLoading();
    showScreen('main');
    // 再読み込み前に限定PWを見ていた場合はビューを復元（タブと表示内容のズレを防ぐ）
    if (prevPwType !== 'normal' && isLimitedMember) {
      await switchFormPwType(prevPwType);
    }
    startUpdateChecker();
  } catch (e) {
    hideLoading();
    console.error('initApp error:', e);
    alert('データの読み込みに失敗しました: ' + e.message);
  }
}

// ===== メイン画面構築 =====
function buildMainScreen() {
  // バー年月表示
  const baseLabel = (YEAR && MONTH) ? YEAR + '年' + MONTH + '月PW' : '宇多津会衆PWアプリ';
  const yearMonthLabel = (currentPwType !== 'normal') ? limitedPwName : baseLabel;
  document.getElementById('main-title').textContent = yearMonthLabel;
  document.getElementById('form-title') && (document.getElementById('form-title').textContent = yearMonthLabel);
  document.title = '宇多津会衆PWアプリ';

  // バー右アイコン更新
  updateAvatarUI();

  const isOwner = SESSION.isAdmin && !SESSION.uid;
  const ed      = APP_DATA.eventDates || {};
  let   status  = APP_DATA.status || '準備中';
  const today   = getSimulatedToday(); today.setHours(0,0,0,0);
  // 限定PWはフェーズ情報からstatus上書き
  if (currentPwType !== 'normal' && APP_DATA && APP_DATA.phases) {
    const _phases = APP_DATA.phases;
    const _ai = APP_DATA.activePhaseIndex;
    if (typeof _ai === 'number' && _ai >= 0) {
      status = '受付中';
    } else {
      const todayMs = today.getTime();
      const allPast = _phases.length > 0 && _phases.every(p => {
        if (!p.deadline) return true;
        return new Date(p.deadline.y, p.deadline.m - 1, p.deadline.d).getTime() < todayMs;
      });
      status = (allPast ? '受付終了' : '準備中');
    }
  }

  // 今日が締切日か判定
  const parseEventDate = str => {
    if (!str) return null;
    const p = str.split('/');
    if (p.length !== 2) return null;
    // 年をYEARから取得（シフト当月の年）
    const y = YEAR || today.getFullYear();
    return new Date(y, parseInt(p[0]) - 1, parseInt(p[1]));
  };
  const deadlineD      = parseEventDate(ed['締切']);
  const isDeadlineToday = deadlineD && deadlineD.getTime() === today.getTime();
  const openD          = parseEventDate(ed['シフト公開']);
  const isOpenDateSet  = !!openD;
  const isOpenPassed   = openD && openD.getTime() <= today.getTime();

  // ── シフト希望ボタン：受付中のみ有効、それ以外はグレーアウト、管理者は非表示 ──
  const btnForm    = document.getElementById('btn-shift-form');
  const btnFormTxt = document.getElementById('btn-shift-form-txt');
  const btnFormIco = document.getElementById('btn-shift-form-icon');
  // 自分（またはオーナー以外）の今月送信済みデータ確認
  const myUid = SESSION ? SESSION.uid : '';
  const hasSentThisMonth = myUid && THIS_MONTH[myUid] &&
    Object.keys(THIS_MONTH[myUid].checkedMap || {}).length > 0;
  if (btnForm) {
    if (isOwner || _isPreviewMode) {
      // オーナー・プレビュー中：日程条件を無視して常に表示（フォームは読み取り専用）
      btnForm.disabled = false;
      btnForm.style.opacity = '';
      btnForm.style.cursor  = '';
      btnForm.onclick = () => showScreen('form');
      btnForm.style.display = '';
      if (isOwner && !_isPreviewMode) {
        if (btnFormTxt) btnFormTxt.textContent = 'シフト希望を見る';
        if (btnFormIco) btnFormIco.textContent = '👁';
      } else if (hasSentThisMonth) {
        if (btnFormTxt) btnFormTxt.textContent = 'シフト希望を編集する';
        if (btnFormIco) btnFormIco.textContent = '✏️';
        btnForm.style.background = '';
      } else {
        if (btnFormTxt) btnFormTxt.textContent = 'シフト希望を送る';
        if (btnFormIco) btnFormIco.textContent = '📝';
      }
    } else if (isOpenPassed) {
      btnForm.style.display = 'none';
    } else if (status === '受付中') {
      btnForm.disabled = false;
      btnForm.style.opacity = '';
      btnForm.style.cursor  = '';
      btnForm.onclick = () => showScreen('form');
      btnForm.style.display = '';
      if (hasSentThisMonth) {
        if (btnFormTxt) btnFormTxt.textContent = 'シフト希望を編集する';
        if (btnFormIco) btnFormIco.textContent = '✏️';
        btnForm.style.background = '';
      } else {
        if (btnFormTxt) btnFormTxt.textContent = 'シフト希望を送る';
        if (btnFormIco) btnFormIco.textContent = '📝';
      }
    } else if (status === '受付終了') {
      // 締切後は非表示
      btnForm.style.display = 'none';
    } else {
      // 準備中はグレーアウト
      btnForm.disabled = true;
      btnForm.style.opacity = '0.5';
      btnForm.style.cursor  = 'default';
      btnForm.onclick = null;
      btnForm.style.display = '';
      if (btnFormTxt) btnFormTxt.textContent = 'シフト希望を送る';
      if (btnFormIco) btnFormIco.textContent = '📝';
    }
  }

  // ── 希望一覧ボックスを構築 ──
  buildWishListBox(status, isOpenPassed);

  // ── 要望ボタン：プレビュー中のみ非表示（オーナーも表示） ──
  const btnRequest = document.getElementById('btn-request');
  if (btnRequest) btnRequest.style.display = _isPreviewMode ? 'none' : '';

  // ── メンバープレビューボタン：オーナーかつ非プレビュー時のみ表示 ──
  const btnMemberPreview = document.getElementById('btn-member-preview');
  if (btnMemberPreview) btnMemberPreview.style.display = (isOwner && !_isPreviewMode) ? '' : 'none';

  // ── 道路許可書更新ボタン：会計者のみ表示 ──
  const btnRoadUpdate = document.getElementById('btn-road-permit-update');
  if (btnRoadUpdate) btnRoadUpdate.style.display = SESSION.isAccountant ? '' : 'none';

  // ── 受付状況 ──
  const sv = document.getElementById('status-value');
  const sd = document.getElementById('status-dates');
  sv.className = 'status-value';
  sv.style.color = '';
  document.getElementById('status-closed-msg').classList.remove('show');

  if (isDeadlineToday) {
    sv.textContent = '🔒 締切日';
    sv.classList.add('status-closed');
    sv.style.color = 'var(--danger)';
    sd.innerHTML = '';
  } else if (status === '受付中') {
    sv.textContent = '✅ 受付中';
    sv.classList.add('status-open');
    sd.innerHTML = '';
  } else if (status === '準備中') {
    sv.textContent = '⏳ 受付準備中';
    sv.classList.add('status-prep');
    sd.textContent = '';
  } else {
    sv.textContent = '🔒 受付終了';
    sv.classList.add('status-closed');
    sd.textContent = '';
    document.getElementById('status-closed-msg').classList.add('show');
  }

  // シフト公開日以降は受付状況カードを非表示（プレビュー中は常に表示）
  const receptionCard = document.getElementById('reception-status-card');
  if (receptionCard) receptionCard.style.display = (isOpenPassed && !_isPreviewMode) ? 'none' : '';

  // カレンダー描画（今日が含まれる月を初期表示）
  const todayForCal = getSimulatedToday();
  calDisplayYear  = todayForCal.getFullYear();
  calDisplayMonth = todayForCal.getMonth() + 1;
  buildCalendar();

  // ── 次のシフト ──
  buildNextShift(isOpenPassed);

  // ── お知らせ ──
  const notices = APP_DATA.notices || [];
  if (notices.length > 0) {
    const nc = document.getElementById('notices-container');
    nc.innerHTML = '';
    notices.forEach(n => {
      nc.innerHTML += `<div class="notice-item">
        <div class="notice-date">${n.date}</div>
        <div class="notice-title">${esc(n.title)}</div>
        <div class="notice-body">${esc(n.body)}</div>
      </div>`;
    });
    document.getElementById('notices-card').style.display = '';
  }
}

// カレンダー表示中の年月（実際の今月 or 先月）
let calDisplayYear  = 0;
let calDisplayMonth = 0;

function calNavMonth(delta) {
  let newY = calDisplayYear;
  let newM = calDisplayMonth + delta;
  if (newM < 1)  { newM = 12; newY--; }
  if (newM > 12) { newM = 1;  newY++; }

  const realToday = getSimulatedToday();
  const realY = realToday.getFullYear();
  const realM = realToday.getMonth() + 1;
  const minVal = realY * 100 + realM;

  let maxVal;
  if (currentPwType !== 'normal') {
    // 限定PW: 今日から6ヶ月 or 最終スロット月
    const future = new Date(realToday);
    future.setMonth(future.getMonth() + 6);
    let futureVal = future.getFullYear() * 100 + (future.getMonth() + 1);
    let lastSlotVal = minVal;
    ((APP_DATA && APP_DATA.phases) || []).forEach(p => {
      (p.slots || []).forEach(s => {
        const v = s.y * 100 + s.m;
        if (v > lastSlotVal) lastSlotVal = v;
      });
    });
    maxVal = Math.max(futureVal, lastSlotVal);
  } else {
    // 通常PW: 今日の月〜シフト当月
    const shiftY = YEAR  || realY;
    const shiftM = MONTH || realM;
    maxVal = Math.max(shiftY * 100 + shiftM, minVal);
  }

  const targetVal = newY * 100 + newM;
  if (targetVal < minVal || targetVal > maxVal) return;

  calDisplayYear  = newY;
  calDisplayMonth = newM;
  _selectedShiftKey = null;
  const box = document.getElementById('shift-time-box');
  if (box) box.classList.remove('show');
  buildCalendar();
}

function buildCalendar() {
  const ed     = APP_DATA.eventDates || {};
  const grid   = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const dispY = calDisplayYear;
  const dispM = calDisplayMonth;
  document.getElementById('cal-title').textContent = dispY + '年' + dispM + '月';

  // 今日（ハイライト用。疑似日付が設定されていればそれを使う）
  const today = getSimulatedToday(); today.setHours(0,0,0,0);

  // ナビボタンの活性制御（今日の月〜シフト当月）
  const shiftY = YEAR  || getSimulatedToday().getFullYear();
  const shiftM = MONTH || getSimulatedToday().getMonth() + 1;
  const realToday2 = getSimulatedToday();
  const realY2 = realToday2.getFullYear();
  const realM2 = realToday2.getMonth() + 1;
  const minVal2 = realY2 * 100 + realM2;
  const isLimitedPw = currentPwType !== 'normal';
  let maxVal2;
  if (isLimitedPw) {
    const future = new Date(realToday2);
    future.setMonth(future.getMonth() + 6);
    const futureVal = future.getFullYear() * 100 + (future.getMonth() + 1);
    let lastSlotVal = minVal2;
    ((APP_DATA && APP_DATA.phases) || []).forEach(p => {
      (p.slots || []).forEach(s => {
        const v = s.y * 100 + s.m;
        if (v > lastSlotVal) lastSlotVal = v;
      });
    });
    maxVal2 = Math.max(futureVal, lastSlotVal);
  } else {
    maxVal2 = Math.max(shiftY * 100 + shiftM, minVal2);
  }
  const curVal2 = dispY * 100 + dispM;
  const prevBtn = document.getElementById('cal-prev-btn');
  const nextBtn = document.getElementById('cal-next-btn');
  if (prevBtn) {
    prevBtn.style.opacity      = curVal2 <= minVal2 ? '0.35' : '1';
    prevBtn.style.pointerEvents = curVal2 <= minVal2 ? 'none' : '';
  }
  if (nextBtn) {
    nextBtn.style.opacity      = curVal2 >= maxVal2 ? '0.35' : '1';
    nextBtn.style.pointerEvents = curVal2 >= maxVal2 ? 'none' : '';
  }

  // 月インジケータードット生成
  const dotsEl = document.getElementById('cal-dots');
  if (dotsEl) {
    dotsEl.innerHTML = '';
    let dy = realY2, dm = realM2;
    while (dy * 100 + dm <= maxVal2) {
      const dotY = dy, dotM = dm;
      const dot = document.createElement('span');
      dot.className = 'cal-dot' + (dotY === dispY && dotM === dispM ? ' active' : '');
      dot.title = dotY + '年' + dotM + '月';
      dot.addEventListener('click', () => {
        if (dotY === calDisplayYear && dotM === calDisplayMonth) return;
        calDisplayYear = dotY;
        calDisplayMonth = dotM;
        _selectedShiftKey = null;
        const box = document.getElementById('shift-time-box');
        if (box) box.classList.remove('show');
        buildCalendar();
      });
      dotsEl.appendChild(dot);
      dm++;
      if (dm > 12) { dm = 1; dy++; }
    }
    dotsEl.style.display = dotsEl.children.length > 1 ? 'flex' : 'none';
  }

  const DOWS = ['月','火','水','木','金','土','日'];
  DOWS.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'cal-dow' + (i === 5 ? ' sat' : i === 6 ? ' sun' : '');
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(dispY, dispM - 1, 1);
  const dow      = firstDay.getDay();
  const offset   = dow === 0 ? 6 : dow - 1;
  const lastDate = new Date(dispY, dispM, 0).getDate();

  // フェーズ日付セット（限定PW：全フェーズ収集、通常PW：従来ロジック）
  const isLimitedPw2 = currentPwType !== 'normal';
  const applyTimes    = new Set(); // timestamp
  const deadlineTimes = new Set();
  const openTimes     = new Set();
  let isOpenPassedForCal = false;
  let applyStart = null, applyEnd = null; // 申込期間バー用

  if (isLimitedPw2 && APP_DATA && APP_DATA.phases) {
    const _phases2 = APP_DATA.phases;
    const _ai2 = APP_DATA.activePhaseIndex;
    _phases2.forEach(p => {
      if (p.apply)    applyTimes.add(new Date(p.apply.y, p.apply.m - 1, p.apply.d).getTime());
      if (p.deadline) deadlineTimes.add(new Date(p.deadline.y, p.deadline.m - 1, p.deadline.d).getTime());
      if (p.open)     openTimes.add(new Date(p.open.y, p.open.m - 1, p.open.d).getTime());
    });
    const activePhase2 = (typeof _ai2 === 'number' && _ai2 >= 0) ? _phases2[_ai2] : null;
    if (activePhase2 && activePhase2.open) {
      const opD2 = new Date(activePhase2.open.y, activePhase2.open.m - 1, activePhase2.open.d);
      isOpenPassedForCal = opD2.getTime() <= today.getTime();
    }
    const barPhase = activePhase2 || (_phases2.length > 0 ? _phases2[_phases2.length - 1] : null);
    if (barPhase) {
      applyStart = barPhase.apply    ? new Date(barPhase.apply.y, barPhase.apply.m - 1, barPhase.apply.d).getTime()       : null;
      applyEnd   = barPhase.deadline ? new Date(barPhase.deadline.y, barPhase.deadline.m - 1, barPhase.deadline.d).getTime() : null;
    }
  } else {
    const parseDate2 = str => {
      if (!str) return null;
      const p = str.split('/');
      return p.length === 2 ? new Date(dispY, parseInt(p[0]) - 1, parseInt(p[1])) : null;
    };
    const applyD    = parseDate2(ed['申込開始']);
    const deadlineD = parseDate2(ed['締切']);
    const openD     = parseDate2(ed['シフト公開']);
    if (applyD)    applyTimes.add(applyD.getTime());
    if (deadlineD) deadlineTimes.add(deadlineD.getTime());
    if (openD)     openTimes.add(openD.getTime());
    const _calOpenStr = ed['シフト公開'];
    const _calOpenP   = _calOpenStr ? _calOpenStr.split('/') : null;
    const _calOpenY   = YEAR || today.getFullYear();
    const _calOpenD   = (_calOpenP && _calOpenP.length === 2)
      ? new Date(_calOpenY, parseInt(_calOpenP[0]) - 1, parseInt(_calOpenP[1])) : null;
    isOpenPassedForCal = _calOpenD ? _calOpenD.getTime() <= today.getTime() : false;
    applyStart = applyD    ? applyD.getTime()    : null;
    applyEnd   = deadlineD ? deadlineD.getTime() : null;
  }

  // 限定PW：年考慮スロットセット
  let shiftDaysLtd, shiftDaysMapLtd;
  if (isLimitedPw2 && APP_DATA && APP_DATA.phases) {
    shiftDaysLtd    = new Set();
    shiftDaysMapLtd = {};
    APP_DATA.phases.forEach(p => {
      (p.slots || []).forEach(s => {
        const k = `${s.y}_${s.m}_${s.d}`;
        shiftDaysLtd.add(k);
        if (!shiftDaysMapLtd[k]) shiftDaysMapLtd[k] = [];
        if (s.time && !shiftDaysMapLtd[k].includes(s.time)) shiftDaysMapLtd[k].push(s.time);
      });
    });
  }

  // 統合カレンダー用：通常PW 実施日（表示月分）
  const normalShiftDaysInMonth = new Set();
  if (isLimitedMember) {
    (NORMAL_SHIFT_DATES || []).forEach(dateStr => {
      const p = dateStr.split('/');
      if (p.length === 2 && parseInt(p[0]) === dispM) normalShiftDaysInMonth.add(parseInt(p[0]) + '_' + parseInt(p[1]));
    });
  }

  // 実施日セット：SHIFT_DATES（カレンダーB10以降）を優先使用
  // SHIFT_DATESは'm/d'形式、表示月でフィルタして'm_d'キーのSetを作成
  const shiftDays = new Set();
  (SHIFT_DATES.length > 0 ? SHIFT_DATES : []).forEach(dateStr => {
    const p = dateStr.split('/');
    if (p.length === 2) {
      const m = parseInt(p[0]), day = parseInt(p[1]);
      if (m === dispM) shiftDays.add(m + '_' + day);
    }
  });
  // SHIFT_DATESが空の場合はSHIFT_DATA.datesからフォールバック
  if (shiftDays.size === 0) {
    (SHIFT_DATA && SHIFT_DATA.dates || []).forEach(d => {
      const p = d.date.split('/');
      if (p.length === 2) {
        const m = parseInt(p[0]), day = parseInt(p[1]);
        if (m === dispM) shiftDays.add(m + '_' + day);
      }
    });
  }
  console.log('[Calendar] dispM=' + dispM + ' SHIFT_DATES=', SHIFT_DATES, ' shiftDays=', [...shiftDays]);

  // 自分のシフト日セット（SHIFT_DATA.datesから、公開後のみ有効）
  const myShiftDays = new Set();
  if (isOpenPassedForCal) {
    (SHIFT_DATA && SHIFT_DATA.dates || []).forEach(d => {
      if (isMyCellInDate(d)) {
        const p = d.date.split('/');
        if (p.length === 2) {
          const m = parseInt(p[0]), day = parseInt(p[1]);
          if (m === dispM) myShiftDays.add(m + '_' + day);
        }
      }
    });
  }

  const total = Math.ceil((offset + lastDate) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const day = i - offset + 1;
    const el  = document.createElement('div');
    el.className = 'cal-day';
    if (day < 1 || day > lastDate) {
      el.classList.add('other');
      el.textContent = '';
    } else {
      const thisDate = new Date(dispY, dispM - 1, day);
      const thisT    = thisDate.getTime();
      const col = i % 7;
      if (col === 5) el.classList.add('sat');
      if (col === 6) el.classList.add('sun');

      const isToday    = thisT === today.getTime();
      const isApply    = applyTimes.has(thisT);
      const isDeadline = deadlineTimes.has(thisT);
      const isOpen     = openTimes.has(thisT);
      if (isApply)    el.classList.add('apply-day');
      if (isDeadline) el.classList.add('deadline');
      if (isOpen)     el.classList.add('open-day');

      // 日付表示：今日は真円span、それ以外はテキスト
      const dayLabel = document.createElement('span');
      if (isToday) {
        dayLabel.className = 'today-circle';
      }
      dayLabel.textContent = day;

      // 実施日かどうか（統合カレンダー or 単独）
      const keyNorm  = `${dispM}_${day}`;
      const keyLtd2  = `${dispY}_${dispM}_${day}`;
      let isShiftNorm, isShiftLtdHere;
      if (isLimitedMember) {
        // 統合カレンダー: 両タイプをチェック
        isShiftNorm    = normalShiftDaysInMonth.has(keyNorm);
        isShiftLtdHere = !!(shiftDaysLtd && shiftDaysLtd.has(keyLtd2));
      } else {
        const key2  = isLimitedPw2 ? keyLtd2 : keyNorm;
        isShiftNorm    = isLimitedPw2 ? false : shiftDays.has(keyNorm);
        isShiftLtdHere = isLimitedPw2 ? !!(shiftDaysLtd && shiftDaysLtd.has(key2)) : false;
      }
      const isShift = isShiftNorm || isShiftLtdHere;

      // サブラベル：実施日優先、次に申込/締切/公開予定
      const hasSub = isShift ? null  // 実施日はインジケーターで別途表示
                   : isApply    ? '申込'
                   : isDeadline ? '締切'
                   : isOpen     ? '公開予定'
                   : '';
      el.appendChild(dayLabel);
      if (hasSub) {
        const sub = document.createElement('span');
        sub.className   = 'cal-sub';
        sub.textContent = hasSub;
        el.appendChild(sub);
      }

      // 申込期間バー（申込開始〜締切の期間中）
      if (applyStart !== null && applyEnd !== null && thisT >= applyStart && thisT <= applyEnd) {
        const bar = document.createElement('div');
        bar.className = 'cal-period-bar apply-bar';
        if (thisT === applyStart && thisT === applyEnd) {
          // 1日だけの場合（バー全幅）
        } else if (thisT === applyStart) {
          bar.classList.add('bar-start');
        } else if (thisT === applyEnd) {
          bar.classList.add('bar-end');
        } else {
          bar.classList.add('bar-mid');
        }
        el.appendChild(bar);
      }

      // 実施日：表示
      if (isShift) {
        if (isLimitedMember) {
          // ===== 統合カレンダー表示 =====
          el.classList.add('shift-day-unified');
          const normTimes = NORMAL_SHIFT_DATES_MAP[keyNorm] || [];
          const ltdTimes  = (shiftDaysMapLtd && shiftDaysMapLtd[keyLtd2]) || [];

          if (isShiftNorm) {
            const row = document.createElement('div');
            row.className = 'cal-shift-row csr-normal';
            row.textContent = '🟢 PW' + (normTimes.length > 1 ? ' ' + normTimes.length + '件'
                                        : normTimes.length === 1 ? ' ' + normTimes[0] : '');
            el.appendChild(row);
          }
          if (isShiftLtdHere) {
            const row = document.createElement('div');
            row.className = 'cal-shift-row csr-limited';
            row.textContent = '🟣 限定' + (ltdTimes.length > 1 ? ' ' + ltdTimes.length + '件'
                                          : ltdTimes.length === 1 ? ' ' + ltdTimes[0] : '');
            el.appendChild(row);
          }

          // 自分のシフトバッジ
          if (myShiftDays.has(keyNorm)) {
            const badge = document.createElement('div');
            badge.className = 'cal-badge my-shift';
            el.appendChild(badge);
          }

          el.addEventListener('click', () => {
            toggleShiftTimeBoxUnified(keyNorm, keyLtd2, dispY, dispM, day, normTimes, ltdTimes);
          });
        } else {
          // ===== 既存の単独表示 =====
          el.classList.add('shift-day');
          const key = isLimitedPw2 ? keyLtd2 : keyNorm;
          const count = isLimitedPw2
            ? (shiftDaysMapLtd && shiftDaysMapLtd[key] ? shiftDaysMapLtd[key].length : 0)
            : (SHIFT_DATES_MAP[key] || []).length;
          if (count > 0) {
            const countEl = document.createElement('span');
            countEl.className   = 'cal-count';
            countEl.textContent = count + '件';
            el.appendChild(countEl);
          }

          if (myShiftDays.has(key)) {
            const badge = document.createElement('div');
            badge.className = 'cal-badge my-shift';
            el.appendChild(badge);
          }

          const _ltdTimes = isLimitedPw2 ? (shiftDaysMapLtd && shiftDaysMapLtd[key] || []) : null;
          el.addEventListener('click', () => toggleShiftTimeBox(key, dispY, dispM, day, _ltdTimes));
        }
      }
    }
    grid.appendChild(el);
  }

  // 凡例「自分のシフト」とカレンダー内「シフト表を見る」ボタンの表示制御
  const legendMyShift = document.getElementById('legend-my-shift');
  if (legendMyShift) legendMyShift.style.display = isOpenPassedForCal ? '' : 'none';
  const calShiftBtnArea = document.getElementById('cal-shift-btn-area');
  if (calShiftBtnArea) {
    calShiftBtnArea.style.display = (isOpenPassedForCal || _isPreviewMode) ? '' : 'none';
    const calShiftBtnTxt = document.getElementById('cal-shift-btn-txt');
    if (calShiftBtnTxt) {
      calShiftBtnTxt.textContent = currentPwType === 'normal' ? '通常PWのシフト表を見る' : '限定PWのシフト表を見る';
    }
  }
}

// ===== カレンダー実施日クリック：時間帯ボックス表示 =====
let _selectedShiftKey = null;

// 統合カレンダー用：通常PW・限定PW 両方の時間帯を表示
function toggleShiftTimeBoxUnified(keyNorm, keyLtd, y, m, d, normTimes, ltdTimes) {
  const box     = document.getElementById('shift-time-box');
  const boxDate = document.getElementById('shift-time-box-date');
  const boxList = document.getElementById('shift-time-box-list');

  const unifiedKey = 'unified_' + keyNorm;
  if (_selectedShiftKey === unifiedKey) {
    _selectedShiftKey = null;
    box.classList.remove('show');
    document.querySelectorAll('.cal-day.shift-day-unified.selected').forEach(el => el.classList.remove('selected'));
    return;
  }
  _selectedShiftKey = unifiedKey;
  document.querySelectorAll('.cal-day.shift-day-unified.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.cal-day.shift-day-unified').forEach(el => {
    const dayEl = el.querySelector('span');
    if (dayEl && parseInt(dayEl.textContent) === d) el.classList.add('selected');
  });

  const DAY_NAMES = ['日','月','火','水','木','金','土'];
  const dt = new Date(y, m - 1, d);
  boxDate.textContent = m + '月' + d + '日（' + DAY_NAMES[dt.getDay()] + '）の時間帯';
  boxList.innerHTML = '';

  const makeItems = (times, prefix, cls) => {
    if (times.length === 0) return;
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.75rem;font-weight:700;margin-top:4px;padding:2px 4px;border-radius:3px;';
    lbl.style.background = cls === 'normal' ? '#dcfce7' : '#ede9fe';
    lbl.style.color       = cls === 'normal' ? '#166534' : '#5b21b6';
    lbl.textContent = prefix;
    boxList.appendChild(lbl);
    times.forEach(t => {
      const item = document.createElement('div');
      item.className = 'shift-time-item';
      item.innerHTML = '🕐 ' + esc(t);
      boxList.appendChild(item);
    });
  };
  makeItems(normTimes, '🟢 通常PW', 'normal');
  makeItems(ltdTimes,  '🟣 限定PW', 'limited');
  if (normTimes.length === 0 && ltdTimes.length === 0) {
    boxList.innerHTML = '<div class="shift-time-item">時間帯情報がありません</div>';
  }
  box.classList.add('show');
}

function toggleShiftTimeBox(key, y, m, d, times_override) {
  const box      = document.getElementById('shift-time-box');
  const boxDate  = document.getElementById('shift-time-box-date');
  const boxList  = document.getElementById('shift-time-box-list');

  // 同じセルを再クリックで閉じる
  if (_selectedShiftKey === key) {
    _selectedShiftKey = null;
    box.classList.remove('show');
    // 選択状態を解除
    document.querySelectorAll('.cal-day.shift-day.selected').forEach(el => el.classList.remove('selected'));
    return;
  }

  _selectedShiftKey = key;

  // 選択状態の更新
  document.querySelectorAll('.cal-day.shift-day.selected').forEach(el => el.classList.remove('selected'));
  // クリックされたセルにselectedを付与（イベントのターゲット経由で探す）
  document.querySelectorAll('.cal-day.shift-day').forEach(el => {
    const dayEl = el.querySelector('span');
    if (dayEl && parseInt(dayEl.textContent) === d) el.classList.add('selected');
  });

  const DAY_NAMES = ['日','月','火','水','木','金','土'];
  const dt = new Date(y, m - 1, d);
  boxDate.textContent = m + '月' + d + '日（' + DAY_NAMES[dt.getDay()] + '）の時間帯';

  const times = times_override !== null && times_override !== undefined ? times_override : (SHIFT_DATES_MAP[key] || []);
  boxList.innerHTML = '';
  if (times.length === 0) {
    boxList.innerHTML = '<div class="shift-time-item">時間帯情報がありません</div>';
  } else {
    times.forEach(t => {
      const item = document.createElement('div');
      item.className   = 'shift-time-item';
      item.innerHTML   = '🕐 ' + esc(t);
      boxList.appendChild(item);
    });
  }
  box.classList.add('show');
}

function isMyCellInDate(dateObj) {
  if (!SESSION) return false;
  const name = SESSION.name;
  return (dateObj.slots || []).some(slot =>
    Object.values(slot.places || {}).some(people => (people || []).some(p => p && p.name === name))
  ) || (dateObj.responsible || []).includes(name)
    || (dateObj.cart && (
        (dateObj.cart.bring || []).some(c => c.name === name) ||
        (dateObj.cart.take  || []).some(c => c.name === name)
       ));
}

function isSameDayJS(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

// ===== 希望一覧ボックス構築 =====
// wishListViewUid: 一覧ボックスで現在選択中のUID（自分 or 代理対象者）
let wishListViewUid = '';

function buildWishListBox(status, isOpenPassed) {
  const card      = document.getElementById('wish-list-card');
  const title     = document.getElementById('wish-list-title');
  const body      = document.getElementById('wish-list-body');
  const proxyArea = document.getElementById('wish-list-proxy-area');
  const proxySel  = document.getElementById('wish-list-proxy-sel');
  if (!card || !body) return;

  const myUid  = SESSION ? SESSION.uid : '';
  const myName = SESSION ? SESSION.name : '';

  // 準備中は非表示
  if (status === '準備中') { card.style.display = 'none'; return; }

  // 確定シフト一覧はドロップダウン不要（自分のみ）
  const isConfirmedView = isOpenPassed && SHIFT_DATA && SHIFT_DATA.published;
  let viewUid, viewName;
  if (isConfirmedView) {
    proxyArea.style.display = 'none';
    viewUid  = myUid;
    viewName = myName;
  } else {
    // ── ドロップダウン構築（代理送信権限がある場合のみ） ──
    const _allProxyTargets2 = (SESSION && SESSION.proxyTargets) || [];
    const _staffList2 = (APP_DATA && APP_DATA.staffJSON) || [];
    const targets = currentPwType !== 'normal'
      ? _allProxyTargets2.filter(uid => _staffList2.some(s => s.uid === uid))
      : _allProxyTargets2;
    if (targets.length > 0) {
      if (!wishListViewUid) wishListViewUid = myUid;
      proxySel.innerHTML = '<option value="' + myUid + '">自分（' + esc(myName) + '）</option>';
      targets.forEach(uid => {
        const member = (APP_DATA && APP_DATA.staffJSON || []).find(s => s.uid === uid) || { name: uid, uid: uid };
        const opt = document.createElement('option');
        opt.value = uid;
        opt.textContent = member.name;
        if (uid === wishListViewUid) opt.selected = true;
        proxySel.appendChild(opt);
      });
      proxyArea.style.display = 'block';
    } else {
      wishListViewUid = myUid;
      proxyArea.style.display = 'none';
    }
    viewUid  = wishListViewUid || myUid;
    viewName = (viewUid === myUid)
      ? myName
      : (() => {
          const m = (APP_DATA && APP_DATA.staffJSON || []).find(s => s.uid === viewUid);
          return m ? m.name : viewUid;
        })();
  }

  // シフト公開済み：確定シフト一覧を表示（自分のみ）
  if (isConfirmedView) {
    const targetShifts = [];
    (SHIFT_DATA.dates || []).forEach(d => {
      const inSlot = name => {
        return (d.slots || []).some(slot =>
          Object.values(slot.places || {}).some(people => (people || []).some(p => p && p.name === name))
        ) ||
               (d.responsible || []).includes(name) ||
               (d.cart && (
                 (d.cart.bring || []).some(c => c.name === name) ||
                 (d.cart.take  || []).some(c => c.name === name)
               ));
      };
      if (!inSlot(viewName)) return;
      let role = '奉仕者';
      if ((d.responsible || []).includes(viewName)) role = '責任者';
      else if (d.cart && [...(d.cart.bring||[]), ...(d.cart.take||[])].some(c => c.name === viewName)) role = 'カート担当';
      targetShifts.push({ date: d.date, weekday: d.weekday, time: d.time, role, cancelled: d.cancelled, cancelReason: d.cancelReason, dateObj: d });
    });
    title.textContent = '✅ 確定シフト一覧';
    if (targetShifts.length === 0) {
      card.style.display = 'none';
      return;
    } else {
      body.innerHTML = targetShifts.map((s, i) => {
        if (s.cancelled) {
          return '<div class="confirmed-shift-item" data-idx="' + i + '">' +
            '<div class="csi-main">' +
            '<span style="font-weight:700;color:#9ca3af;text-decoration:line-through;">' + esc(s.date) + '（' + esc(s.weekday) + '）</span>' +
            ' <span style="color:#9ca3af;text-decoration:line-through;">' + esc(s.time) + '</span>' +
            ' <span style="font-size:12px;background:var(--danger);color:#fff;padding:2px 6px;border-radius:4px;margin-left:4px;">⛔ 中止</span>' +
            (s.cancelReason ? '<div style="font-size:12px;color:var(--danger-dark);margin-top:2px;">理由：' + esc(s.cancelReason) + '</div>' : '') +
            '</div>' +
            '<span class="csi-arrow">›</span>' +
            '</div>';
        }
        return '<div class="confirmed-shift-item" data-idx="' + i + '">' +
          '<div class="csi-main">' +
          '<span style="font-weight:700;color:var(--green);">' + esc(s.date) + '（' + esc(s.weekday) + '）</span>' +
          ' <span style="color:var(--sub);">' + esc(s.time) + '</span>' +
          ' <span style="font-size:12px;background:var(--green-light);color:var(--green-dark);padding:2px 6px;border-radius:4px;margin-left:4px;">' + esc(s.role) + '</span>' +
          '</div>' +
          '<span class="csi-arrow">›</span>' +
          '</div>';
      }).join('') +
        '<div style="margin-top:10px;font-size:12px;color:var(--sub);border-top:1px solid var(--border);padding-top:8px;">変更がある場合は、責任者に直接ご連絡ください。</div>';
      body.querySelectorAll('.confirmed-shift-item').forEach(el => {
        el.onclick = () => goToShiftDetail(targetShifts[parseInt(el.dataset.idx, 10)].dateObj);
      });
    }
    card.style.display = '';
    return;
  }

  // 受付中・受付終了：送信済み希望一覧を表示
  title.textContent = '📋 送信済みのシフト希望';
  const viewData = THIS_MONTH[viewUid];
  if (!viewData || Object.keys(viewData.checkedMap || {}).length === 0) {
    const isAfterDeadline = status === '受付終了' || (() => {
      const ed = APP_DATA ? (APP_DATA.eventDates || {}) : {};
      const deadlineStr = ed['締切'];
      if (!deadlineStr) return false;
      const p = deadlineStr.split('/');
      if (p.length !== 2) return false;
      const today = getSimulatedToday(); today.setHours(0,0,0,0);
      const deadlineDate = new Date(YEAR || today.getFullYear(), parseInt(p[0]) - 1, parseInt(p[1]));
      return today.getTime() >= deadlineDate.getTime();
    })();
    if (isAfterDeadline) { card.style.display = 'none'; return; }
    body.innerHTML = '<div style="font-size:14px;color:var(--sub);padding:6px 0;">まだ送信されていません</div>';
    card.style.display = '';
    return;
  }

  // 希望スロット一覧
  let items = [];
  if (SLOTS.length === 0) {
    items.push('<div style="font-size:14px;color:var(--sub);padding:6px 0;">（詳細はシフト希望フォームを開くと表示されます）</div>');
  } else {
    SLOTS.forEach(slot => {
      const gk      = slot.week + ' ' + slot.dateLabel;
      const checked = viewData.checkedMap[gk] && viewData.checkedMap[gk].includes(slot.time);
      if (!checked) return;
      const cartNg = viewData.cartNgMap[gk] && viewData.cartNgMap[gk].includes(slot.time);
      const note   = viewData.noteMap ? (viewData.noteMap[gk + ' ' + slot.time] || '') : '';
      let badges = '';
      if (cartNg) badges += '<span style="font-size:11px;background:#fee2e2;color:var(--danger);padding:2px 5px;border-radius:4px;margin-left:4px;">カート不可</span>';
      if (note)   badges += '<div style="font-size:12px;color:var(--sub);margin-top:2px;padding-left:4px;">備考: ' + esc(note) + '</div>';
      items.push(
        '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:14px;">' +
        '<span style="font-weight:700;color:var(--green);">' + esc(slot.dateLabel) + '</span>' +
        ' <span style="color:var(--sub);">' + esc(slot.time) + '</span>' +
        badges + '</div>'
      );
    });
  }

  // タイムスタンプ（右下）＋編集ボタン
  const ts = viewData.timestamp || '';
  const tsHtml = ts
    ? '<div style="font-size:12px;color:var(--sub);text-align:right;margin-top:8px;">最終送信：' + esc(ts) + '</div>'
    : '';

  let editBtn = '';
  if (status === '受付中') {
    // 編集ボタン押下時は wishListViewUid の人のフォームを開く
    editBtn = '<button data-uid="' + esc(viewUid) + '" onclick="openFormForUid(this.dataset.uid)" style="margin-top:12px;width:100%;padding:11px;background:var(--green);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">✏️ シフト希望を編集する</button>';
  }

  body.innerHTML =
    (items.length ? items.join('') : '<div style="font-size:14px;color:var(--sub);padding:6px 0;">希望スロットがありません</div>') +
    tsHtml + editBtn;
  card.style.display = '';
}

// 希望一覧のドロップダウン変更時
function onWishListProxyChange() {
  const sel = document.getElementById('wish-list-proxy-sel');
  wishListViewUid = sel.value || (SESSION ? SESSION.uid : '');
  // body部分のみ再描画（ドロップダウン自体は再構築不要）
  _renderWishListBody();
}

// body部分のみ再描画（ドロップダウン変更・送信後の即時更新に使用）
function _renderWishListBody() {
  const card  = document.getElementById('wish-list-card');
  const body  = document.getElementById('wish-list-body');
  if (!card || !body) return;
  const status      = APP_DATA ? (APP_DATA.status || '準備中') : '準備中';
  const today       = getSimulatedToday(); today.setHours(0,0,0,0);
  const ed          = APP_DATA ? (APP_DATA.eventDates || {}) : {};
  const openStr     = ed['シフト公開'];
  let isOpenPassed  = false;
  if (openStr) {
    const p = openStr.split('/');
    if (p.length === 2) {
      const openD = new Date(YEAR || today.getFullYear(), parseInt(p[0]) - 1, parseInt(p[1]));
      isOpenPassed = openD.getTime() <= today.getTime();
    }
  }
  // buildWishListBoxを再呼び出し（ドロップダウンは再構築せずbodyのみ更新される）
  buildWishListBox(status, isOpenPassed);
}

// 指定UIDのフォームを開く（希望一覧の編集ボタン用）
function openFormForUid(uid) {
  showScreen('form');
  // フォーム画面が表示されてからドロップダウンを切り替える
  setTimeout(() => {
    const sel = document.getElementById('sel-proxy');
    if (!sel) return;
    // uidが自分なら空文字（自分選択）、代理対象者ならそのUID
    const myUid = SESSION ? SESSION.uid : '';
    sel.value = (uid === myUid) ? '' : uid;
    onProxyChange();
  }, 50);
}

// 指定日付のシフト詳細画面を開く（次のシフト・確定シフト一覧のクリック用）
// 一覧を経由せず直接詳細を開き、履歴には詳細エントリ1つだけを積む
// （戻るボタン・スワイプで一覧を経由せずメイン画面へ直接戻れるようにするため）
function goToShiftDetail(dateObj) {
  if (!dateObj || !SHIFT_DATA) return;
  // 中止シフトで一般ユーザー（管理者・責任者以外）はポップアップのみ表示し、画面はメインのまま
  if (dateObj.cancelled && SESSION) {
    const isAssignedResp = (dateObj.responsible || []).includes(SESSION.name);
    if (!SESSION.isAdmin && !SESSION.isResponsible && !isAssignedResp) {
      showCancelInfoPopup(dateObj.cancelReason);
      return;
    }
  }
  SCREENS.forEach(s => {
    const el = document.getElementById('screen-' + s);
    if (s === 'shift') {
      el.style.display = SCREEN_DISPLAY[s] || 'block';
      el.classList.remove('screen-enter-forward', 'screen-enter-back');
      void el.offsetWidth;
      el.classList.add('screen-enter-forward');
    } else {
      el.style.display = 'none';
      el.classList.remove('screen-enter-forward', 'screen-enter-back');
    }
  });
  _currentScreenName = 'shift';
  initShiftScreen();
  showShiftDetail(dateObj, true);
}

function buildNextShift(isOpenPassed) {
  if (!SHIFT_DATA || !SHIFT_DATA.dates || !SESSION) return;
  if (!isOpenPassed) return; // 公開予定日前は表示しない
  const status = APP_DATA ? (APP_DATA.status || '準備中') : '準備中';
  if (status === '受付中' || status === '準備中') return; // 受付中・準備中は表示しない
  const today = getSimulatedToday(); today.setHours(0,0,0,0);
  const name  = SESSION.name;
  const next  = SHIFT_DATA.dates.find(d => {
    const p = d.date.split('/');
    if (p.length !== 2) return false;
    const dt = new Date(YEAR, parseInt(p[0]) - 1, parseInt(p[1]));
    if (dt < today) return false;
    return isMyCellInDate(d);
  });
  if (!next) return;
  const card = document.getElementById('next-shift-card');
  card.style.display = '';
  card.onclick = () => goToShiftDetail(next);
  if (next.cancelled) {
    card.classList.add('cancelled');
    const cancelEl = document.getElementById('next-shift-cancel');
    cancelEl.style.display = '';
    cancelEl.textContent = '⛔ 中止' + (next.cancelReason ? '：' + next.cancelReason : '');
  } else {
    card.classList.remove('cancelled');
    document.getElementById('next-shift-cancel').style.display = 'none';
  }
  document.getElementById('next-shift-date').textContent = next.date + '（' + next.weekday + '） ' + next.time;
  // 役割判定
  let role = '奉仕者';
  if ((next.responsible || []).includes(name)) role = '責任者';
  else if ((next.cart && [...(next.cart.bring||[]), ...(next.cart.take||[])]).some(c => c.name === name)) role = 'カート担当';
  document.getElementById('next-shift-role').textContent = '役割: ' + role;
}

// ===== フォーム画面 =====
function initFormScreen() {
  currentFormName = SESSION.name;
  currentFormUid  = SESSION.uid;
  isCartUser      = SESSION.isCart;
  lastMonthOn     = false;
  document.getElementById('toggle-track').classList.remove('on');
  document.title = '宇多津会衆PWアプリ';

  // 代理送信
  const proxyArea = document.getElementById('proxy-area');
  const proxySel  = document.getElementById('sel-proxy');
  const _allProxyTargets = SESSION.proxyTargets || [];
  const _staffList = APP_DATA.staffJSON || [];
  const targets = currentPwType !== 'normal'
    ? _allProxyTargets.filter(uid => _staffList.some(s => s.uid === uid))
    : _allProxyTargets;
  if (targets.length > 0) {
    proxySel.innerHTML = '<option value="">自分（' + SESSION.name + '）</option>';
    // メンバー名を取得するためにAPP_DATAを使用
    targets.forEach(uid => {
      const member = (APP_DATA.staffJSON || []).find(s => s.uid === uid) || { name: uid, uid: uid };
      const opt = document.createElement('option');
      opt.value = uid; opt.textContent = member.name + ' の代わりに送信';
      opt.dataset.name = member.name;
      proxySel.appendChild(opt);
    });
    proxyArea.style.display = 'block';
  } else {
    proxyArea.style.display = 'none';
  }

  initFormState(currentFormUid);
  renderSlots(currentFormUid);

  const hasLast = LAST_MONTH[currentFormUid] &&
                Object.keys(LAST_MONTH[currentFormUid]).length > 0 &&
                !THIS_MONTH[currentFormUid];
  document.getElementById('last-month-card').style.display = hasLast ? 'block' : 'none';

  // オーナーは送信ボタンをグレーアウト・無効化（読み取り専用）
  const isOwnerForm = SESSION && SESSION.isAdmin && !SESSION.uid;
  const btnSubmit = document.getElementById('btn-submit');
  if (btnSubmit) {
    if (isOwnerForm) {
      btnSubmit.disabled = true;
      btnSubmit.style.opacity = '0.4';
      btnSubmit.textContent = '送信不可（閲覧専用）';
    } else {
      btnSubmit.disabled = false;
      btnSubmit.style.opacity = '';
      btnSubmit.textContent = '送信する';
    }
  }
}

function onProxyChange() {
  const sel = document.getElementById('sel-proxy');
  if (sel.value) {
    currentFormUid  = sel.value;
    currentFormName = sel.options[sel.selectedIndex].dataset.name || sel.value;
  } else {
    currentFormUid  = SESSION.uid;
    currentFormName = SESSION.name;
  }
  lastMonthOn = false;
  document.getElementById('toggle-track').classList.remove('on');
  initFormState(currentFormUid);
  renderSlots(currentFormUid);
  const hasLast = LAST_MONTH[currentFormUid] &&
                Object.keys(LAST_MONTH[currentFormUid]).length > 0 &&
                !THIS_MONTH[currentFormUid];
  document.getElementById('last-month-card').style.display = hasLast ? 'block' : 'none';
}

function initFormState(uid) {
  formState.checkedMap = {}; formState.cartNgMap = {}; formState.noteMap = {};
  if (THIS_MONTH[uid]) {
    const d = THIS_MONTH[uid];
    Object.entries(d.checkedMap || {}).forEach(([k, arr]) => { formState.checkedMap[k] = new Set(arr); });
    Object.entries(d.cartNgMap  || {}).forEach(([k, arr]) => { formState.cartNgMap[k]  = new Set(arr); });
    Object.entries(d.noteMap    || {}).forEach(([k, v])   => { formState.noteMap[k] = v; });
    return;
  }
  // 先月データは「先月と同じ」ボタンON時のみ適用するため、ここでは何もしない
}

function groupSlots(slots) {
  const g = [], seen = {};
  slots.forEach(s => {
    const k = s.week + '_' + s.dateLabel;
    if (!seen[k]) { seen[k] = { week: s.week, dateLabel: s.dateLabel, times: [] }; g.push(seen[k]); }
    seen[k].times.push(s.time);
  });
  return g;
}

function renderSlots(uid) {
  const container = document.getElementById('slots-container');
  const grouped   = groupSlots(SLOTS);
  if (grouped.length === 0) { container.innerHTML = '<p class="empty-note">スロットがありません</p>'; return; }
  container.innerHTML = '';
  grouped.forEach(g => {
    const groupKey = g.week + ' ' + g.dateLabel;
    const div = document.createElement('div');
    div.className = 'date-group';
    div.innerHTML = '<div class="date-label"><span class="week-badge">' + g.week + '</span>' + g.dateLabel + '</div>';
    g.times.forEach(time => {
      const slotKey       = groupKey + ' ' + time;
      const isChecked     = !!(formState.checkedMap[groupKey] && formState.checkedMap[groupKey].has(time));
      const isLast        = !!(LAST_MONTH[uid] && LAST_MONTH[uid][slotKey]);
      const cartNgChecked = !!(formState.cartNgMap[groupKey] && formState.cartNgMap[groupKey].has(time));
      const noteVal       = formState.noteMap[slotKey] || '';
      const row = document.createElement('div');
      row.className = 'slot-row' + (isChecked ? ' checked' : '');
      row.dataset.group = groupKey; row.dataset.time = time;
      const badge = isLast ? '<span class="last-badge">先月も参加</span>' : '';
      row.innerHTML =
        '<div class="slot-main" onclick="toggleSlot(this)">'
        + '<div class="slot-checkbox"></div>'
        + '<div class="slot-time">' + time + '</div>'
        + badge + '</div>'
        + '<div class="slot-extra">'
        + '<div class="cart-row' + (isCartUser ? ' visible' : '') + '" onclick="toggleCart(this)">'
        + '<div class="cart-check' + (cartNgChecked ? ' on' : '') + '"></div>'
        + '<span class="cart-label">この時間はカート担当不可</span></div>'
        + '<div class="note-area"><label>備考（途中参加・早退など）</label>'
        + '<textarea placeholder="例: 10:00から / 14:00まで" oninput="saveNote(this)">' + noteVal + '</textarea></div>'
        + '</div>';
      div.appendChild(row);
    });
    container.appendChild(div);
  });
}

function toggleSlot(el) {
  const row = el.closest('.slot-row'), gk = row.dataset.group, time = row.dataset.time;
  if (row.classList.contains('checked')) {
    row.classList.remove('checked');
    if (formState.checkedMap[gk]) formState.checkedMap[gk].delete(time);
    if (formState.cartNgMap[gk])  formState.cartNgMap[gk].delete(time);
    delete formState.noteMap[gk + ' ' + time];
  } else {
    row.classList.add('checked');
    if (!formState.checkedMap[gk]) formState.checkedMap[gk] = new Set();
    formState.checkedMap[gk].add(time);
  }
}
function toggleCart(el) {
  const row = el.closest('.slot-row'), gk = row.dataset.group, time = row.dataset.time;
  const ch  = el.querySelector('.cart-check');
  if (ch.classList.contains('on')) { ch.classList.remove('on'); if (formState.cartNgMap[gk]) formState.cartNgMap[gk].delete(time); }
  else { ch.classList.add('on'); if (!formState.cartNgMap[gk]) formState.cartNgMap[gk] = new Set(); formState.cartNgMap[gk].add(time); }
}
function saveNote(el) {
  const row = el.closest('.slot-row');
  formState.noteMap[row.dataset.group + ' ' + row.dataset.time] = el.value.trim();
}
function toggleLastMonth() {
  lastMonthOn = !lastMonthOn;
  const track = document.getElementById('toggle-track');
  if (lastMonthOn) {
    track.classList.add('on');
    if (LAST_MONTH[currentFormUid]) {
      SLOTS.forEach(slot => {
        const sk    = slot.week + ' ' + slot.dateLabel + ' ' + slot.time;
        const entry = LAST_MONTH[currentFormUid][sk];
        if (entry && entry.checked) {
          const gk = slot.week + ' ' + slot.dateLabel;
          if (!formState.checkedMap[gk]) formState.checkedMap[gk] = new Set();
          formState.checkedMap[gk].add(slot.time);
          const comment = entry.comment || '';
          if (comment.includes('カート不可')) {
            if (!formState.cartNgMap[gk]) formState.cartNgMap[gk] = new Set();
            formState.cartNgMap[gk].add(slot.time);
          }
          const noteContent = comment.replace('カート不可', '').trim();
          if (noteContent) formState.noteMap[sk] = noteContent;
        }
      });
    }
  } else {
    track.classList.remove('on');
    formState.checkedMap = {}; formState.cartNgMap = {}; formState.noteMap = {};
  }
  renderSlots(currentFormUid);
}

async function submitForm() {
  if (_isPreviewMode) { alert('閲覧モード中は送信できません。'); return; }
  if (SESSION && SESSION.isAdmin && !SESSION.uid) { alert('オーナーアカウントでは送信できません。'); return; }

  // 重複申込チェック（限定PWメンバーのみ）
  if (isLimitedMember) {
    const otherData = currentPwType === 'normal' ? LIMITED_APP_DATA : APP_DATA;
    const otherMonthKey = currentPwType === 'normal' ? 'limitedThisMonth' : 'thisMonthData';
    const otherApply = (otherData && (otherData.thisMonthData || otherData[otherMonthKey])) || {};
    const myDates = new Set();
    Object.keys(formState.checkedMap).forEach(k => {
      // k = "週 日付" 形式（例："第2週 6/14(日)"）→ 日付部分を抽出
      const m = k.match(/(\d+\/\d+)/);
      if (m) myDates.add(m[1]);
    });
    const conflicts = [];
    const otherUidData = otherApply[currentFormUid] || {};
    const otherDates = new Set();
    Object.keys(otherUidData.checkedMap || {}).forEach(k => {
      const m = k.match(/(\d+\/\d+)/);
      if (m) otherDates.add(m[1]);
    });
    myDates.forEach(d => { if (otherDates.has(d)) conflicts.push(d); });
    if (conflicts.length > 0) {
      const otherLabel = currentPwType === 'normal' ? '限定PW' : '通常PW';
      const msg = conflicts.join(', ') + ' は' + otherLabel + 'にも申込があります。\n両方に申し込んでもかまいませんが、シフトに入れるのはどちらか一方になります。\nこのまま送信しますか？';
      if (!confirm(msg)) return;
    }
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  showLoading('送信中...');
  const cm = {}, ng = {};
  Object.entries(formState.checkedMap).forEach(([k, s]) => { cm[k] = [...s]; });
  Object.entries(formState.cartNgMap).forEach(([k, s])  => { ng[k] = [...s]; });
  const payload = {
    uid:  currentFormUid,
    name: currentFormName,
    checkedMap: cm, cartNgMap: ng, noteMap: Object.assign({}, formState.noteMap),
    proxyFromUid: (currentFormUid !== SESSION.uid) ? SESSION.uid : ''
  };
  try {
    const result = await apiGet('submitShift', payload);
    if (result && result.ok === false) throw new Error(result.error || '送信失敗');

    // THIS_MONTHをローカルで即時更新（メイン画面のボタン・希望一覧に反映するため）
    const now = new Date();
    const tsStr = (now.getMonth()+1) + '月' + now.getDate() + '日 ' +
                  String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    THIS_MONTH[currentFormUid] = {
      checkedMap: cm,
      cartNgMap:  ng,
      noteMap:    Object.assign({}, formState.noteMap),
      timestamp:  tsStr
    };
    // 希望一覧の表示対象を送信した人に合わせてリセット
    wishListViewUid = currentFormUid;

    await hideLoading();
    const msg = document.getElementById('form-msg');
    msg.className = 'msg success';
    msg.textContent = '✅ 送信が完了しました！';
    setTimeout(() => {
      buildMainScreen();
      history.back(); // フォーム送信後、main エントリへ戻る
    }, 1500);
  } catch (e) {
    await hideLoading();
    const msg = document.getElementById('form-msg');
    msg.className = 'msg error';
    msg.textContent = '⚠️ 通信エラーが発生しました。もう一度お試しください。';
    btn.disabled = false; btn.textContent = '送信する';
  }
}

// ===== シフト表画面 =====
function initShiftScreen() {
  document.getElementById('shift-date-list').style.display   = '';
  document.getElementById('shift-detail-view').style.display = 'none';
  document.getElementById('shift-back-btn').onclick = () => history.back();
  shiftViewingDate = null;
  buildShiftDateList();
}

function buildShiftDateList() {
  const container = document.getElementById('shift-dates-container');
  container.innerHTML = '';
  if (!SHIFT_DATA || !SHIFT_DATA.published) {
    container.innerHTML = '<div class="card" style="text-align:center;color:var(--sub);padding:30px;">シフト表はまだ公開されていません</div>';
    return;
  }
  (SHIFT_DATA.dates || []).forEach(d => {
    const btn = document.createElement('div');
    btn.className = 'shift-date-btn' + (d.cancelled ? ' cancelled' : '');
    const hasMyShift = isMyCellInDate(d);

    // 責任者・カート担当の要約（カード用）
    const respNames = (d.responsible || []).filter(n => n);
    const cartAll = d.cart ? [...(d.cart.bring || []), ...(d.cart.take || [])].filter(c => c.name) : [];
    let subHtml = '';
    if (respNames.length > 0) {
      subHtml += '<div>責任者：<b>' + respNames.map(esc).join('、') + '</b></div>';
    }
    if (cartAll.length > 0 && d.cart) {
      const bringStr = (d.cart.bring || []).filter(c => c.name)
        .map(c => esc(c.name) + (c.cartNo ? '(' + esc(c.cartNo) + ')' : '')).join('、');
      const takeStr = (d.cart.take || []).filter(c => c.name)
        .map(c => esc(c.name) + (c.cartNo ? '(' + esc(c.cartNo) + ')' : '')).join('、');
      subHtml += '<div>カート：' +
        (bringStr ? '持込 <b>' + bringStr + '</b>' : '') +
        (bringStr && takeStr ? '　' : '') +
        (takeStr ? '持帰 <b>' + takeStr + '</b>' : '') +
        '</div>';
    }

    btn.innerHTML =
      '<div class="sdb-main">' +
        '<div class="sdb-date"><span class="sdb-date-text">' + esc(d.date) + '（' + esc(d.weekday) + '）</span><span class="sdb-time">　' + esc(d.time) + '</span></div>' +
        (d.cancelled
          ? '<div class="sdb-cancel-reason">⛔ 中止' + (d.cancelReason ? '：' + esc(d.cancelReason) : '') + '</div>'
          : (subHtml ? '<div class="sdb-sub">' + subHtml + '</div>' : '')) +
      '</div>' +
      (d.cancelled ? '<span class="sdb-badge cancelled">中止</span>'
          : hasMyShift ? '<span class="sdb-badge">参加</span>' : '');
    btn.onclick = () => showShiftDetail(d);
    container.appendChild(btn);
  });
}

function showCancelInfoPopup(reason) {
  const reasonEl = document.getElementById('cancel-info-reason');
  if (reason) {
    reasonEl.textContent = '理由：' + reason;
    reasonEl.style.display = '';
  } else {
    reasonEl.style.display = 'none';
  }
  document.getElementById('cancel-info-overlay').classList.add('show');
}
function closeCancelInfoPopup() {
  document.getElementById('cancel-info-overlay').classList.remove('show');
}

function showShiftDetail(dateObj, quickJump) {
  // 中止シフトで一般ユーザー（管理者・責任者以外）はポップアップのみ表示
  if (dateObj.cancelled && SESSION) {
    const isAssignedResp = (dateObj.responsible || []).includes(SESSION.name);
    if (!SESSION.isAdmin && !SESSION.isResponsible && !isAssignedResp) {
      showCancelInfoPopup(dateObj.cancelReason);
      return;
    }
  }
  shiftViewingDate = dateObj;
  staffEditMode = false;
  _modalInHistory = null;
  const listEl   = document.getElementById('shift-date-list');
  const detailEl = document.getElementById('shift-detail-view');
  listEl.style.display   = 'none';
  detailEl.style.display = 'block';
  // 詳細へ進むアニメーション
  detailEl.classList.remove('screen-enter-forward', 'screen-enter-back');
  void detailEl.offsetWidth;
  detailEl.classList.add('screen-enter-forward');
  if (quickJump) {
    // メイン画面から直接開いた場合：戻るとメイン画面へ（一覧を経由しない）
    document.getElementById('shift-back-btn').onclick = () => history.back();
    history.pushState({ screen: 'shift', subScreen: 'detail', quickJump: true }, '');
  } else {
    document.getElementById('shift-back-btn').onclick = () => _shiftDetailBack();
    // 詳細ページを履歴に積む（戻るボタンで一覧に戻れるよう）
    history.pushState({ screen: 'shift', subScreen: 'detail' }, '');
  }
  buildShiftDetail(dateObj);
}

function _shiftDetailBack() {
  staffEditMode = false;
  _modalInHistory = null;
  const listEl   = document.getElementById('shift-date-list');
  const detailEl = document.getElementById('shift-detail-view');
  detailEl.style.display = 'none';
  detailEl.classList.remove('screen-enter-forward', 'screen-enter-back');
  listEl.style.display = '';
  // 一覧に戻るアニメーション
  listEl.classList.remove('screen-enter-forward', 'screen-enter-back');
  void listEl.offsetWidth;
  listEl.classList.add('screen-enter-back');
  document.getElementById('shift-back-btn').onclick = () => history.back();
}

function buildShiftDetail(d) {
  const container = document.getElementById('shift-detail-container');
  const myName    = SESSION ? SESSION.name : '';
  const PC = ['#e0f2fe','#fef9c3','#fce7f3','#dcfce7','#ede9fe']; // 場所列のヘッダー色
  let html = '';

  html += '<div class="shift-block">';
  html += '<div class="shift-block-hdr">';
  html += '<span>' + esc(d.date) + '（' + esc(d.weekday) + '） ' + esc(d.time) + '</span>';

  const isAssignedResp = SESSION && (d.responsible || []).includes(myName);
  const canCancel      = SESSION && (SESSION.isAdmin || isAssignedResp);
  const canEditMemo    = SESSION && (SESSION.isAdmin || SESSION.isResponsible);
  const canEditStaff   = SESSION && (SESSION.isAdmin || isAssignedResp);

  if (canCancel || canEditMemo || canEditStaff) {
    html += '<div class="edit-actions">';
    if (canCancel) {
      if (d.cancelled) {
        html += '<button class="btn-small btn-cancel-undo" onclick="openCancelUndo()">中止取り消し</button>';
      } else {
        html += '<button class="btn-small btn-cancel-input" onclick="openCancelInput()">中止入力</button>';
      }
    }
    if (canEditMemo) html += '<button class="btn-small btn-memo-edit" onclick="openMemoEdit()">メモ編集</button>';
    if (canEditStaff && !staffEditMode) {
      html += '<button class="btn-edit-staff-mode" onclick="enterStaffEditMode()">奉仕者を編集</button>';
    }
    html += '</div>';
  }
  html += '</div>';

  if (d.cancelled) {
    html += '<div class="cancel-banner">⛔ 中止' + (d.cancelReason ? '：' + esc(d.cancelReason) : '') + '</div>';
  }

  if (d.memo) {
    html += '<div class="memo-box"><label>📝 責任者メモ</label>' + esc(d.memo) + '</div>';
  }

  if (d.responsible && d.responsible.length > 0) {
    html += '<div class="resp-row"><span class="resp-label">責任者：</span>';
    d.responsible.forEach(name => {
      html += '<span style="font-weight:700;">' + esc(name) + '</span>&nbsp;';
    });
    html += '</div>';
  }

  if (d.cart) {
    const allCart = [...(d.cart.bring || []), ...(d.cart.take || [])].filter(c => c.name);
    if (allCart.length > 0) {
      html += '<div class="cart-info-row"><span class="cart-label-s">カート：</span>';
      (d.cart.bring || []).filter(c => c.name).forEach(c => {
        html += '<span>持込: <b>' + esc(c.name) + '</b>' + (c.cartNo ? '(' + esc(c.cartNo) + ')' : '') + '</span>&nbsp;';
      });
      (d.cart.take || []).filter(c => c.name).forEach(c => {
        html += '<span>持帰: <b>' + esc(c.name) + '</b>' + (c.cartNo ? '(' + esc(c.cartNo) + ')' : '') + '</span>&nbsp;';
      });
      html += '</div>';
    }
    html += '<button onclick="openExhibitPhotoFromShift()" style="margin:4px 0 8px;padding:8px 16px;background:var(--purple);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">🖼 展示内容写真を見る</button>';
  }

  if (d.slots && d.slots.length > 0) {
    const placeCart    = d.placeCart || {};
    const allPlaceNames = Object.keys(d.slots[0].places || {});
    // 編集モードは全場所を表示、表示モードは奉仕者がいる場所のみ
    const placeNames = staffEditMode
      ? allPlaceNames
      : allPlaceNames.filter(loc =>
          d.slots.some(slot => slot.places && slot.places[loc] && slot.places[loc].length > 0)
        );

    if (placeNames.length > 0) {
      html += '<div class="area-section" style="overflow-x:auto;">';
      html += '<table class="shift-tbl-v2"><thead>';

      // 場所名ヘッダー行（場所ごとに色分け）
      html += '<tr><th class="stv2-hdr-time">時間</th>';
      placeNames.forEach((loc, i) => {
        html += '<th class="stv2-hdr-place" style="background:' + PC[i % PC.length] + ';">' + esc(loc) + '</th>';
      });
      html += '</tr>';

      // カート番号行
      const hasPlaceCart = placeNames.some(loc => placeCart[loc]);
      if (hasPlaceCart) {
        html += '<tr class="stv2-cart-row"><td>カート番号</td>';
        placeNames.forEach(loc => {
          html += '<td>' + (placeCart[loc] ? esc(placeCart[loc]) : '—') + '</td>';
        });
        html += '</tr>';
      }
      html += '</thead><tbody>';

      d.slots.forEach((slot, ri) => {
        html += '<tr><td class="stv2-time-cell">' + esc(slot.time) + '</td>';
        placeNames.forEach((loc, li) => {
          const bg     = PC[li % PC.length];
          const people = (slot.places && slot.places[loc]) ? slot.places[loc] : [];
          html += '<td class="stv2-place-cell" style="background:' + bg + '20;">';
          if (staffEditMode) {
            // 編集モード：ドロップダウン3つ（最大3名）
            for (let pi = 0; pi < 3; pi++) {
              const person = people[pi];
              const curUid = person ? (person.uid || nameToUid(person.name)) : '';
              html += '<select class="staff-edit-sel" id="staff-sel-' + ri + '-' + li + '-' + pi + '">';
              html += '<option value="">—</option>';
              (APP_DATA && APP_DATA.staffJSON || []).forEach(m => {
                const sel = (m.uid && m.uid === curUid) ? ' selected' : '';
                html += '<option value="' + esc(m.uid) + '"' + sel + '>' + esc(m.name) + '</option>';
              });
              html += '</select>';
            }
          } else {
            html += buildStaffCellHtmlV2(people, myName, d);
          }
          html += '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';

      if (staffEditMode) {
        html += '<div class="edit-mode-actions">';
        html += '<button class="btn-cancel-shift-edit" onclick="exitStaffEditMode()">キャンセル</button>';
        html += '<button class="btn-save-shift" id="btn-save-staff" onclick="saveStaffEdits()">保存する</button>';
        html += '</div>';
      }
    }
  }

  html += '</div>';
  container.innerHTML = html;
}

// 1セル分（1場所×1スロット）の奉仕者一覧HTMLを構築（旧テーブル用・互換維持）
function buildStaffCellHtml(people, myName, d) {
  if (!people || people.length === 0) return '';
  return people.map(p => {
    const cellClass = getCellClass(p, myName, d);
    return '<div class="staff-line' + (cellClass ? ' ' + cellClass : '') + '">' + formatName(p) + '</div>';
  }).join('');
}

// 改良版テーブル用（.stv2-staff-name クラスを使用）
function buildStaffCellHtmlV2(people, myName, d) {
  if (!people || people.length === 0) return '';
  return people.map(p => {
    const cellClass = getCellClass(p, myName, d);
    return '<span class="stv2-staff-name' + (cellClass ? ' ' + cellClass : '') + '">' + formatName(p) + '</span>';
  }).join('');
}

function getCellClass(p, myName, d) {
  if (!p || !p.name || p.name !== myName) return '';
  const isResp = (d.responsible || []).includes(myName);
  const isCart = d.cart && ([...(d.cart.bring||[]),...(d.cart.take||[])]).some(c => c.name === myName);
  if (isResp && isCart) return 'my-cell-both';
  if (isResp) return 'my-cell-resp';
  if (isCart) return 'my-cell-cart';
  return 'my-cell-staff';
}
function formatName(p) {
  if (!p || !p.name) return '';
  return esc(p.name) + (p.watch ? '<span class="watch-mark">（見守り）</span>' : '');
}

// シフトデータのみ再取得して現在の詳細ビューをその場で再描画
async function _refreshShiftAndRedraw() {
  showLoading('シフト表を更新中...');
  try {
    const shiftData = await apiGet('getShiftTable');
    SHIFT_DATA = shiftData;
    buildShiftDateList();
    if (shiftViewingDate) {
      const updated = (SHIFT_DATA.dates || []).find(
        d => d.date === shiftViewingDate.date && d.time === shiftViewingDate.time
      );
      if (updated) {
        shiftViewingDate = updated;
        buildShiftDetail(updated);
      }
    }
    // メイン画面の確定シフト一覧・次のシフトカードも最新化
    _renderWishListBody();
    const _today = getSimulatedToday(); _today.setHours(0,0,0,0);
    const _openStr = APP_DATA ? ((APP_DATA.eventDates || {})['シフト公開'] || '') : '';
    let _isOpenPassed = false;
    if (_openStr) {
      const _p = _openStr.split('/');
      if (_p.length === 2) {
        const _openD = new Date(YEAR || _today.getFullYear(), parseInt(_p[0]) - 1, parseInt(_p[1]));
        _isOpenPassed = _openD.getTime() <= _today.getTime();
      }
    }
    buildNextShift(_isOpenPassed);
    await hideLoading();
  } catch (e) {
    await hideLoading();
    alert('シフト表の更新に失敗しました: ' + e.message);
  }
}

// 中止入力
let cancelTimer = null;
function openCancelInput() {
  if (_isPreviewMode) { alert('閲覧モード中は操作できません。'); return; }
  if (!shiftViewingDate) return;
  const date = shiftViewingDate.date, time = shiftViewingDate.time;
  const reason = prompt('中止理由を入力してください（空白でも可）:', '');
  if (reason === null) return; // キャンセル
  showLoading('中止情報を登録中...');
  apiGet('cancelShift', { date, time, reason, uid: SESSION.uid }).then(async data => {
    if (data.ok) { await _refreshShiftAndRedraw(); }
    else { hideLoading(); alert('エラー: ' + data.error); }
  }).catch(() => { hideLoading(); alert('通信エラー'); });
}

function openCancelUndo() {
  if (_isPreviewMode) { alert('閲覧モード中は操作できません。'); return; }
  if (!shiftViewingDate) return;
  if (!confirm('この時間帯の中止を取り消しますか？')) return;
  const date = shiftViewingDate.date, time = shiftViewingDate.time;
  showLoading('中止を取り消し中...');
  apiGet('undoCancelShift', { date, time, uid: SESSION.uid }).then(async data => {
    if (data.ok) { await _refreshShiftAndRedraw(); }
    else { hideLoading(); alert('エラー: ' + data.error); }
  }).catch(() => { hideLoading(); alert('通信エラー'); });
}

// メモ編集
function openMemoEdit() {
  if (!shiftViewingDate) return;
  const date = shiftViewingDate.date, time = shiftViewingDate.time;
  const current = (shiftViewingDate && shiftViewingDate.memo) || '';
  const memo = prompt('責任者メモを入力してください:', current);
  if (memo === null) return;
  showLoading('メモを保存中...');
  apiGet('saveMemo', { date, time, memo }).then(async data => {
    if (data.ok) { await _refreshShiftAndRedraw(); }
    else { hideLoading(); alert('エラー: ' + data.error); }
  }).catch(() => { hideLoading(); alert('通信エラー'); });
}

// ===== 奉仕者編集モード =====
function nameToUid(name) {
  if (!name || !APP_DATA || !APP_DATA.staffJSON) return '';
  const m = APP_DATA.staffJSON.find(s => s.name === name);
  return m ? (m.uid || '') : '';
}

function enterStaffEditMode() {
  staffEditMode = true;
  history.pushState({ screen: 'shift', modal: 'staffEdit' }, '');
  _modalInHistory = 'staffEdit';
  buildShiftDetail(shiftViewingDate);
}

function exitStaffEditMode() {
  staffEditMode = false;
  if (_modalInHistory === 'staffEdit') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  } else {
    _modalInHistory = null;
  }
  buildShiftDetail(shiftViewingDate);
}

async function saveStaffEdits() {
  if (!shiftViewingDate) return;
  const d   = shiftViewingDate;
  const btn = document.getElementById('btn-save-staff');
  if (btn) btn.disabled = true;

  const placeCart     = d.placeCart || {};
  const allPlaceNames = Object.keys((d.slots && d.slots[0] && d.slots[0].places) || {});
  const placeNames    = allPlaceNames; // 編集モードでは全場所を対象

  // 各スロット×場所のドロップダウン値を収集
  const slotsPayload = (d.slots || []).map((slot, ri) => {
    const places = {};
    const watch  = {};
    placeNames.forEach((loc, li) => {
      const uids = [];
      for (let pi = 0; pi < 3; pi++) {
        const sel = document.getElementById('staff-sel-' + ri + '-' + li + '-' + pi);
        if (sel && sel.value) uids.push(sel.value);
      }
      places[loc] = uids;
      watch[loc]  = !!(slot.watch && slot.watch[loc]);
    });
    return { time: slot.time, places, watch };
  });

  // 責任者をUID形式に変換
  const respNames  = d.responsible || [];
  const responsible = {
    r1: nameToUid(respNames[0] || ''),
    r2: nameToUid(respNames[1] || '')
  };

  // カート担当をUID形式に変換
  const cart = { ki1:'', kc1:'', ki2:'', kc2:'', ko1:'', oc1:'', ko2:'', oc2:'' };
  if (d.cart) {
    const bring = (d.cart.bring || []).filter(c => c.name);
    const take  = (d.cart.take  || []).filter(c => c.name);
    if (bring[0]) { cart.ki1 = nameToUid(bring[0].name) || bring[0].name; cart.kc1 = bring[0].cartNo || ''; }
    if (bring[1]) { cart.ki2 = nameToUid(bring[1].name) || bring[1].name; cart.kc2 = bring[1].cartNo || ''; }
    if (take[0])  { cart.ko1 = nameToUid(take[0].name)  || take[0].name;  cart.oc1 = take[0].cartNo  || ''; }
    if (take[1])  { cart.ko2 = nameToUid(take[1].name)  || take[1].name;  cart.oc2 = take[1].cartNo  || ''; }
  }

  showLoading('シフトを保存中...');
  try {
    const result = await apiGet('saveShiftBlock', {
      date: d.date,
      time: d.time,
      responsible,
      cart,
      placeCart,
      usedPlaces: placeNames,
      slots: slotsPayload,
      uid: SESSION ? SESSION.uid : ''
    });
    if (result && result.ok === false) throw new Error(result.error || '保存に失敗しました');
    staffEditMode = false;
    _modalInHistory = null;
    await _refreshShiftAndRedraw();
  } catch (e) {
    await hideLoading();
    alert('保存に失敗しました: ' + e.message);
    if (btn) btn.disabled = false;
  }
}

// ===== 要望送信 =====
async function submitRequest() {
  if (_isPreviewMode) { alert('閲覧モード中は送信できません。'); return; }
  const ta  = document.getElementById('req-textarea');
  const btn = document.getElementById('btn-req-submit');
  const msg = document.getElementById('req-msg');
  if (!ta.value.trim()) { alert('内容を入力してください。'); return; }
  btn.disabled = true;
  showLoading('要望を送信中...');
  try {
    const data = await apiGet('postRequest', { uid: SESSION.uid, name: SESSION.name, body: ta.value.trim() });
    if (!data.ok) throw new Error(data.error);
    hideLoading();
    msg.className = 'msg success'; msg.textContent = '✅ 要望を送信しました！';
    ta.value = '';
    setTimeout(() => { msg.className = 'msg'; msg.textContent = ''; }, 3000);
  } catch (e) {
    hideLoading();
    msg.className = 'msg error'; msg.textContent = '⚠️ 送信に失敗しました。';
    setTimeout(() => { msg.className = 'msg'; msg.textContent = ''; }, 3000);
  } finally {
    btn.disabled = false; btn.textContent = '送信する';
  }
}



// ===== バグ報告送信 =====
async function submitBugReport() {
  if (_isPreviewMode) { alert('閲覧モード中は送信できません。'); return; }
  const ta  = document.getElementById('bug-textarea');
  const btn = document.getElementById('btn-bug-submit');
  const msg = document.getElementById('bug-msg');
  if (!ta.value.trim()) { alert('内容を入力してください。'); return; }
  btn.disabled = true;
  showLoading('バグ報告を送信中...');
  try {
    const data = await apiGet('postBugReport', { uid: SESSION.uid, name: SESSION.name, body: ta.value.trim() });
    if (!data.ok) throw new Error(data.error);
    hideLoading();
    msg.className = 'msg success'; msg.textContent = '✅ バグ報告を送信しました！担当者に通知されます。';
    ta.value = '';
    setTimeout(() => { msg.className = 'msg'; msg.textContent = ''; }, 3000);
  } catch (e) {
    hideLoading();
    msg.className = 'msg error'; msg.textContent = '⚠️ 送信に失敗しました。';
    setTimeout(() => { msg.className = 'msg'; msg.textContent = ''; }, 3000);
  } finally {
    btn.disabled = false; btn.textContent = '送信する';
  }
}

// ===== ヘルプ =====
const HELP_CONTENTS = {
  login: {
    title: 'アプリについて',
    sections: [
      {
        title: 'このアプリでできること',
        items: [
          { icon: '📝', text: 'シフト希望を送る（参加できる時間帯を申告）' },
          { icon: '📋', text: 'シフト表を確認する（公開後に閲覧可能）' },
          { icon: '💬', text: '区域係への要望・ご意見を送る' },
        ]
      },
      {
        title: 'ログイン方法',
        items: [
          { icon: '①', text: '「Googleでログイン」ボタンをタップ' },
          { icon: '②', text: 'アクセス許可されたGoogleアカウントを選択' },
          { icon: '③', text: '初回のみ、名前の選択・登録が必要です' },
          { icon: '④', text: '次回からは自動でログインされます' },
        ]
      },
      {
        title: 'ログインできない場合',
        items: [
          { icon: '⚠️', text: 'アクセス許可されていないアカウントではログインできません。区域係にご連絡ください。' },
        ]
      }
    ]
  },
  main: {
    title: 'メイン画面の見方',
    sections: [
      {
        title: 'カレンダーの色の意味',
        legend: [
          { color: '#ede9fe', border: '#c4b5fd', label: '実施日（タップで時間帯を確認できます）' },
          { color: '#f59e0b', border: '#f59e0b', round: true, label: '自分のシフトが入っている日' },
          { color: '#f97316', border: '#f97316', label: '申込期間（横線で表示）' },
          { color: '#d1fae5', border: '#a7f3d0', label: '申込開始日' },
          { color: '#fee2e2', border: '#fca5a5', label: '締切日' },
          { color: '#eff6ff', border: '#bfdbfe', label: 'シフト公開予定日' },
        ]
      },
      {
        title: '各ボタンの説明',
        items: [
          { icon: '📝', text: '「シフト希望を送る」：受付中のみ利用可。参加できる時間帯を選んで送信します。' },
          { icon: '📋', text: '「シフト表を見る」：シフト公開後に全員のシフト表を確認できます。' },
          { icon: '💬', text: '「要望を送る」：区域係へのご意見・要望を送ることができます。' },
        ]
      }
    ]
  },
  form: {
    title: 'シフト希望の送り方',
    sections: [
      {
        title: '基本的な使い方',
        items: [
          { icon: '①', text: '参加できる時間帯の行をタップするとチェックが入ります' },
          { icon: '②', text: 'もう一度タップするとチェックが外れます' },
          { icon: '③', text: '複数の時間帯を選択することができます' },
          { icon: '④', text: '選択が終わったら「送信する」ボタンを押してください' },
        ]
      },
      {
        title: 'カート担当不可について',
        items: [
          { icon: '🛒', text: 'カート担当に指定されている方のみ表示される項目です' },
          { icon: '⚠️', text: 'その時間帯にカート担当ができない場合はチェックを入れてください' },
        ]
      },
      {
        title: '備考欄について',
        items: [
          { icon: '📝', text: '「途中から参加」「早退あり」などの場合は備考欄に記入してください' },
          { icon: '例', text: '「10:00から」「14:00まで」など' },
        ]
      },
      {
        title: '先月と同じにする',
        items: [
          { icon: '🔄', text: '先月の回答がある場合に表示されます。ONにすると先月と同じ時間帯が自動で選択されます。' },
        ]
      }
    ]
  },
  shift: {
    title: 'シフト表の見方',
    sections: [
      {
        title: 'セルのハイライト色',
        legend: [
          { color: '#fde68a', border: '#f59e0b', label: '自分（奉仕者）' },
          { color: '#fca5a5', border: '#ef4444', label: '自分（責任者）' },
          { color: '#a5b4fc', border: '#6366f1', label: '自分（カート担当）' },
        ]
      },
      {
        title: '各エリアの見方',
        items: [
          { icon: '🔵', text: '北口エリアの担当者一覧（時間ごとに最大3名）' },
          { icon: '🟠', text: '南口エリアの担当者一覧（時間ごとに最大3名）' },
          { icon: '🛒', text: 'カート欄：持込・持帰担当者とカート番号' },
        ]
      },
      {
        title: 'その他の表示',
        items: [
          { icon: '⛔', text: '赤いバナーが表示されている日は「中止」です' },
          { icon: '📝', text: '責任者メモが表示されている場合は内容を確認してください' },
          { icon: '（見守り）', text: '見守り担当として配置されていることを示します' },
        ]
      }
    ]
  },
  request: {
    title: '要望・ご意見の送り方',
    sections: [
      {
        title: '使い方',
        items: [
          { icon: '①', text: 'テキストエリアにご意見・要望・質問などを入力してください' },
          { icon: '②', text: '「送信する」ボタンを押すと区域係に届きます' },
          { icon: '③', text: '送信後はメイン画面に戻ります' },
        ]
      },
      {
        title: '注意事項',
        items: [
          { icon: '⚠️', text: 'このフォームはシフト希望の変更には使用できません。シフト希望の変更は直接区域係にご連絡ください。' },
        ]
      }
    ]
  },
  bug: {
    title: 'バグ・不具合の報告方法',
    sections: [
      {
        title: '書き方のポイント',
        items: [
          { icon: '①', text: '「どの画面で」「何をしたら」「どうなったか」を具体的に入力してください' },
          { icon: '②', text: '「送信する」ボタンを押すと区域係に届きます' },
          { icon: '③', text: '送信後はメイン画面に戻ります' },
        ]
      },
      {
        title: '入力例',
        items: [
          { icon: '例', text: '「シフト表画面で○月○日をタップしたら、画面が白くなって表示されなかった」' },
          { icon: '例', text: '「送信ボタンを押してもエラーが出て送れない」' },
        ]
      }
    ]
  }
};

function openHelp(screen) {
  const content = HELP_CONTENTS[screen] || HELP_CONTENTS['main'];
  document.getElementById('help-modal-title-text').textContent = content.title;
  const body = document.getElementById('help-modal-body');
  body.innerHTML = '';
  content.sections.forEach(sec => {
    const secEl = document.createElement('div');
    secEl.className = 'help-section';
    const titleEl = document.createElement('div');
    titleEl.className = 'help-section-title';
    titleEl.textContent = sec.title;
    secEl.appendChild(titleEl);
    if (sec.legend) {
      const legendEl = document.createElement('div');
      legendEl.className = 'help-legend';
      sec.legend.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'help-legend-row';
        const dot = document.createElement('div');
        dot.className = 'help-legend-dot';
        dot.style.background = row.color;
        dot.style.border = '1.5px solid ' + row.border;
        if (row.round) dot.style.borderRadius = '50%';
        const label = document.createElement('span');
        label.textContent = row.label;
        rowEl.appendChild(dot);
        rowEl.appendChild(label);
        legendEl.appendChild(rowEl);
      });
      secEl.appendChild(legendEl);
    }
    if (sec.items) {
      sec.items.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'help-item';
        itemEl.innerHTML = '<span class="help-item-icon">' + item.icon + '</span><span>' + item.text + '</span>';
        secEl.appendChild(itemEl);
      });
    }
    body.appendChild(secEl);
  });
  document.getElementById('help-overlay').classList.add('show');
  history.pushState({ screen: _currentScreenName, modal: 'help' }, '');
  _modalInHistory = 'help';
}

function closeHelp() {
  document.getElementById('help-overlay').classList.remove('show');
  if (_modalInHistory === 'help') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
}

function closeHelpOutside(e) {
  if (e.target === document.getElementById('help-overlay')) closeHelp();
}

function openManualModal() {
  const MANUALS = [
    {
      url: 'https://jw-utazu.github.io/manual/volunteer.html',
      icon: '📋', bg: 'var(--green-light)', color: 'var(--green-dark)',
      title: '奉仕者マニュアル', sub: 'アプリの基本的な使い方',
      badge: null
    },
    SESSION && SESSION.isResponsible ? {
      url: 'https://jw-utazu.github.io/manual/manual-responsible.html',
      icon: '🏅', bg: '#fca5a5', color: '#7f1d1d',
      title: '責任者マニュアル', sub: 'シフト確認・管理者との連携',
      badge: { text: '責任者', bg: '#fca5a5', color: '#7f1d1d' }
    } : null,
    SESSION && SESSION.isAccountant ? {
      url: 'https://jw-utazu.github.io/manual/manual-admin.html',
      icon: '💰', bg: '#dbeafe', color: '#1e40af',
      title: '会計者マニュアル', sub: '会計情報・道路許可書の管理',
      badge: { text: '会計者', bg: '#dbeafe', color: '#1e40af' }
    } : null,
  ].filter(Boolean);

  document.getElementById('manual-modal-body').innerHTML = MANUALS.map(m =>
    `<a href="${m.url}" target="_blank" class="manual-item">` +
      `<div class="manual-item-icon" style="background:${m.bg};color:${m.color};">${m.icon}</div>` +
      `<div class="manual-item-body">` +
        `<div class="manual-item-title">${m.title}</div>` +
        `<div class="manual-item-sub">${m.sub}</div>` +
        (m.badge ? `<span class="manual-item-badge" style="background:${m.badge.bg};color:${m.badge.color};">${m.badge.text}</span>` : '') +
      `</div>` +
      `<div class="manual-item-arr">›</div>` +
    `</a>`
  ).join('');

  document.getElementById('manual-overlay').classList.add('show');
}

function closeManualModal() {
  document.getElementById('manual-overlay').classList.remove('show');
}

function closeManualOutside(e) {
  if (e.target === document.getElementById('manual-overlay')) closeManualModal();
}

// ===== エスケープ =====
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== 起動処理 =====
(async function init() {
  // セッション復元を試みる（email/tokenのみ保存、権限は毎回サーバーから再取得）
  const saved = loadSession();
  if (saved && saved.email) {
    if (saved.needsRegister) {
      // 初回登録途中でリロードされた場合は登録画面へ
      buildRegisterScreen(saved.members || [], saved.email, saved.token || '', '', saved.picture || '');
      return;
    }
    // email+tokenがあればサーバーに再認証して最新データを取得
    showLoading('認証中...');
    try {
      const data = await apiGet('auth', null, { source: 'form', email: saved.email });
      if (!data.ok) {
        hideLoading();
        clearSession();
        shouldShowOneTap = true;
        try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.prompt(); } catch(_) {}
        showScreen('login');
        return;
      }
      if (data.needsRegister) {
        hideLoading();
        buildRegisterScreen(data.members || [], saved.email, saved.token || '', '', saved.picture || '');
        return;
      }
      SESSION = {
        uid: data.uid, name: data.name, email: saved.email, token: saved.token,
        isAdmin: data.isAdmin, isResponsible: data.isResponsible,
        isCart: data.isCart, isAccountant: data.isAccountant || false, proxyTargets: data.proxyTargets || [],
        picture: saved.picture || ''
      };
      // hideLoadingせずそのままinitAppへ（ローディングはinitApp内で引き継ぎ）
      await initApp();
      return;
    } catch(e) {
      hideLoading();
      // 通信エラー時はログイン画面へ
      clearSession();
      shouldShowOneTap = true;
      try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.prompt(); } catch(_) {}
      showScreen('login');
      return;
    }
  }
  // 未ログイン：One Tapを許可してからログイン画面を表示
  shouldShowOneTap = true;
  // GISがすでに初期化済みなら直接prompt()を呼ぶ
  try {
    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.prompt();
    }
  } catch(_) {}
  showScreen('login');
})();
// ===== 写真閲覧モーダル =====
const ACCOUNTING_URL = 'https://docs.google.com/spreadsheets/d/1_eacoOvEoj2k6SjuoTJnM8_QBRGxzhogWkhjZkP1Vyk/edit';

let _photoList    = [];
let _photoCurrent = 0;

async function openPhotoModal(category) {
  const overlay = document.getElementById('photo-modal-overlay');
  const titleEl = document.getElementById('photo-modal-title');
  const imgEl   = document.getElementById('photo-modal-img');
  const loadEl  = document.getElementById('photo-modal-loading');
  const counter = document.getElementById('photo-modal-counter');

  overlay.style.display = 'flex';
  titleEl.textContent   = category === 'road' ? '🗺 道路使用許可書' : '🖼 カート展示内容';
  imgEl.style.display   = 'none';
  loadEl.style.display  = 'block';
  counter.textContent   = '';
  _photoList    = [];
  _photoCurrent = 0;

  try {
    const res = await apiGet('getPhotos', { category, year: YEAR || new Date().getFullYear(), month: MONTH || (new Date().getMonth() + 1) });
    _photoList = (res && res.photos) || [];
    if (_photoList.length === 0) {
      loadEl.textContent = '写真が登録されていません';
      return;
    }
    loadEl.style.display = 'none';
    showPhoto(0);
  } catch(e) {
    loadEl.textContent = '読み込みに失敗しました';
  }
}

function showPhoto(idx) {
  const imgEl   = document.getElementById('photo-modal-img');
  const loadEl  = document.getElementById('photo-modal-loading');
  const counter = document.getElementById('photo-modal-counter');
  const prevBtn = document.getElementById('photo-prev-btn');
  const nextBtn = document.getElementById('photo-next-btn');
  if (!_photoList.length) return;
  _photoCurrent = Math.max(0, Math.min(idx, _photoList.length - 1));
  imgEl.style.display  = 'none';
  loadEl.style.display = 'block';
  loadEl.textContent   = '読み込み中...';
  const url = _photoList[_photoCurrent].url;
  imgEl.onload = () => { loadEl.style.display = 'none'; imgEl.style.display = 'block'; };
  imgEl.onerror = () => { loadEl.textContent = '画像を読み込めませんでした'; };
  imgEl.src = url;
  counter.textContent = (_photoCurrent + 1) + ' / ' + _photoList.length;
  prevBtn.style.opacity = _photoCurrent === 0 ? '0.3' : '1';
  nextBtn.style.opacity = _photoCurrent === _photoList.length - 1 ? '0.3' : '1';
}

function photoNav(delta) {
  showPhoto(_photoCurrent + delta);
}

function closePhotoModal() {
  document.getElementById('photo-modal-overlay').style.display = 'none';
  _photoList = []; _photoCurrent = 0;
}

function openAccountingSheet() {
  window.open(ACCOUNTING_URL, '_blank');
}

// ===== シフト表詳細：カート展示写真ボタン =====
function openExhibitPhotoFromShift() {
  openPhotoModal('exhibit');
}

// ===== 道路使用許可書PDF閲覧モーダル（全ユーザー向け） =====
async function openRoadPdfModal() {
  const modal = document.getElementById('road-pdf-view-modal');
  modal.style.display = 'flex';
  history.pushState({ screen: _currentScreenName, modal: 'roadPdf' }, '');
  _modalInHistory = 'roadPdf';
  const body = document.getElementById('road-pdf-view-body');
  body.innerHTML = '<div style="text-align:center;color:var(--sub);padding:20px;font-size:14px;">読み込み中...</div>';
  try {
    const res = await apiGet('getRoadPdfs', {});
    const allPdfs = (res && res.pdfs) || [];
    // "YYYY-MM-DD" を new Date() で解釈するとUTC深夜になり日本時間でずれるためローカル解釈する
    function _parseLocalDate(s) { const p = s.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
    const today = getSimulatedToday(); today.setHours(0, 0, 0, 0);
    const pdfs = allPdfs.filter(p => {
      if (!p.startDate && !p.endDate) return true;
      if (p.startDate && today < _parseLocalDate(p.startDate)) return false;
      if (p.endDate   && today > _parseLocalDate(p.endDate))   return false;
      return true;
    });
    if (!pdfs.length) {
      body.innerHTML = '<div style="text-align:center;color:var(--sub);padding:20px;font-size:14px;">道路使用許可書が登録されていません</div>';
      return;
    }
    body.style.display = 'block';
    body.innerHTML = '<iframe src="https://drive.google.com/file/d/' + pdfs[0].fileId + '/preview" style="width:100%;height:100%;border:none;display:block;"></iframe>';
  } catch(e) {
    body.innerHTML = '<div style="color:var(--danger);padding:12px;font-size:13px;">読み込みに失敗しました</div>';
  }
}

function closeRoadPdfModal() {
  document.getElementById('road-pdf-view-modal').style.display = 'none';
  if (_modalInHistory === 'roadPdf') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
}

// ===== 道路使用許可書PDF管理画面（会計者向け） =====
async function _initRoadPermitScreen() {
  const card = document.getElementById('road-permit-list-card');
  card.innerHTML = '<div style="text-align:center;padding:20px;color:var(--sub);font-size:14px;">読み込み中...</div>';
  document.getElementById('road-permit-file-input').value = '';
  document.getElementById('road-permit-upload-status').style.display = 'none';

  // デフォルト値をセット
  const today = new Date();
  function _pad(n) { return String(n).padStart(2, '0'); }
  function _fmtDate(d) { return d.getFullYear() + '-' + _pad(d.getMonth()+1) + '-' + _pad(d.getDate()); }
  const managedYear  = YEAR  || today.getFullYear();
  const managedMonth = MONTH || (today.getMonth() + 1);
  const endOfMonth   = new Date(managedYear, managedMonth, 0);
  document.getElementById('road-permit-display-name').value = '道路使用許可書' + managedMonth + '月';
  document.getElementById('road-permit-start-date').value   = _fmtDate(today);
  document.getElementById('road-permit-end-date').value     = _fmtDate(endOfMonth);

  try {
    const res = await apiGet('getRoadPdfs', {});
    const pdfs = (res && res.pdfs) || [];
    if (!pdfs.length) {
      card.innerHTML = '<div style="text-align:center;padding:20px;color:var(--sub);font-size:13px;">登録されているPDFはありません</div>';
      return;
    }
    card.innerHTML = '<div class="card-title" style="margin-bottom:12px;">📋 登録済みPDF</div>'
      + pdfs.map(p => {
        const label = p.displayName || p.fileName;
        const period = (p.startDate || p.endDate)
          ? (p.startDate ? p.startDate.replace(/-/g,'/') : '') + '〜' + (p.endDate ? p.endDate.replace(/-/g,'/') : '')
          : '';
        const esc = s => s.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return '<div style="padding:10px 0;border-bottom:1px solid var(--border);">'
          + '<div style="display:flex;align-items:center;gap:10px;">'
          + '<span style="font-size:20px;flex-shrink:0;">📄</span>'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + label + '</div>'
          + (period ? '<div style="font-size:11px;color:#92400e;font-weight:700;margin-top:1px;">📅 ' + period + '</div>' : '')
          + '<div style="font-size:12px;color:var(--sub);margin-top:1px;">' + p.updatedAt + '</div>'
          + '</div>'
          + '</div>'
          + '<div style="display:flex;gap:6px;margin-top:8px;padding-left:30px;">'
          + '<button onclick="showAdminPdfPreview(\'' + p.fileId + '\',\'' + esc(label) + '\')" style="flex:1;padding:7px 6px;background:#f0fdf4;border:1px solid var(--border);border-radius:8px;color:var(--green);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">🔍 プレビュー</button>'
          + '<button onclick="openEditRoadPdf(\'' + p.fileId + '\',\'' + esc(label) + '\',\'' + (p.startDate||'') + '\',\'' + (p.endDate||'') + '\')" style="flex:1;padding:7px 6px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">✏️ 編集</button>'
          + '<button onclick="deleteRoadPdf(\'' + p.fileId + '\',\'' + esc(label) + '\')" style="flex:1;padding:7px 6px;background:#fff1f2;border:1px solid #fca5a5;border-radius:8px;color:#b91c1c;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">🗑 削除</button>'
          + '</div>'
          + '</div>';
      }).join('');
  } catch(e) {
    card.innerHTML = '<div style="color:var(--danger);padding:12px;font-size:13px;">読み込みに失敗しました: ' + e.message + '</div>';
  }
}

async function onRoadPermitFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf') {
    alert('PDFファイルを選択してください');
    event.target.value = '';
    return;
  }
  const displayName = document.getElementById('road-permit-display-name').value.trim()
    || ('道路使用許可書' + (MONTH || (new Date().getMonth() + 1)) + '月');
  const startDate = document.getElementById('road-permit-start-date').value;
  const endDate   = document.getElementById('road-permit-end-date').value;
  const statusEl = document.getElementById('road-permit-upload-status');
  statusEl.style.display = 'none';
  showLoading('PDFをアップロード中...');
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    // PDF名をDriveのファイル名にも適用（上書き検索に使われる）
    const driveFileName = (displayName.endsWith('.pdf') ? displayName : displayName + '.pdf');
    const res = await apiPost('uploadRoadPdf', { base64, fileName: driveFileName, displayName, startDate, endDate });
    if (!res.ok) throw new Error(res.error || 'アップロード失敗');
    await hideLoading();
    statusEl.style.display = 'block';
    statusEl.textContent = 'アップロード完了！';
    document.getElementById('road-permit-file-input').value = '';
    await _initRoadPermitScreen();
  } catch(e) {
    await hideLoading();
    statusEl.style.display = 'block';
    statusEl.textContent = 'エラー: ' + e.message;
  }
}

async function deleteRoadPdf(fileId, fileName) {
  if (!confirm('「' + fileName + '」を削除しますか？')) return;
  showLoading('削除中...');
  try {
    const res = await apiGet('deleteRoadPdf', { fileId: fileId });
    if (!res.ok) throw new Error(res.error || '削除失敗');
    await hideLoading();
    await _initRoadPermitScreen();
  } catch(e) {
    await hideLoading();
    alert('削除に失敗しました: ' + e.message);
  }
}

// ===== 管理者向けPDFプレビュー =====
function showAdminPdfPreview(fileId, label) {
  document.getElementById('admin-pdf-preview-title').textContent = label;
  document.getElementById('admin-pdf-preview-iframe').src = 'https://drive.google.com/file/d/' + fileId + '/preview';
  document.getElementById('admin-pdf-preview-overlay').style.display = 'flex';
  history.pushState({ screen: _currentScreenName, modal: 'adminPdf' }, '');
  _modalInHistory = 'adminPdf';
}
function closeAdminPdfPreview() {
  document.getElementById('admin-pdf-preview-overlay').style.display = 'none';
  document.getElementById('admin-pdf-preview-iframe').src = '';
  if (_modalInHistory === 'adminPdf') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
}

// ===== PDF情報編集 =====
function openEditRoadPdf(fileId, displayName, startDate, endDate) {
  document.getElementById('edit-road-pdf-file-id').value = fileId;
  document.getElementById('edit-road-pdf-display-name').value = displayName;
  document.getElementById('edit-road-pdf-start-date').value = startDate;
  document.getElementById('edit-road-pdf-end-date').value = endDate;
  document.getElementById('edit-road-pdf-msg').textContent = '';
  document.getElementById('edit-road-pdf-save-btn').disabled = false;
  document.getElementById('road-pdf-edit-overlay').style.display = 'flex';
  history.pushState({ screen: _currentScreenName, modal: 'roadPdfEdit' }, '');
  _modalInHistory = 'roadPdfEdit';
}
function closeEditRoadPdf() {
  document.getElementById('road-pdf-edit-overlay').style.display = 'none';
  if (_modalInHistory === 'roadPdfEdit') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
}
async function saveEditRoadPdf() {
  const fileId      = document.getElementById('edit-road-pdf-file-id').value;
  const displayName = document.getElementById('edit-road-pdf-display-name').value.trim();
  const startDate   = document.getElementById('edit-road-pdf-start-date').value;
  const endDate     = document.getElementById('edit-road-pdf-end-date').value;
  const msgEl       = document.getElementById('edit-road-pdf-msg');
  const saveBtn     = document.getElementById('edit-road-pdf-save-btn');
  if (!displayName) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'PDF名を入力してください';
    return;
  }
  saveBtn.disabled = true;
  msgEl.textContent = '';
  showLoading('保存中...');
  try {
    const res = await apiGet('updateRoadPdfMeta', { fileId, displayName, startDate, endDate });
    if (!res.ok) throw new Error(res.error || '保存失敗');
    await hideLoading();
    closeEditRoadPdf();
    await _initRoadPermitScreen();
  } catch(e) {
    await hideLoading();
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'エラー: ' + e.message;
    saveBtn.disabled = false;
  }
}

// ===== PW モード切り替え（奉仕者アプリ） =====
async function switchFormPwType(type) {
  if (currentPwType === type) return;
  currentPwType = type;
  document.getElementById('pw-tab-form-normal').className  = 'pw-type-tab-form' + (type === 'normal'  ? ' active' : '');
  document.getElementById('pw-tab-form-limited').className = 'pw-type-tab-form limited' + (type === 'limited' ? ' active' : '');

  showLoading(type === 'limited' ? '限定PWデータを読み込み中...' : '通常PWデータを読み込み中...');
  try {
    if (type === 'limited') {
      // 限定PW データを再フェッチ（キャッシュがあれば使う）
      if (!LIMITED_APP_DATA) {
        const [limFormData, limDetail, limShiftData] = await Promise.all([
          apiGet('dataMini',      { type: limitedPwType }),
          apiGet('getFormDetail', { type: limitedPwType }),
          apiGet('getShiftTable', { type: limitedPwType })
        ]);
        LIMITED_APP_DATA   = limFormData;
        LIMITED_SHIFT_DATA = limShiftData;
        LIMITED_DETAIL     = limDetail;
      }
      // 通常PW のデータを退避し限定PW のデータで上書き
      APP_DATA   = LIMITED_APP_DATA;
      SHIFT_DATA = LIMITED_SHIFT_DATA;
      const ld = LIMITED_DETAIL || {};
      THIS_MONTH  = (ld.thisMonthData && Object.keys(ld.thisMonthData).length > 0)
                      ? ld.thisMonthData : (LIMITED_APP_DATA.thisMonthData || {});
      SLOTS       = ld.slots         || [];
      LAST_MONTH  = ld.lastMonthData || {};
      if (APP_DATA) APP_DATA.staffJSON = ld.staffJSON || [];
      YEAR        = LIMITED_APP_DATA.year  || 0;
      MONTH       = LIMITED_APP_DATA.month || 0;
      SHIFT_DATES = LIMITED_APP_DATA.shiftDates || [];
      SHIFT_DATES_MAP = {};
      (LIMITED_APP_DATA.shiftSlots || []).forEach(s => {
        const key = s.m + '_' + s.d;
        if (!SHIFT_DATES_MAP[key]) SHIFT_DATES_MAP[key] = [];
        if (!SHIFT_DATES_MAP[key].includes(s.time)) SHIFT_DATES_MAP[key].push(s.time);
      });
    } else {
      // 通常PW に戻す（initApp で取得したデータを再フェッチ）
      const [formData, detail, shiftData] = await Promise.all([
        apiGet('dataMini',      { type: 'normal' }),
        apiGet('getFormDetail', { type: 'normal' }),
        apiGet('getShiftTable', { type: 'normal' })
      ]);
      APP_DATA   = formData;
      SHIFT_DATA = shiftData;
      THIS_MONTH  = (detail.thisMonthData && Object.keys(detail.thisMonthData).length > 0)
                      ? detail.thisMonthData : (formData.thisMonthData || {});
      SLOTS       = detail.slots         || [];
      LAST_MONTH  = detail.lastMonthData || {};
      if (APP_DATA) APP_DATA.staffJSON = detail.staffJSON || [];
      YEAR        = formData.year  || 0;
      MONTH       = formData.month || 0;
      SHIFT_DATES = formData.shiftDates || [];
      SHIFT_DATES_MAP = {};
      (formData.shiftSlots || []).forEach(s => {
        const key = s.m + '_' + s.d;
        if (!SHIFT_DATES_MAP[key]) SHIFT_DATES_MAP[key] = [];
        if (!SHIFT_DATES_MAP[key].includes(s.time)) SHIFT_DATES_MAP[key].push(s.time);
      });
      // 通常PWデータを統合カレンダー用に更新
      NORMAL_SHIFT_DATES     = SHIFT_DATES.slice();
      NORMAL_SHIFT_DATES_MAP = Object.assign({}, SHIFT_DATES_MAP);
    }
    buildMainScreen();
    await hideLoading();
  } catch(e) {
    hideLoading();
    alert('データ読み込みエラー: ' + e.message);
  }
}

// カレンダースワイプジェスチャー（右スワイプ→前月、左スワイプ→次月）
(function() {
  const card = document.getElementById('cal-grid');
  if (!card) return;
  let startX = 0, startY = 0;
  card.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  card.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    // 水平移動が50px未満、または垂直移動の方が大きい場合は無視
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    calNavMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
})();
