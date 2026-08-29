// ===== 定数 =====
const API_URL    = "https://nqtswiynoxawccldqcwi.supabase.co/functions/v1/api";
const ANON_KEY   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdHN3aXlub3hhd2NjbGRxY3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzQxNjIsImV4cCI6MjA5ODMxMDE2Mn0.M-AnCBnXBI1FIyouoa5ttF6mb8PF2YqHfv180PqQWQU";
const CLIENT_ID  = "538467678510-7ltuvmuj0d1mmgngtj980me3daenqmm7.apps.googleusercontent.com";
const SS_KEY     = "shiftapp_session";
const VAPID_PUBLIC_KEY = "BJHGZvJP5c29-zK_c2XT5ZIx5-XSYPBKna4RW05tqtGcZfdjkmU5O_Lyab1061jZBpBtp517hCg-K4py8TsHfbY";

// session.js（共通セッション）が読み込めなかった場合の安全網。
// このアプリは認証画面を持たないため、最低限リダイレクトだけは動くようにしておく
if (typeof pwgwsGetSession !== 'function') {
  console.warn('[session] session.js が読み込めませんでした。最低限の動作で継続します');
  window.pwgwsGetSession           = function () { return null; };
  window.pwgwsGetSessionToken      = function () { return ''; };
  window.pwgwsSaveSession          = function () {};
  window.pwgwsInvalidateCurrentToken = function () {};
  window.pwgwsClearSession         = function () {
    try { localStorage.removeItem('pwgws_session'); } catch (_) {}
    try { localStorage.removeItem('pwgws_recovery_session'); } catch (_) {}
  };
  window.pwgwsGoToLogin            = function (reason) {
    location.replace('login.html?return=' + encodeURIComponent(location.href) +
      (reason ? '&reason=' + encodeURIComponent(reason) : ''));
  };
  window.pwgwsShouldRedirectToLogin = function () { return true; };
  window.pwgwsEnforceRelogin        = function () { return false; };
  // 複数アカウント：切り替えはできないが、押しても何も起きないだけで済むようにする
  window.PWGWS_FORM_URL             = 'https://jw-utazu.github.io/shift-form/';
  window.pwgwsGetAccounts           = function () { return []; };
  window.pwgwsSwitchAccount         = function () { return false; };
  window.pwgwsRemoveAccount         = function () { return false; };
  window.pwgwsGoToAddAccount        = function () { window.pwgwsGoToLogin(); };
  window.pwgwsOpenAccountMenu       = function () {
    alert('アカウント機能を読み込めませんでした。ページを再読み込みしてください。');
  };
}

// 別タブでアカウントまたは token が変わったら、旧 principal の通信を直ちに止める。
// session.js がこのイベントを同期発火した直後に reload するため、応答が戻って旧画面を
// 更新する余地を残さない。
const _activeApiControllers = new Set();
let _sessionChangeReloading = false;
window.addEventListener('pwgws:session-changing', () => {
  _sessionChangeReloading = true;
  _activeApiControllers.forEach(controller => controller.abort());
  _activeApiControllers.clear();
  showLoading('アカウントを切り替えています...');
});

// ============================================================
// テストアカウント専用：疑似日付シミュレーション
// ============================================================
const TEST_EMAIL = 'jw.utazu.test@gmail.com';

// テストアカウントでログイン中かつ疑似日付が設定されている場合のみ値を返す
function getDebugFakeNow() {
  if (!SESSION || SESSION.email !== TEST_EMAIL) return '';
  return localStorage.getItem('debugFakeNow') || '';
}

// 「未登録状態を試す」ワンショットフラグを読み取り、即座にクリアする
// （次回以降のauth呼び出しには影響させないため）
function _consumeSimulateRegisterFlag() {
  const v = sessionStorage.getItem('debugSimulateRegisterOnce');
  sessionStorage.removeItem('debugSimulateRegisterOnce');
  return !!v;
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
    if (input.value) {
      localStorage.setItem('debugFakeNow', input.value);
      sessionStorage.setItem('debugFakeNowKeepOnce', '1'); // このreloadだけはリセットしない
    } else {
      localStorage.removeItem('debugFakeNow');
    }
    // 古い表示のまま一瞬固まって見えないよう、reload前にオーバーレイを出す
    showLoading('疑似日付を反映しています...');
    location.reload();
  };
  clearBtn.onclick = () => {
    localStorage.removeItem('debugFakeNow');
    showLoading('実際の日付に戻しています...');
    location.reload();
  };
  const simulateBtn = document.getElementById('debugSimulateRegisterBtn');
  if (simulateBtn) {
    simulateBtn.onclick = () => {
      sessionStorage.setItem('debugSimulateRegisterOnce', '1');
      showLoading('未登録状態を再現しています...');
      location.reload();
    };
  }
}

// ===== API通信 =====
// 名称は既存呼び出しとの互換のため残すが、URLにparamsを載せずPOSTへ統一する。
function apiRequest(action, params, timeoutMs) {
  if (_sessionChangeReloading) {
    const err = new Error('アカウント切替中です');
    err.authError = true;
    return Promise.reject(err);
  }
  const effectiveType = currentPwType === 'limited' ? limitedPwType : currentPwType;
  const p = Object.assign({ type: effectiveType }, params || {});
  const fakeNow = getDebugFakeNow();
  if (fakeNow) p.fakeNow = fakeNow;
  const controller = new AbortController();
  _activeApiControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), timeoutMs || 60000);
  const headers = { 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' };
  const token = pwgwsGetSessionToken();
  if (token) headers['X-PWGWS-Session'] = token;
  return fetch(API_URL, {
    method: 'POST', redirect: 'follow', signal: controller.signal, headers: headers,
    body: JSON.stringify(Object.assign({ action: action }, p))
  }).then(async r => {
      clearTimeout(timer);
      let data = null;
      try { data = await r.json(); } catch (_) {}
      if (r.status === 401) {
        pwgwsInvalidateCurrentToken();
        pwgwsGoToLogin('expired');
        const err = new Error('ログインの有効期限が切れました');
        err.authError = true;
        throw err;
      }
      if (r.status === 403) throw new Error((data && data.error) || 'この操作を行う権限がありません');
      if (!r.ok) throw new Error((data && data.error) || ('通信エラー (' + r.status + ')'));
      if (data && data.error && !data.ok) throw new Error(data.error);
      return data;
    })
    .catch(err => {
      clearTimeout(timer);
      console.error('[api]', action, err);
      if (_sessionChangeReloading) {
        const staleError = new Error('アカウント切替中です');
        staleError.authError = true;
        throw staleError;
      }
      if (err.name === 'AbortError') throw new Error('通信タイムアウト');
      throw err;
    })
    .finally(() => _activeApiControllers.delete(controller));
}

function apiGet(action, params, extraQuery) {
  return apiRequest(action, Object.assign({}, params || {}, extraQuery || {}), 60000);
}
function apiPost(action, params) { return apiRequest(action, params, 180000); }

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
let SLOTS        = [], LAST_MONTH = {}, THIS_MONTH = {};
let YEAR = 0, MONTH = 0;   // 申込を受け付けている月（シフト表の月とはずれることがある）

// SHIFT_DATA は「シフトが公開されている月」のもので、申込中の月（YEAR/MONTH）とは
// 別の月のことがある（今月のシフトが動いている最中に来月の申込が始まる）。
// カレンダー・確定シフト一覧は申込中の月を描いているため、
// 「この月のシフトは公開済み」と読んでよいのは両者が同じ月のときだけ
function isShiftPublishedForShownMonth() {
  if (!SHIFT_DATA || !SHIFT_DATA.published) return false;
  // 年月が返らない場合（旧API）は従来どおり公開済みとして扱う
  if (!SHIFT_DATA.year || !SHIFT_DATA.month || !YEAR || !MONTH) return true;
  return SHIFT_DATA.year === YEAR && SHIFT_DATA.month === MONTH;
}
let currentFormName = '';
let currentFormUid  = '';
let isCartUser = false;
let lastMonthOn = false;
const formState = { checkedMap: {}, cartNgMap: {}, noteMap: {} };
let deferredPrompt = null;
let shiftViewingDate = null; // 現在表示中のシフト日付
let staffEditMode = false;   // 奉仕者編集モード
let _memberFlags = null;     // 奉仕者編集モード用：uid -> {respFlag, cartFlag}（1度取得したらキャッシュ）
let _cartNumbers = null;     // 奉仕者編集モード用：登録済みカート番号一覧
let _modalInHistory = null;       // 戻るボタンで閉じるモーダル識別子
let _suppressNextPopstate = false; // モーダルを直接閉じた際のpopstate抑制フラグ
let _mainHistorySetup = false;     // main 下に __bottom__ エントリを1度だけ挿入したか
let _currentNotices = [];          // 現在表示可能なお知らせ一覧（ベルアイコンのバッジ・モーダル用）
let _guideTrail = [];              // かんたん案内で選択した質問の履歴

// ===== PWA =====
const _isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ホーム画面から起動している＝インストール済みなので、追加ボタンは出さない
// （iOS では beforeinstallprompt が来ないため、この判定だけが唯一の手掛かり）
const _isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

function _updateInstallBtn() {
  if (_isStandalone) return;
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
  history.pushState({ screen: _currentScreenName, modal: 'pwaInstall' }, '');
  _modalInHistory = 'pwaInstall';
}
function closePwaInstallModal() {
  document.getElementById('pwa-install-overlay').classList.remove('show');
  if (_modalInHistory === 'pwaInstall') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
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


// ===== 起動スプラッシュ（admin/シフト管理アプリと共通の見た目） =====
// ロゴのフェードだけ見せて、内部処理の段階（ログイン→権限確認→データ読込）は
// 表示しない。初回起動が終わったら以降は通常のローディングオーバーレイ
// （showLoading/hideLoading）を使う
let _firstBootDone = false;
let _ldSpinnerTimer = null;
// 起動処理が1.5秒を超えて終わらないときだけスピナーを出す保険。通常は一瞬で終わるので出ない想定
function startBootSpinnerTimer() {
  clearTimeout(_ldSpinnerTimer);
  _ldSpinnerTimer = setTimeout(() => {
    const sp = document.getElementById('ld-spinner');
    if (sp) sp.classList.add('show');
  }, 1500);
}
function stopBootSpinnerTimer() {
  clearTimeout(_ldSpinnerTimer);
  const sp = document.getElementById('ld-spinner');
  if (sp) sp.classList.remove('show');
}
function showBootSplash() {
  const el = document.getElementById('loading');
  if (el && !el.classList.contains('show')) el.classList.add('show');
  startBootSpinnerTimer();
}
function hideBootSplash() {
  stopBootSpinnerTimer();
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('fade-out');
  setTimeout(() => { el.classList.remove('show', 'fade-out'); }, 350);
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
//
// requestAnimationFrame はタブが非表示のあいだ発火しない。この関数のコールバックで
// hideLoading() の Promise を解決しているため、対策しないとバックグラウンドで開いた
// タブが「読み込み中」のまま先へ進まなくなる（タブを表示するまで待たされる）。
// 非表示なら即座に完了させ、さらに保険のタイマーでも必ず完了させる
function _animateTo100(callback) {
  let called = false;
  const done = () => {
    if (called) return;
    called = true;
    _setProgress(100);
    _progressCurrent = 100;
    if (callback) callback();
  };

  // 非表示タブではアニメーションしても見えないので省略する
  if (document.hidden) { done(); return; }

  const startPct  = _progressCurrent;
  const startTime = performance.now();
  const duration  = 800;
  function step(now) {
    if (called) return;
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
      done();
    }
  }
  requestAnimationFrame(step);
  // アニメーションの途中でタブが非表示になった場合の保険
  setTimeout(done, duration + 600);
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
// 認証はこのアプリ内では行わず、共通ログイン画面（login.html）に一本化したため
// login / recovery 画面は持たない
const SCREENS = ['register','main','form','shift','report','more','request','bug','road-permit','distrib-report'];
// 画面ごとの display 値
const SCREEN_DISPLAY = {
  register: 'flex',
  main:     'block',
  form:           'block',
  shift:          'block',
  report:         'block',
  more:           'block',
  request:        'block',
  bug:            'block',
  'road-permit':  'block',
  'distrib-report': 'block'
};
// ===== History API による戻るボタン対応 =====
// 戻るボタンで履歴を積まない画面（初回登録画面を底とする）
const HISTORY_NO_PUSH = new Set(['register']);

// ===== タブ構成 =====
// 各画面がどのタブに属するか。タブ内で詳細画面に入っても、
// タブバーはその親タブを選択状態のまま保つ
const SCREEN_TAB = {
  main: 'home',
  form: 'form',
  shift: 'shift',
  report: 'report', 'distrib-report': 'report', 'road-permit': 'report',
  more: 'more', request: 'more', bug: 'more',
};
// 各タブの入口となる画面
const TAB_ROOT_SCREEN = { home: 'main', form: 'form', shift: 'shift', report: 'report', more: 'more' };
// タブ内での深さ。ホーム=0／各タブの入口=1／タブ内の詳細=2。
// 戻るボタンでこの深さの分だけ履歴を戻ればホームに着く、という関係を保つ
const SCREEN_TAB_DEPTH = {
  main: 0,
  form: 1, shift: 1, report: 1, more: 1,
  'distrib-report': 2, 'road-permit': 2, request: 2, bug: 2,
};
// タブ入口に「‹ 戻る」は出さない（戻り先はホームで、それはタブバーの役目）。
// タブ内の詳細画面だけが戻るバーを持つ
const TAB_ROOT_SCREENS = new Set(['main','form','shift','report','more']);

// 画面の「深さ」（進む/戻るの方向判定用）
const SCREEN_DEPTH = { register: 1, main: 2, form: 3, shift: 3, report: 3, more: 3, request: 4, bug: 4, 'road-permit': 4, 'distrib-report': 4 };
let _currentScreenName = 'register';
let _currentTab = 'home';
let _tabDepth   = 0;
// タブを離れた時点の画面・履歴・スクロール位置。戻ったときに入口へリセットせず、
// 入力途中のフォームやシフト詳細をそのまま再表示する。
let _tabSnapshots = {};
// 履歴を戻している最中の「戻り終わったら開くタブ」。popstate で着地を
// 確認してから続きを行うための引き継ぎ用（switchTab のコメント参照）
let _pendingTab = null;
// 同じく、履歴を1段戻した後に実行したい処理（モーダルを閉じてから
// タブへ移る場合など）。go(-1) の完了前に次の履歴操作をしないため
let _afterPopstate = null;
let _historyNormalizeResolve = null;

function showScreen(name, fromPopstate, stateDepth, skipScreenInit) {
  window.scrollTo(0, 0);
  const isBack = fromPopstate || SCREEN_DEPTH[name] < SCREEN_DEPTH[_currentScreenName];
  const animClass = isBack ? 'screen-enter-back' : 'screen-enter-forward';

  SCREENS.forEach(s => {
    const el = document.getElementById('screen-' + s);
    if (!el) return;
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

  if (!skipScreenInit) {
    if (name === 'form')           _showFormScreen();
    if (name === 'shift')          _showShiftScreen();
    if (name === 'road-permit')    _initRoadPermitScreen();
    if (name === 'distrib-report') _showDistribReportScreen();
    if (name === 'more')           _showSettingsScreen();
  }

  // form-back-btnのonclickを設定（動的IDのため）
  const formBackBtn = document.getElementById('form-back-btn');
  if (formBackBtn) {
    formBackBtn.onclick = () => history.back();
  }

  // popstateからの呼び出しでなければ履歴に積む
  if (!fromPopstate && !HISTORY_NO_PUSH.has(name)) {
    const st = { screen: name, tab: SCREEN_TAB[name] || 'home', depth: SCREEN_TAB_DEPTH[name] || 0 };
    if (name === 'main') {
      if (!_mainHistorySetup) {
        _mainHistorySetup = true;
        // main の直下に番兵エントリを1度だけ挿入し、ここまで戻ると確認ダイアログを表示
        history.pushState({ screen: '__bottom__' }, '');
      }
      history.pushState(st, '');
    } else {
      history.pushState(st, '');
    }
  }

  syncTabUi(name, stateDepth);
}

// 画面表示に合わせてタブバーの選択状態・表示可否・戻るバーの有無を揃える。
// depth は履歴 state に入っていればそれを優先する（シフト詳細のように
// 同じ screen 名で深さが変わるものがあるため、画面名だけでは決まらない）
function syncTabUi(name, stateDepth) {
  _currentTab = SCREEN_TAB[name] || 'home';
  _tabDepth   = (stateDepth != null) ? stateDepth
              : (SCREEN_TAB_DEPTH[name] != null ? SCREEN_TAB_DEPTH[name] : 0);

  // 初回登録画面ではタブバーを出さない（まだアプリを使える状態ではない）
  const bar = document.getElementById('tabbar');
  const show = name !== 'register';
  if (bar) bar.style.display = show ? '' : 'none';
  document.body.classList.toggle('has-tabbar', show);

  const guideLauncher = document.getElementById('guide-launcher');
  if (guideLauncher) guideLauncher.classList.toggle('is-hidden', !show);

  Object.keys(TAB_ROOT_SCREEN).forEach(t => {
    const btn = document.getElementById('tab-' + t);
    if (btn) btn.classList.toggle('active', t === _currentTab);
  });

  // タブ入口の画面には戻り先が無いので「‹ 戻る」バーを隠す
  const scr = document.getElementById('screen-' + name);
  if (scr) {
    const bb = scr.querySelector('.back-bar');
    if (bb) bb.style.display = TAB_ROOT_SCREENS.has(name) ? 'none' : '';
  }
}

// 設定タブを開いたとき：プロフィールと通知設定の現在値を反映する。
// 通知の購読状況は端末側（Service Worker）にしか無いので、
// 開くたびに取り直さないと他端末で切り替えた状態とズレる
function _showSettingsScreen() {
  updateAvatarUI();
  refreshPushPrefSection();
}

// 希望タブの有効・無効とラベル。受付期間外はタブ自体を押せなくする
let _formTabEnabled = true;
function setFormTabState(enabled, label, iconName) {
  _formTabEnabled = enabled;
  const btn = document.getElementById('tab-form');
  if (!btn) return;
  btn.disabled = !enabled;
  const icEl = btn.querySelector('.tab-ic');
  const nm = btn.querySelector('.tab-n');
  if (icEl) icEl.innerHTML = ic(iconName);
  if (nm) nm.textContent = label;
  btn.title = enabled ? '' : 'いまは受付期間外です';
}

// タブ切り替え。タブ間の移動では履歴を積まず、常に
// 「ホーム → 今のタブ」という1段だけの履歴に正規化する。
// こうすることで、どのタブにいても戻るボタン1回でホームに着く。
//
// history.go() は非同期で、popstate が飛ぶまで移動は完了しない。
// 「go したつもりの位置」を前提に続けて pushState すると、実際にはまだ
// 移動が終わっておらず履歴が壊れる（戻るとホームを通り越して
// アプリ終了確認まで飛ぶ）。そのため戻りが必要な場合は
// _pendingTab に積んで、popstate で着地を確認してから続きを行う
function switchTab(tab) {
  if (_pendingTab) return;               // 移動中の二重タップは無視
  if (tab === _currentTab) {
    const root = TAB_ROOT_SCREEN[tab];
    // シフト詳細は入口と同じ screen 名を共有するため、HistoryのsubScreenも見る。
    // screen名だけで判定すると詳細表示中も入口と誤認してしまう。
    const isSubScreen = !!(history.state && history.state.subScreen);
    if (_currentScreenName === root && !isSubScreen && _tabDepth <= 1) {
      window.scrollTo(0, 0);
      return;
    }
    // 別タブから戻った後など、選択中タブの詳細を表示している状態でもう一度
    // 同じタブを押したら、そのタブの入口へ戻す。次回も古い詳細を復元しない。
    delete _tabSnapshots[tab];
    if (_tabDepth >= 2) history.go(-(_tabDepth - 1));
    else {
      showScreen(root, true, tab === 'home' ? 0 : 1);
      history.replaceState({ screen: root, tab, depth: tab === 'home' ? 0 : 1 }, '');
    }
    return;
  }
  _rememberCurrentTab();
  if (_tabDepth >= 2) {
    // タブ内の詳細にいる：まずタブ入口（深さ1）まで戻り、着地後に続ける
    _pendingTab = tab;
    history.go(-(_tabDepth - 1));
    return;
  }
  _applyTab(tab);
}

// 深さ0（ホーム）または深さ1（タブ入口）から目的のタブへ移る
function _applyTab(tab) {
  if (tab === 'home') {
    // 深さ1なら1段戻ればホーム。popstate 側が画面を戻す
    if (_tabDepth === 1) history.back();
    return;
  }
  _showRememberedTab(tab);
}

function _rememberCurrentTab() {
  if (!_currentTab || _currentScreenName === 'register') return;
  const state = Object.assign({}, history.state || {}, {
    screen: _currentScreenName,
    tab: _currentTab,
    depth: _tabDepth,
  });
  const snap = { screen: _currentScreenName, depth: _tabDepth, state, scrollY: window.scrollY };
  if (_currentTab === 'shift' && shiftViewingDate) {
    snap.shiftDate = shiftViewingDate.date;
    snap.shiftTime = shiftViewingDate.time;
  }
  _tabSnapshots[_currentTab] = snap;
}

function _showRememberedTab(tab) {
  const root = TAB_ROOT_SCREEN[tab];
  const snap = _tabSnapshots[tab];
  const rootState = { screen: root, tab, depth: tab === 'home' ? 0 : 1 };
  const wasHome = _tabDepth === 0;

  // 現在の1段を対象タブの入口に置き換える。ホームから来た場合だけ1段積む。
  showScreen(root, true, rootState.depth, !!snap);
  if (wasHome) history.pushState(rootState, '');
  else history.replaceState(rootState, '');

  if (snap && snap.depth >= 2) {
    showScreen(snap.screen, true, snap.depth, true);
    history.pushState(snap.state, '');
    syncTabUi(snap.screen, snap.depth);
    if (tab === 'shift' && snap.shiftDate) {
      const d = ((SHIFT_DATA && SHIFT_DATA.dates) || []).find(
        x => x.date === snap.shiftDate && x.time === snap.shiftTime
      );
      if (d) {
        shiftViewingDate = d;
        document.getElementById('shift-date-list').style.display = 'none';
        document.getElementById('shift-detail-view').style.display = 'block';
        _setShiftBackBar(true);
        document.getElementById('shift-back-btn').onclick = () => _shiftDetailBack();
        buildShiftDetail(d);
      }
    }
  } else if (snap) {
    history.replaceState(snap.state, '');
    syncTabUi(snap.screen, snap.depth);
  }
  setTimeout(() => window.scrollTo(0, snap ? snap.scrollY : 0), 0);
}

// 戻るボタン（ブラウザ・スマホ）が押されたとき
window.addEventListener('popstate', function(e) {
  if (_historyNormalizeResolve) {
    const resolve = _historyNormalizeResolve;
    _historyNormalizeResolve = null;
    resolve();
    return;
  }
  // モーダルを直接閉じた際のpopstateを抑制（履歴エントリ除去のhistry.go(-1)由来）
  if (_suppressNextPopstate) {
    _suppressNextPopstate = false;
    // 「閉じ終わったらタブへ移る」など、戻りの完了を待っていた処理をここで行う。
    // go(-1) の完了前に実行すると履歴が壊れるため、必ずこの時点まで待つ
    const after = _afterPopstate;
    _afterPopstate = null;
    if (after) after();
    return;
  }

  // モーダル・編集モードが履歴に積まれていた場合は閉じるだけで画面遷移しない
  if (_modalInHistory) {
    const which = _modalInHistory;
    _modalInHistory = null;
    if (which === 'help')        document.getElementById('help-overlay').classList.remove('show');
    else if (which === 'manual')   document.getElementById('manual-overlay').classList.remove('show');
    else if (which === 'notices')  document.getElementById('notices-modal').style.display = 'none';
    else if (which === 'roadPdf')  document.getElementById('road-pdf-view-modal').classList.remove('show');
    else if (which === 'adminPdf') {
      document.getElementById('admin-pdf-preview-overlay').style.display = 'none';
      document.getElementById('admin-pdf-preview-iframe').src = '';
    }
    else if (which === 'staffEdit')   exitStaffEditMode();
    else if (which === 'roadPdfEdit') document.getElementById('road-pdf-edit-overlay').classList.remove('show');
    else if (which === 'memberPreview') {
      document.getElementById('member-preview-overlay').style.display = 'none';
      document.getElementById('member-preview-modal').style.display   = 'none';
    }
    else if (which === 'photo') {
      document.getElementById('photo-modal-overlay').style.display = 'none';
      _photoList = []; _photoCurrent = 0;
    }
    else if (which === 'cancelInfo') document.getElementById('cancel-info-overlay').classList.remove('show');
    else if (which === 'pwaInstall') document.getElementById('pwa-install-overlay').classList.remove('show');
    else if (which === 'guide') document.getElementById('guide-overlay').classList.remove('show');
    else if (which === 'profile') {
      document.getElementById('profile-popup').classList.remove('show');
      document.getElementById('profile-overlay').classList.remove('show');
    }
    else if (which === 'avatarCrop') {
      document.getElementById('avatar-crop-overlay').classList.remove('show');
      if (_avCrop && _avCrop.src && typeof _avCrop.src.close === 'function') {
        try { _avCrop.src.close(); } catch (_) {}
      }
      _avCrop = null;
    }
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

  // ブラウザの「進む」でシフト詳細の履歴へ戻った場合は、同じ日時の詳細を再表示する。
  if (screen === 'shift' && state.subScreen === 'detail') {
    showScreen('shift', true, state.depth, true);
    const d = ((SHIFT_DATA && SHIFT_DATA.dates) || []).find(
      x => x.date === state.shiftDate && x.time === state.shiftTime
    );
    if (d) {
      shiftViewingDate = d;
      document.getElementById('shift-date-list').style.display = 'none';
      document.getElementById('shift-detail-view').style.display = 'block';
      _setShiftBackBar(true);
      document.getElementById('shift-back-btn').onclick = () => history.back();
      buildShiftDetail(d);
    }
    _resumePendingTab();
    return;
  }

  showScreen(screen, true, state.depth);
  const backSnap = _tabSnapshots[state.tab || SCREEN_TAB[screen]];
  if (backSnap && backSnap.screen === screen && backSnap.depth === state.depth) {
    setTimeout(() => window.scrollTo(0, backSnap.scrollY || 0), 0);
  }
  _resumePendingTab();
});

// タブ切り替えのために履歴を戻していた場合、着地を確認できたこの時点で
// 残りの切り替えを行う（switchTab のコメント参照）
function _resumePendingTab() {
  if (!_pendingTab) return;
  const tab = _pendingTab;
  _pendingTab = null;
  _applyTab(tab);
}

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
  // 共通セッションと救済ログインも併せて破棄する（3アプリ共通のログアウト）。
  // 端末トークンは残す。再申請時に同じ端末だと分かるようにするため
  pwgwsClearSession();
}


// ============================================================
// 救済ログイン
//
// 申請とパスコード入力の画面は共通ログイン画面（login.html）に移した。
// ここに残しているのは「発行済みの救済セッションでログイン状態を復元する」処理だけ
// ============================================================
const REC_SESSION_KEY = 'pwgws_recovery_session';

// 保存済みの救済セッションでログインを試みる。
// 有効期限はサーバー側で管理しているため、起動のたびに必ず問い合わせる
async function tryRecoverySession() {
  let token = '';
  try { token = localStorage.getItem(REC_SESSION_KEY) || ''; } catch (_) {}
  if (!token) return false;
  try {
    const res = await apiGet('validateRecoverySession', {});
    if (!res.ok) {
      try { localStorage.removeItem(REC_SESSION_KEY); } catch (_) {}
      return false;
    }
    SESSION = {
      uid: res.uid, name: res.name, email: res.email || '', token: pwgwsGetSessionToken(),
      isAdmin: res.isAdmin, isResponsible: res.isResponsible,
      isCart: res.isCart, isAccountant: res.isAccountant || false,
      positionName: res.positionName || '', extraCaps: res.extraCaps || [],
      proxyTargets: res.proxyTargets || [], picture: '', isRecoverySession: true
    };
    await initApp();
    // 期限が近づいたらメールアドレス変更を促す
    if (res.daysLeft <= 7) {
      setTimeout(() => alert(
        'この一時ログインはあと ' + res.daysLeft + '日で終了します。\n' +
        '区域係に連絡して、新しいメールアドレスへの変更をお願いしてください。'
      ), 800);
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ===== 初回登録 =====
function buildRegisterScreen(members, email, token, displayName, picture) {
  const sel = document.getElementById('sel-register-name');
  sel.innerHTML = '<option value="">-- 選択してください --</option>';
  members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = String(m.memberId);
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
  const memberId = sel.value;
  const email = sel.dataset.email;
  if (!memberId) { alert('名前を選択してください。'); return; }
  const btn = document.getElementById('btn-register');
  btn.disabled = true;
  showLoading('登録中...');
  try {
    const data = await apiGet('register', { memberId: memberId });
    if (!data.ok) throw new Error(data.error || '登録に失敗しました');
    const picture = sel.dataset.picture || '';
    SESSION = {
      uid: data.uid, name: data.name, email: data.email || email, token: pwgwsGetSessionToken(),
      isAdmin: data.isAdmin, isResponsible: data.isResponsible,
      isCart: data.isCart, isAccountant: data.isAccountant || false,
      positionName: data.positionName || '', extraCaps: data.extraCaps || [],
      proxyTargets: data.proxyTargets || [],
      picture: picture, avatar: '', avatarIsCustom: false, avatarIsPrivate: false, avatarHasGoogle: false
    };
    saveSession({ email: data.email || email, token: pwgwsGetSessionToken(), picture: picture });
    pwgwsSaveSession(data.email || email, data.name, picture);
    // ここで初めて uid が確定するため、ログイン時に保存できなかった
    // Googleのアイコンをこのタイミングでサーバーに保存する
    if (picture) {
      try { await apiGet('saveGoogleAvatar', { pictureUrl: picture }); } catch (_) {}
    }
    await initApp();
  } catch (e) {
    await hideLoading();
    const msg = document.getElementById('register-msg');
    msg.className = 'msg error';
    msg.innerHTML = ic('triangle-alert', {color:'#B45309'}) + ' ' + esc(e.message);
    btn.disabled = false; btn.textContent = '登録する';
  }
}

// ===== アイコンの設定 =====
//
// 端末の写真はそのままだと数MBあるので、送る前にブラウザ側で切り抜いて縮める。
// どこを切り抜くかは本人に決めてもらう（顔の位置は写真によってばらばらで、
// 中央固定だと意図した部分が入らないことが多いため）。
//
// 表示・切り抜きとも canvas に同じ元画像を描く。<img> と canvas で
// 写真の向き（EXIF）の扱いが食い違うことがあり、画面で見た通りに
// 切り抜けなくなるのを避けるため
const AVATAR_UPLOAD_PX = 256;
const AVATAR_MAX_ZOOM  = 4;

// 切り抜き中の状態。{ src, w, h, zoom, tx, ty, frame, canvas, ctx }
let _avCrop = null;

function pickAvatarFile() {
  if (_isPreviewMode) { alert('閲覧中はアイコンを変更できません。'); return; }
  document.getElementById('avatar-file-input').click();
}

// 写真の向きを反映した描画元を作る。createImageBitmap が使えない端末では
// <img> にそのまま落とす（その場合も表示と切り抜きで同じものを使う）
async function _loadImageSource(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { src: bmp, w: bmp.width, h: bmp.height };
    } catch (_) { /* 未対応のときは下の方法にする */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload  = () => resolve(el);
      el.onerror = () => reject(new Error('画像として開けませんでした'));
      el.src = url;
    });
    return { src: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function onAvatarFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // 同じ写真をもう一度選んでも反応するように毎回リセットする
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('画像ファイルを選んでください。'); return; }

  showLoading('画像を読み込み中...');
  try {
    const loaded = await _loadImageSource(file);
    if (!loaded.w || !loaded.h) throw new Error('画像の大きさを取得できませんでした');
    await hideLoading();
    _openAvatarCrop(loaded);
  } catch (err) {
    await hideLoading();
    alert('画像を読み込めませんでした: ' + err.message);
  }
}

function _openAvatarCrop(loaded) {
  const overlay = document.getElementById('avatar-crop-overlay');
  const canvas  = document.getElementById('avatar-crop-canvas');
  overlay.classList.add('show');

  // 枠の大きさは画面幅で変わるので、表示してから実寸を測る
  const frame = Math.round(canvas.parentNode.getBoundingClientRect().width);
  const dpr   = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width  = Math.round(frame * dpr);
  canvas.height = Math.round(frame * dpr);

  _avCrop = {
    src: loaded.src, w: loaded.w, h: loaded.h,
    zoom: 1, tx: 0, ty: 0, frame, dpr, canvas,
    ctx: canvas.getContext('2d'),
  };
  document.getElementById('avatar-crop-zoom').value = 1;
  _avCropRedraw();
  history.pushState({ screen: _currentScreenName, modal: 'avatarCrop' }, '');
  _modalInHistory = 'avatarCrop';
}

function closeAvatarCrop() {
  document.getElementById('avatar-crop-overlay').classList.remove('show');
  // ImageBitmap は明示的に閉じないとメモリを持ち続ける
  if (_avCrop && _avCrop.src && typeof _avCrop.src.close === 'function') {
    try { _avCrop.src.close(); } catch (_) {}
  }
  _avCrop = null;
  if (_modalInHistory === 'avatarCrop') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
}

// 枠を完全に覆う最小倍率。これを 1 として、そこから拡大していく
function _avCropBaseScale() {
  return Math.max(_avCrop.frame / _avCrop.w, _avCrop.frame / _avCrop.h);
}

// 枠の外に隙間ができないよう、動かせる範囲に収める
function _avCropClamp() {
  const s = _avCropBaseScale() * _avCrop.zoom;
  const maxX = Math.max(0, (_avCrop.w * s - _avCrop.frame) / 2);
  const maxY = Math.max(0, (_avCrop.h * s - _avCrop.frame) / 2);
  _avCrop.tx = Math.min(maxX, Math.max(-maxX, _avCrop.tx));
  _avCrop.ty = Math.min(maxY, Math.max(-maxY, _avCrop.ty));
}

// 枠に写っている部分が、元画像のどこにあたるかを返す。
// 計算誤差で1px でも画像の外に出ると drawImage が何も描かなくなるので、
// 必ず画像の内側に収まるように丸める
function _avCropSourceRect() {
  const s = _avCropBaseScale() * _avCrop.zoom;
  const side = Math.min(_avCrop.frame / s, _avCrop.w, _avCrop.h);
  const sx = _avCrop.w / 2 - (_avCrop.frame / 2 + _avCrop.tx) / s;
  const sy = _avCrop.h / 2 - (_avCrop.frame / 2 + _avCrop.ty) / s;
  return {
    sx: Math.min(Math.max(0, sx), _avCrop.w - side),
    sy: Math.min(Math.max(0, sy), _avCrop.h - side),
    sw: side, sh: side,
  };
}

function _avCropRedraw() {
  if (!_avCrop) return;
  _avCropClamp();
  const { ctx, canvas } = _avCrop;
  const r = _avCropSourceRect();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(_avCrop.src, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
}

function onAvatarZoomInput(v) {
  if (!_avCrop) return;
  _avCrop.zoom = Math.min(AVATAR_MAX_ZOOM, Math.max(1, parseFloat(v) || 1));
  _avCropRedraw();
}

// ドラッグで移動、2本指で拡大縮小
const _avPointers = new Map();
let _avPinchStart = null;

function onAvatarPointerDown(e) {
  if (!_avCrop) return;
  e.currentTarget.setPointerCapture(e.pointerId);
  _avPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (_avPointers.size === 2) {
    const [a, b] = [..._avPointers.values()];
    _avPinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: _avCrop.zoom };
  }
}

function onAvatarPointerMove(e) {
  if (!_avCrop || !_avPointers.has(e.pointerId)) return;
  const prev = _avPointers.get(e.pointerId);
  _avPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (_avPointers.size >= 2 && _avPinchStart) {
    const [a, b] = [..._avPointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (_avPinchStart.dist > 0) {
      _avCrop.zoom = Math.min(AVATAR_MAX_ZOOM,
        Math.max(1, _avPinchStart.zoom * (dist / _avPinchStart.dist)));
      document.getElementById('avatar-crop-zoom').value = _avCrop.zoom;
    }
  } else {
    _avCrop.tx += e.clientX - prev.x;
    _avCrop.ty += e.clientY - prev.y;
  }
  _avCropRedraw();
}

function onAvatarPointerUp(e) {
  _avPointers.delete(e.pointerId);
  if (_avPointers.size < 2) _avPinchStart = null;
}

async function confirmAvatarCrop() {
  if (!_avCrop) return;
  const r = _avCropSourceRect();
  const cv = document.createElement('canvas');
  cv.width = cv.height = AVATAR_UPLOAD_PX;
  cv.getContext('2d').drawImage(_avCrop.src, r.sx, r.sy, r.sw, r.sh,
                                0, 0, AVATAR_UPLOAD_PX, AVATAR_UPLOAD_PX);
  const imageData = cv.toDataURL('image/jpeg', 0.85);
  closeAvatarCrop();

  showLoading('アイコンを設定中...');
  try {
    const res = await apiPost('saveCustomAvatar', {
      uid: SESSION.uid, email: SESSION.email, imageData,
    });
    if (!res.ok) throw new Error(res.error || '保存に失敗しました');
    SESSION.avatar = imageData;
    SESSION.avatarIsCustom = true;
    updateAvatarUI();
    await hideLoading();
  } catch (err) {
    await hideLoading();
    alert('アイコンの設定に失敗しました: ' + err.message);
  }
}

// 他の人に見せるかどうかの切り替え。画像は消さないので、
// OFF に戻せばまた見えるようになる
async function onAvatarPrivacyToggle() {
  const el = document.getElementById('avatar-private-toggle');
  if (!el || !SESSION || !SESSION.uid) return;
  const next = el.checked;
  el.disabled = true;
  try {
    const res = await apiPost('setAvatarPrivacy', {
      uid: SESSION.uid, email: SESSION.email, isPrivate: next,
    });
    if (!res.ok) throw new Error(res.error || '保存に失敗しました');
    SESSION.avatarIsPrivate = next;
  } catch (err) {
    el.checked = !next; // 保存できていないのに切り替わったまま見えるのを防ぐ
    alert('設定の保存に失敗しました: ' + err.message);
  } finally {
    el.disabled = false;
  }
}

// 「既定に戻す」は表示の切り替えではなく、設定したアイコンをサーバーから削除する
// （handlers_avatar.ts の hDeleteAvatar が image_data を Google のもので上書きする。
//   カスタム画像の退避先が無いため、押したら二度と戻せない）。
// 同じ設定画面の「他の人に見せない」トグルは画像を消さない作りで元に戻せるため、
// ユーザーはこの画面の操作を可逆だと思い込みやすい。文面で必ず破棄だと伝える
async function resetAvatar() {
  const hasGoogle = !!SESSION.avatarHasGoogle;
  if (!confirm(hasGoogle
      ? '設定したアイコンを削除して、Googleアカウントのアイコンに戻しますか？\n削除したアイコンは元に戻せません（戻すには設定し直してください）。'
      : '設定したアイコンを削除しますか？\n削除したアイコンは元に戻せません（戻すには設定し直してください）。\nGoogleのアイコンは次回ログイン時に設定されます。')) return;
  showLoading('アイコンを戻しています...');
  try {
    // 保存済みのGoogleのアイコンがあれば、サーバー側でそれに入れ替えて返してくれる
    const res = await apiPost('deleteAvatar', { uid: SESSION.uid, email: SESSION.email });
    if (!res.ok) throw new Error(res.error || '削除に失敗しました');
    SESSION.avatar = res.image || '';
    SESSION.avatarIsCustom = false;
    SESSION.avatarIsPrivate = false;
    updateAvatarUI();
    await hideLoading();
  } catch (err) {
    await hideLoading();
    alert('アイコンを戻せませんでした: ' + err.message);
  }
}

// ===== プロフィールポップアップ =====
function updateAvatarUI() {
  if (!SESSION) return;
  // サーバーに保存済みのアイコンを優先する。Googleの picture URL は
  // 本人がGoogle側でアイコンを変えると切れるため、あくまで保存前の代替として使う
  const pic = SESSION.avatar || SESSION.picture || '';
  // アイコンを消した直後など、写真が無い状態にも必ず戻せるようにする
  const showFallback = () => {
    document.querySelectorAll('.hdr-avatar').forEach(el => {
      el.innerHTML = '<span class="hdr-avatar-fallback">' + ic('user') + '</span>';
    });
    [['pp-avatar', 22], ['set-avatar', 24]].forEach(([id, size]) => {
      const av = document.getElementById(id);
      if (av) av.innerHTML = '<span style="font-size:' + size + 'px;">' + ic('user') + '</span>';
    });
  };

  // すべての画面のヘッダーアバターを更新（ページ遷移後も維持）
  if (_isPreviewMode || !pic) {
    showFallback();
  } else {
    document.querySelectorAll('.hdr-avatar').forEach(el => {
      const img = document.createElement('img');
      img.src = pic;
      img.alt = SESSION.name || '';
      img.onerror = () => { el.innerHTML = '<span class="hdr-avatar-fallback">' + ic('user') + '</span>'; };
      el.innerHTML = '';
      el.appendChild(img);
    });
    // ポップアップと設定タブ、同じ写真を出す2箇所をまとめて更新する
    [['pp-avatar', 22], ['set-avatar', 24]].forEach(([id, size]) => {
      const av = document.getElementById(id);
      if (!av) return;
      const img = document.createElement('img');
      img.src = pic;
      img.alt = SESSION.name || '';
      img.onerror = () => { av.innerHTML = '<span style="font-size:' + size + 'px;">' + ic('user') + '</span>'; };
      av.innerHTML = '';
      av.appendChild(img);
    });
  }

  // 変更ボタンとアイコンの設定欄は、閲覧中（他人の画面）には出さない
  const avBtn = document.getElementById('set-avatar-btn');
  if (avBtn) avBtn.style.display = _isPreviewMode ? 'none' : '';

  // 設定欄はアイコンが登録されているときだけ意味がある
  const hasAvatar = !!SESSION.avatar;
  const grp = document.getElementById('avatar-grp');
  if (grp) grp.style.display = (hasAvatar && !_isPreviewMode) ? '' : 'none';
  const privToggle = document.getElementById('avatar-private-toggle');
  if (privToggle) privToggle.checked = !!SESSION.avatarIsPrivate;
  // 「見せない」にしたとき他の人に何が見えるのかは、ここでしか伝えられない
  const privDesc = document.getElementById('avatar-private-desc');
  if (privDesc) {
    privDesc.textContent = SESSION.avatarHasGoogle
      ? '自分の画面にだけ表示し、管理画面や他の人にはGoogleアカウントのアイコンが出ます'
      : '自分の画面にだけ表示し、管理画面や他の人からは頭文字になります';
  }
  const resetRow = document.getElementById('avatar-reset-row');
  if (resetRow) resetRow.style.display = SESSION.avatarIsCustom ? '' : 'none';
  // 役割バッジのHTML（ポップアップと設定タブで共用）
  //
  // 立ち位置に集約する。権限（管理者・会計者）は立ち位置から自動的に決まるので、
  // 立ち位置バッジと並べると同じことを二度言うことになる。
  // ここに出すのは
  //   ・立ち位置（無ければ「奉仕者」）
  //   ・立ち位置では表せない役割（責任者・カート担当）
  //   ・立ち位置からは説明できない権限（extraCaps＝この人だけ個別に付与された分）
  let rolesHtml;
  if (SESSION.isAdmin && !SESSION.uid) {
    // 管理アカウント（uidなし）：オーナーのみ
    rolesHtml = '<span class="badge badge-owner">オーナー</span>';
  } else {
    rolesHtml = SESSION.positionName
      ? '<span class="badge badge-pos">' + esc(SESSION.positionName) + '</span>'
      : '<span class="badge badge-staff">奉仕者</span>';
    if (SESSION.isResponsible) rolesHtml += '<span class="badge badge-resp">責任者</span>';
    if (SESSION.isCart)        rolesHtml += '<span class="badge badge-cart">カート担当</span>';
    (SESSION.extraCaps || []).forEach(cap => {
      rolesHtml += '<span class="badge ' + (cap === '会計者' ? 'badge-acct' : 'badge-admin') + '">' + esc(cap) + '</span>';
    });
  }
  // ポップアップ内情報と設定タブのプロフィールを同じ内容で埋める
  [['pp-name','pp-email','pp-roles'], ['set-name','set-email','set-roles']].forEach(([n, e, r]) => {
    const elN = document.getElementById(n);
    const elE = document.getElementById(e);
    const elR = document.getElementById(r);
    if (elN) elN.textContent = SESSION.name;
    if (elE) elE.textContent = SESSION.email;
    if (elR) elR.innerHTML   = rolesHtml;
  });
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
    history.pushState({ screen: _currentScreenName, modal: 'profile' }, '');
    _modalInHistory = 'profile';
  }
}
function closeProfilePopup() {
  document.getElementById('profile-popup').classList.remove('show');
  document.getElementById('profile-overlay').classList.remove('show');
  if (_modalInHistory === 'profile') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
}

// ===== プッシュ通知（Web Push） =====
// アプリが既に開いている状態で通知をタップされた場合、sw.jsのnotificationclickから
// postMessageで直接届く（openWindowだと既存タブを前面に出すだけでページ再読み込みが
// 起きず、?notif=パラメータでの判定が効かない端末があるため）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'openNotif') {
      openNotifFromTap(event.data.notifId);
    }
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// この端末で「通知を有効にする」を選んだのが誰かを残しておく。
// ブラウザのPush購読は、Service Workerの作り直しや購読の期限切れで
// 本人が何もしなくても消えることがある。購読の有無だけでトグルを描くと、
// その瞬間から「ONにしたはずなのにOFFに戻っている」ようにしか見えないため、
// 本人の意思はここに保存し、購読が消えていれば黙って作り直す。
const PUSH_INTENT_KEY = 'pwgws_push_enabled_uid';
function getPushIntentUid() {
  try { return localStorage.getItem(PUSH_INTENT_KEY) || ''; } catch (_) { return ''; }
}
function setPushIntentUid(uid) {
  try {
    if (uid) localStorage.setItem(PUSH_INTENT_KEY, uid);
    else localStorage.removeItem(PUSH_INTENT_KEY);
  } catch (_) {}
}

function pushSupported() {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}

// 起動直後は getRegistration() が undefined を返すことがある（登録は残っているのに
// まだ解決していない）。本人が通知をONにしている端末に限り、登録し直して確実に取得する
async function getPushRegistration() {
  if (!pushSupported()) return null;
  try {
    let reg = await navigator.serviceWorker.getRegistration('./sw.js');
    // 見つからないのに本人はONにしている＝登録が消えたか、まだ解決していない。
    // register() は既存があれば同じ登録を返すだけなので、この場合だけ登録し直す
    // （通知を使っていない人にまでService Workerを入れない）
    if (!reg && SESSION && SESSION.uid && getPushIntentUid() === SESSION.uid) {
      reg = await navigator.serviceWorker.register('./sw.js');
    }
    return reg || null;
  } catch (e) {
    console.error('[push] Service Workerの取得に失敗しました', e);
    return null;
  }
}

// 購読をサーバーへ登録する。成功したらこの端末の「ON」の意思も更新する
async function savePushSubscriptionToServer(sub) {
  const json = sub.toJSON();
  const res = await apiGet('savePushSubscription', {
    uid: SESSION.uid,
    endpoint: json.endpoint,
    p256dh: json.keys && json.keys.p256dh,
    auth: json.keys && json.keys.auth,
  });
  if (!res || !res.ok) throw new Error((res && res.error) || '登録に失敗しました');
  setPushIntentUid(SESSION.uid);
}

// 端末側の購読を取り出す。本人がONにしたはずなのに購読が消えている場合は、
// 通知の許可が残っている限り作り直す（許可ダイアログは出ない）。
// 作り直した購読はendpointが変わっているため、呼び出し側で
// サーバーへ登録し直す必要がある。それを isNew で伝える
async function getOrRestorePushSubscription(reg) {
  const sub = await reg.pushManager.getSubscription();
  if (sub) return { sub: sub, isNew: false };
  if (!SESSION || !SESSION.uid) return { sub: null, isNew: false };
  if (getPushIntentUid() !== SESSION.uid) return { sub: null, isNew: false };
  if (Notification.permission !== 'granted') { setPushIntentUid(''); return { sub: null, isNew: false }; }
  try {
    const fresh = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    return { sub: fresh, isNew: true };
  } catch (e) {
    console.error('[push] 購読の作り直しに失敗しました', e);
    return { sub: null, isNew: false };
  }
}

// ブラウザのPush購読はアカウントを切り替えても同じendpointのまま残る。
// 起動時に現在のprincipalへ必ず再送し、旧利用者への紐付けをサーバー側transactionで外す。
//
// 再紐付けに失敗したときに購読を解除してよいのは「この端末でONにした人」と
// 今の利用者が違うときだけ。同じ人なら通信不良が理由なので、解除すると
// 本人の設定が無言で消える（再読み込みのたびにトグルがOFFへ戻る）。
async function rebindExistingPushSubscription() {
  if (_isPreviewMode || !SESSION || !pushSupported()) return true;
  const reg = await getPushRegistration();
  if (!reg) return true;
  let sub = null;
  try {
    sub = (await getOrRestorePushSubscription(reg)).sub;
    if (!sub) return true;
    // owner のようにuidを持たないprincipalへはPushを紐付けられない。
    // 前アカウントの購読を残すとその人の通知が届くため、端末側購読を失効させる。
    if (!SESSION.uid) {
      await sub.unsubscribe();
      setPushIntentUid('');
      const ownerToggle = document.getElementById('push-enable-toggle');
      if (ownerToggle) ownerToggle.checked = false;
      return true;
    }
    await savePushSubscriptionToServer(sub);
    return true;
  } catch (e) {
    console.error('[push] endpointの再紐付けに失敗しました', e);
    const intentUid = getPushIntentUid();
    if (intentUid && intentUid === SESSION.uid) {
      // 同じ利用者の端末。サーバー側の紐付けも既にこの人なので、
      // 購読は残したまま次の起動でやり直す
      return false;
    }
    if (sub) {
      try { await sub.unsubscribe(); } catch (_) {}
    }
    setPushIntentUid('');
    const toggle = document.getElementById('push-enable-toggle');
    if (toggle) toggle.checked = false;
    alert('アカウント切替後の通知設定を更新できなかったため、この端末の通知を無効にしました。\n設定画面からもう一度有効にしてください。');
    return false;
  }
}

async function onPushEnableToggle() {
  const toggle = document.getElementById('push-enable-toggle');
  if (toggle.checked) {
    await enablePushNotifications();
  } else {
    await disablePushNotifications();
  }
}

async function enablePushNotifications() {
  const toggle = document.getElementById('push-enable-toggle');
  if (!pushSupported()) {
    alert('この端末・ブラウザは通知に対応していません');
    if (toggle) toggle.checked = false;
    return;
  }
  if (!SESSION || !SESSION.uid) {
    alert('ログインしてから設定してください');
    if (toggle) toggle.checked = false;
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    // subscribe() は有効なService Workerを要求する。登録直後は起動が
    // 終わっていないことがあるため、有効になるまで待ってから購読する。
    // ready が解決しない端末で操作が固まらないよう、待つのは10秒まで
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise(resolve => setTimeout(resolve, 10000)),
    ]);
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { alert('通知が許可されませんでした'); if (toggle) toggle.checked = false; return; }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await savePushSubscriptionToServer(sub);
    await refreshPushPrefSection();
  } catch (e) {
    alert('通知の設定に失敗しました: ' + e.message);
    if (toggle) toggle.checked = false;
  }
}

async function disablePushNotifications() {
  // 本人がOFFにした意思は、購読の解除に失敗しても必ず残す。
  // 残っていると次の起動で自動的に購読を作り直してしまう
  setPushIntentUid('');
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration('./sw.js');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        if (SESSION && SESSION.uid) {
          await apiGet('deletePushSubscription', { uid: SESSION.uid, endpoint });
        }
      }
    }
  } catch (e) { /* 解除失敗は無視（端末側の購読は消えている可能性が高いため） */ }
}

// 種類トグルは常に表示しておき（HTML側でデフォルトON）、購読・設定状況が分かり次第
// 「通知を有効にする」トグルと各トグルのチェック状態だけを更新する。
//
// 購読が消えていても本人がONにしたままなら作り直すので、
// 設定画面を開き直しただけでOFFに見えることはない
// 管理者向けの通知設定を出す相手か。オーナー（uidなし）はプッシュ購読自体ができないため対象外
function isAdminPrefUser() {
  return !!(SESSION && SESSION.isAdmin && SESSION.uid);
}

async function refreshPushPrefSection() {
  const enableToggle = document.getElementById('push-enable-toggle');
  // 管理者向けの項目は「どんなときに通知が来るか」を読む役目も兼ねるので、
  // 購読の状態に関わらず、表示するかどうかだけは先に決めておく
  const adminWrap = document.getElementById('admin-pref-wrap');
  if (adminWrap) adminWrap.classList.toggle('setgrp-hide', !isAdminPrefUser());
  if (!SESSION || !SESSION.uid) { if (enableToggle) enableToggle.checked = false; return; }
  try {
    const reg = await getPushRegistration();
    if (!reg) { if (enableToggle) enableToggle.checked = false; return; }
    const { sub, isNew } = await getOrRestorePushSubscription(reg);
    if (enableToggle) enableToggle.checked = !!sub;
    if (!sub) return;
    // 作り直した購読はサーバーがまだ知らない。失敗しても次の起動で
    // rebindExistingPushSubscription がやり直すので、ここでは握りつぶす
    if (isNew) { try { await savePushSubscriptionToServer(sub); } catch (_) {} }
    const res = await apiGet('getPushPreferences', { uid: SESSION.uid });
    if (!res.ok) return;
    document.getElementById('pref-published').checked = res.notifyPublished !== false;
    document.getElementById('pref-changed').checked   = res.notifyChanged   !== false;
    document.getElementById('pref-deadline').checked  = res.notifyDeadline  !== false;
    document.getElementById('pref-notice').checked    = res.notifyNotice    !== false;
    document.getElementById('pref-today').checked     = res.notifyToday     !== false;
    if (isAdminPrefUser()) {
      document.getElementById('pref-admin-task').checked   = res.notifyAdminTask   !== false;
      document.getElementById('pref-admin-status').checked = res.notifyAdminStatus !== false;
    }
  } catch (e) { /* 取得失敗時はデフォルト表示のまま */ }
}

async function onPushPrefChange() {
  if (!SESSION || !SESSION.uid) return;
  try {
    const params = {
      uid: SESSION.uid,
      notifyPublished: document.getElementById('pref-published').checked,
      notifyChanged:   document.getElementById('pref-changed').checked,
      notifyDeadline:  document.getElementById('pref-deadline').checked,
      notifyNotice:    document.getElementById('pref-notice').checked,
      notifyToday:     document.getElementById('pref-today').checked,
    };
    // 管理者以外は管理者向けの項目を送らない（API側は送られてこなかった項目に触れない）
    if (isAdminPrefUser()) {
      params.notifyAdminTask   = document.getElementById('pref-admin-task').checked;
      params.notifyAdminStatus = document.getElementById('pref-admin-status').checked;
    }
    await apiGet('savePushPreferences', params);
  } catch (e) { alert('設定の保存に失敗しました: ' + e.message); }
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
  history.pushState({ screen: _currentScreenName, modal: 'memberPreview' }, '');
  _modalInHistory = 'memberPreview';
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
      <span style="font-size:18px;">${m.gender === 'M' ? ic('mars') : ic('venus')}</span>
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
  if (_modalInHistory === 'memberPreview') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
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
      positionName: data.positionName || '', extraCaps: data.extraCaps || [],
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

// ===== アカウント切り替え =====
// メニューの実体は共有の session.js（3アプリで同じ見た目・同じ挙動にするため）。
// プロフィールポップアップは閉じずに重ねて出す。先に閉じると、位置決めの基準に
// している要素が消えてメニューが画面の左上に寄ってしまう
function openAccountMenu(el) {
  pwgwsOpenAccountMenu(el, { onSignOut: logout });
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
  _testLimitedTypes = [];
  { const picker = document.getElementById('test-limited-type-picker'); if (picker) { picker.classList.remove('show'); picker.innerHTML = ''; } }
  _mainHistorySetup = false; // 再ログイン時に __bottom__ を再挿入するためリセット
  closeProfilePopup();
  // ログアウト後は共通ログイン画面へ戻す
  pwgwsGoToLogin();
}

// ===== アプリ初期化 =====
// preload を渡すと isLimitedMember・dataMini・getFormDetail・getShiftTable の
// 再取得をせず、formBootstrap で取得済みのデータをそのまま使う（起動時専用）
async function initApp(preload) {
  initDebugDatePanel();
  // 初回起動時は起動スプラッシュを使う（ロゴのフェードのみ、文言は出さない）。
  // 再読み込みやメンバープレビュー切替時は通常のローディングオーバーレイのまま
  const isBoot = !_firstBootDone;
  if (!isBoot) showLoading('データを読み込み中...');
  // 再読み込み時は一旦通常PWとして再構築し、必要なら最後に限定PWビューへ戻す
  const prevPwType = currentPwType;
  _tabSnapshots = {};
  // フォーム・シフト詳細などからの再読込では、その深さ分だけ実際の履歴もmainまで戻す。
  // 現在エントリだけをmainへ置換すると、下に古いタブ履歴が残って戻る操作が壊れる。
  if (_mainHistorySetup && _tabDepth > 0) {
    const steps = _tabDepth;
    await new Promise(resolve => {
      _historyNormalizeResolve = resolve;
      history.go(-steps);
    });
    _currentScreenName = 'main';
    _currentTab = 'home';
    _tabDepth = 0;
  }
  currentPwType = 'normal';
  const _tabN = document.getElementById('pw-tab-form-normal');
  const _tabL = document.getElementById('pw-tab-form-limited');
  if (_tabN) _tabN.className = 'pw-type-tab-form active';
  if (_tabL) _tabL.className = 'pw-type-tab-form limited';
  try {
    // isLimitedMember チェックと dataMini・getFormDetail・getShiftTable を並列取得。
    // preload があれば formBootstrap で取得済みなので取り直さない
    const uid = SESSION ? SESSION.uid : '';
    const [limRes, formData, detail, shiftData] = preload
      ? await Promise.all([
          Promise.resolve(preload.limited),
          Promise.resolve(preload.formData),
          Promise.resolve(preload.detail),
          Promise.resolve(preload.shiftTable),
          rebindExistingPushSubscription()
        ])
      : await Promise.all([
          uid ? apiGet('isLimitedMember', { uid }) : Promise.resolve({ ok: true, isLimited: false }),
          apiGet('dataMini', { type: 'normal' }),
          apiGet('getFormDetail', { type: 'normal' }),
          apiGet('getShiftTable', { type: 'normal' }),
          rebindExistingPushSubscription()
        ]);

    isLimitedMember = limRes.ok && limRes.isLimited;
    if (isLimitedMember && limRes.type) limitedPwType = limRes.type;
    if (isLimitedMember && limRes.name) limitedPwName = limRes.name;

    // テストアカウント：限定PWメンバーでなくても全タイプを閲覧できるようにする
    if (SESSION && SESSION.email === TEST_EMAIL) {
      isLimitedMember = true;
      await loadTestLimitedTypePicker();
    }

    // 限定PWタブの表示制御
    const pwBar = document.getElementById('pw-type-bar-form');
    if (pwBar) pwBar.style.display = isLimitedMember ? 'flex' : 'none';
    const tabLimited = document.getElementById('pw-tab-form-limited');
    if (tabLimited && isLimitedMember) tabLimited.textContent = limitedPwName;

    // 限定PWメンバーの場合は統合カレンダー用に限定PW側データも取得
    if (isLimitedMember) await _loadLimitedPwData(limitedPwType);

    // 通常／限定PWのどちらでも同じ形を参照できるよう、詳細APIの共通mapを
    // その表示中データへ載せる。旧データ構造（thisMonthData等）は比較に使わない。
    formData.crossPwConflicts = detail.crossPwConflicts || formData.crossPwConflicts || {};
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

    try {
      buildMainScreen();
    } catch (buildErr) {
      console.error('buildMainScreen error:', buildErr);
      if (isBoot) { hideBootSplash(); _firstBootDone = true; } else { await hideLoading(); }
      alert('画面の構築に失敗しました: ' + buildErr.message);
      return;
    }
    if (isBoot) { hideBootSplash(); _firstBootDone = true; } else { await hideLoading(); }
    // 初回だけ番兵＋mainを積む。再読込・プレビュー切替では現在位置をmainへ
    // 置き換え、同じmainエントリを何段も増やさない。
    if (_mainHistorySetup) {
      history.replaceState({ screen: 'main', tab: 'home', depth: 0 }, '');
      showScreen('main', true, 0);
    } else {
      showScreen('main');
    }
    // 再読み込み前に限定PWを見ていた場合はビューを復元（タブと表示内容のズレを防ぐ）
    if (prevPwType !== 'normal' && isLimitedMember) {
      await switchFormPwType(prevPwType);
    }
    startUpdateChecker();

    // 通知タップで開かれた場合（?notif=<id>）、その内容を最初に表示する
    const notifParam = new URLSearchParams(location.search).get('notif');
    if (notifParam) {
      history.replaceState({}, '', location.pathname);
      await openNotifFromTap(notifParam);
    }
  } catch (e) {
    if (isBoot) { hideBootSplash(); _firstBootDone = true; } else { hideLoading(); }
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
  // 公開予定日の推測に加え、サーバー側が実際に公開済み（早期の手動公開含む）ならそれを優先する
  const isOpenPassed   = (openD && openD.getTime() <= today.getTime()) || isShiftPublishedForShownMonth();

  // ── 希望タブ：受付中のみ有効。締切後・公開後・準備中は押せなくする ──
  // タブは常に5つ並べたままにして（数が変わるとバーの並びがずれて押し間違えるため）、
  // 使えないときは無効化し、ラベルで今どの状態かを示す
  // 自分（またはオーナー以外）の今月送信済みデータ確認
  const myUid = SESSION ? SESSION.uid : '';
  const hasSentThisMonth = myUid && THIS_MONTH[myUid] &&
    !!THIS_MONTH[myUid].timestamp;
  if (isOwner || _isPreviewMode) {
    // オーナー・プレビュー中：日程条件を無視して常に開ける（フォームは読み取り専用）
    if (isOwner && !_isPreviewMode)   setFormTabState(true,  '希望',   'eye');
    else if (hasSentThisMonth)        setFormTabState(true,  '希望',   'pencil');
    else                              setFormTabState(true,  '希望',   'square-pen');
  } else if (isOpenPassed || status === '受付終了') {
    setFormTabState(false, '希望', 'square-pen');
  } else if (status === '受付中') {
    setFormTabState(true, '希望', hasSentThisMonth ? 'pencil' : 'square-pen');
  } else {
    // 準備中
    setFormTabState(false, '希望', 'square-pen');
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
    sv.innerHTML = ic('lock') + ' 締切日';
    sv.classList.add('status-closed');
    sv.style.color = 'var(--danger)';
    sd.innerHTML = '';
  } else if (status === '受付中') {
    sv.innerHTML = ic('circle-check-big', {color:'#15803D'}) + ' 受付中';
    sv.classList.add('status-open');
    sd.innerHTML = '';
  } else if (status === '準備中') {
    sv.innerHTML = ic('hourglass') + ' 受付準備中';
    sv.classList.add('status-prep');
    sd.textContent = '';
  } else {
    sv.innerHTML = ic('lock') + ' 受付終了';
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

  // ── 展示内容写真カード（起動をブロックしないよう非同期で読み込む） ──
  loadExhibitPhotoCard(isOpenPassed);

  // ── お知らせ（ヘッダーのベルアイコン＋バッジに集約） ──
  _currentNotices = APP_DATA.notices || [];
  updateNoticeBadge();
  refreshNotifUnreadCount();
}

// ===== 通知履歴（システム自動通知。既存の「お知らせ」＝noticesとは別データ） =====
let _notifHistoryItems = [];
let _notifUnreadCount  = 0;

function updateNoticeBadge() {
  const badge = document.getElementById('notice-badge');
  if (!badge) return;
  const n = (_currentNotices || []).length + (_notifUnreadCount || 0);
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.style.display = n > 0 ? 'flex' : 'none';
}

async function refreshNotifUnreadCount(notifId) {
  if (!SESSION || !SESSION.uid) return;
  try {
    const params = { uid: SESSION.uid };
    if (notifId) params.notifId = notifId;
    const res = await apiGet('getNotificationLog', params);
    if (!res.ok) return;
    _notifHistoryItems = res.items || [];
    _notifUnreadCount  = res.unreadCount || 0;
    updateNoticeBadge();
  } catch (e) { /* バッジ更新の失敗は無視 */ }
}

function renderNotifHistory() {
  const body = document.getElementById('notif-history-body');
  const list = _notifHistoryItems || [];
  body.innerHTML = list.length > 0
    ? list.map(n => `<div class="notice-item notif-clickable${n.is_read ? '' : ' notif-unread'}" onclick="openNotifDetail(${n.id})">
        <div class="notice-date">${esc(new Date(n.created_at).toLocaleString('ja-JP', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</div>
        <div class="notice-title">${esc(n.title)}</div>
        <div class="notice-body">${esc(n.body)}</div>
      </div>`).join('')
    : '<div style="text-align:center;color:var(--sub);padding:20px;font-size:14px;">通知履歴はありません</div>';
}

// 通知履歴の1件を詳細表示する（一覧の項目クリック、または通知タップ時の直接遷移で使う）
function openNotifDetail(id) {
  const item = (_notifHistoryItems || []).find(n => n.id === id);
  const body = document.getElementById('notif-history-body');
  if (!item) { renderNotifHistory(); return; }
  body.innerHTML = `
    <button class="notif-detail-back" onclick="renderNotifHistory()">‹ 通知履歴に戻る</button>
    <div class="notice-item" style="border-bottom:none;">
      <div class="notice-date">${esc(new Date(item.created_at).toLocaleString('ja-JP', {year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</div>
      <div class="notice-title">${esc(item.title)}</div>
      <div class="notice-body">${esc(item.body)}</div>
    </div>`;
}

// 通知タップ（?notif=<id> または postMessage）から開く場合：最新データを取得してから
// 通知履歴タブでその項目の詳細へ直接遷移する
async function openNotifFromTap(notifId) {
  await refreshNotifUnreadCount(notifId);
  openNoticesModal('history');
  const id = parseInt(notifId, 10);
  if (id) openNotifDetail(id);
}

async function switchNotifTab(tab) {
  // 通知設定は「設定」タブへ移設したため、このモーダルは
  // お知らせ／通知履歴 の2つだけを持つ
  if (tab === 'settings') tab = 'notices';
  ['notices','history'].forEach(t => {
    const el = document.getElementById('notif-tab-' + t);
    if (el) el.classList.toggle('on', t === tab);
  });
  document.getElementById('notices-modal-body').style.display   = tab === 'notices'  ? '' : 'none';
  document.getElementById('notif-history-body').style.display   = tab === 'history'  ? '' : 'none';

  if (tab === 'history') {
    renderNotifHistory();
    if (_notifUnreadCount > 0 && SESSION && SESSION.uid) {
      await apiGet('markNotificationsRead', { uid: SESSION.uid });
      (_notifHistoryItems || []).forEach(n => { n.is_read = true; });
      _notifUnreadCount = 0;
      updateNoticeBadge();
      renderNotifHistory();
    }
  }
}

function openNoticesModal(tab) {
  const modal = document.getElementById('notices-modal');
  const body  = document.getElementById('notices-modal-body');
  const list  = _currentNotices || [];
  body.innerHTML = list.length > 0
    ? list.map(n => `<div class="notice-item">
        <div class="notice-date">${esc(n.date)}</div>
        <div class="notice-title">${esc(n.title)}</div>
        <div class="notice-body">${esc(n.body)}</div>
      </div>`).join('')
    : '<div style="text-align:center;color:var(--sub);padding:20px;font-size:14px;">お知らせはありません</div>';
  modal.style.display = 'flex';
  history.pushState({ screen: _currentScreenName, modal: 'notices' }, '');
  _modalInHistory = 'notices';
  switchNotifTab(tab || 'notices');
}

function closeNoticesModal() {
  document.getElementById('notices-modal').style.display = 'none';
  if (_modalInHistory === 'notices') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
    return true;   // 履歴を1段戻した（完了は popstate 後）
  }
  return false;
}

// お知らせモーダルから通知設定（設定タブ）へ移る。
// closeNoticesModal() の history.go(-1) は非同期なので、続けて
// switchTab を呼ぶと戻りの完了前に履歴を積んで壊れる。
// 戻り終わってから切り替えるよう _afterPopstate に預ける
function openNotifSettings() {
  if (closeNoticesModal()) _afterPopstate = () => switchTab('more');
  else switchTab('more');
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

  // isOpenPassedForCalは公開予定日から推測した日付ベースの判定でしかないため、
  // 管理者が予定日より前に手動で公開した場合はSHIFT_DATA.published（サーバー側の
  // 実際の公開フラグ）があればそちらを優先する
  isOpenPassedForCal = isOpenPassedForCal || isShiftPublishedForShownMonth();

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

  // 通常PW 実施日（表示月分）と時間帯マップ。SHIFT_DATES/SHIFT_DATES_MAP は
  // 「申込を受け付けている月」のスロット（dataMini由来）だが、シフトが動いている月は
  // それとは別の月のことがある（今月のシフトが動いている最中に来月の申込が始まる）ため、
  // 表示月の実施日が無いときはシフト表（SHIFT_DATA）からフォールバックする。
  // 統合カレンダー（isLimitedMember）・単独カレンダーの両方でこのデータを使う
  const normalShiftDaysInMonth = new Set();
  const normalShiftTimesMap = {}; // 'm_d' -> [time,...]
  SHIFT_DATES.forEach(dateStr => {
    const p = dateStr.split('/');
    if (p.length !== 2 || parseInt(p[0]) !== dispM) return;
    const key = parseInt(p[0]) + '_' + parseInt(p[1]);
    normalShiftDaysInMonth.add(key);
    normalShiftTimesMap[key] = (SHIFT_DATES_MAP[key] || []).slice();
  });
  if (normalShiftDaysInMonth.size === 0) {
    (SHIFT_DATA && SHIFT_DATA.dates || []).forEach(d => {
      const p = d.date.split('/');
      if (p.length !== 2) return;
      const m = parseInt(p[0]), day = parseInt(p[1]);
      if (m !== dispM) return;
      const key = m + '_' + day;
      normalShiftDaysInMonth.add(key);
      if (!normalShiftTimesMap[key]) normalShiftTimesMap[key] = [];
      if (d.time && !normalShiftTimesMap[key].includes(d.time)) normalShiftTimesMap[key].push(d.time);
    });
  }

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
        isShiftNorm    = isLimitedPw2 ? false : normalShiftDaysInMonth.has(keyNorm);
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
          const normTimes = normalShiftTimesMap[keyNorm] || [];
          const ltdTimes  = (shiftDaysMapLtd && shiftDaysMapLtd[keyLtd2]) || [];

          if (isShiftNorm) {
            const row = document.createElement('div');
            row.className = 'cal-shift-row csr-normal';
            row.innerHTML = ic('__dot__', {color:'#16a34a'}) + ' PW' + (normTimes.length > 1 ? ' ' + normTimes.length + '件'
                                        : normTimes.length === 1 ? ' ' + esc(normTimes[0]) : '');
            el.appendChild(row);
          }
          if (isShiftLtdHere) {
            const row = document.createElement('div');
            row.className = 'cal-shift-row csr-limited';
            row.innerHTML = ic('__dot__', {color:'#9333ea'}) + ' 限定' + (ltdTimes.length > 1 ? ' ' + ltdTimes.length + '件'
                                          : ltdTimes.length === 1 ? ' ' + esc(ltdTimes[0]) : '');
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
          const times = isLimitedPw2
            ? (shiftDaysMapLtd && shiftDaysMapLtd[key] || [])
            : (normalShiftTimesMap[key] || []);
          if (times.length > 0) {
            const countEl = document.createElement('span');
            countEl.className   = 'cal-count';
            countEl.textContent = times.length + '件';
            el.appendChild(countEl);
          }

          if (myShiftDays.has(key)) {
            const badge = document.createElement('div');
            badge.className = 'cal-badge my-shift';
            el.appendChild(badge);
          }

          // 通常PWも限定PWと同じくフォールバック込みの times をそのまま渡す。
          // toggleShiftTimeBox 内部の SHIFT_DATES_MAP 参照だけに頼ると、シフトが
          // 動いている月と申込中の月がずれたときに時間帯が「情報がありません」になる
          el.addEventListener('click', () => toggleShiftTimeBox(key, dispY, dispM, day, times));
        }
      }
    }
    grid.appendChild(el);
  }

  // 凡例「自分のシフト」とカレンダー内「シフト表を見る」ボタンの表示制御
  const legendMyShift = document.getElementById('legend-my-shift');
  if (legendMyShift) legendMyShift.style.display = isOpenPassedForCal ? '' : 'none';
  // シフト表タブの有効・無効。入口を出す条件は「どの月であれシフトが公開されているか」。
  // 来月の申込が始まった直後は申込中の月（isOpenPassedForCal）はまだ公開前だが、
  // 今月のシフト表は引き続き見られる必要がある
  const shiftViewable = isOpenPassedForCal || !!(SHIFT_DATA && SHIFT_DATA.published);
  const tabShift = document.getElementById('tab-shift');
  if (tabShift) {
    const on = shiftViewable || _isPreviewMode;
    tabShift.disabled = !on;
    tabShift.title = on ? '' : 'シフト表はまだ公開されていません';
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
    lbl.innerHTML = prefix;
    boxList.appendChild(lbl);
    times.forEach(t => {
      const item = document.createElement('div');
      item.className = 'shift-time-item';
      item.innerHTML = ic('clock') + ' ' + esc(t);
      boxList.appendChild(item);
    });
  };
  makeItems(normTimes, ic('__dot__', {color:'#16a34a'}) + ' 通常PW', 'normal');
  makeItems(ltdTimes,  ic('__dot__', {color:'#9333ea'}) + ' 限定PW', 'limited');
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
      item.innerHTML   = ic('clock') + ' ' + esc(t);
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
  const isConfirmedView = isOpenPassed && isShiftPublishedForShownMonth();
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
    title.innerHTML = ic('circle-check-big', {color:'#15803D'}) + ' 確定シフト一覧';
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
            ' <span style="font-size:12px;background:var(--danger);color:#fff;padding:2px 6px;border-radius:4px;margin-left:4px;">' + ic('ban', {color:'#fff'}) + ' 中止</span>' +
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
  title.innerHTML = ic('clipboard') + ' 送信済みのシフト希望';
  const viewData = THIS_MONTH[viewUid];
  if (!viewData || !viewData.timestamp) {
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
    editBtn = '<button data-uid="' + esc(viewUid) + '" onclick="openFormForUid(this.dataset.uid)" style="margin-top:12px;width:100%;padding:11px;background:var(--green);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">' + ic('pencil') + ' シフト希望を編集する</button>';
  }

  body.innerHTML =
    (items.length ? items.join('') : '<div style="font-size:14px;color:var(--sub);padding:6px 0;">参加可能な日時なしとして提出済みです</div>') +
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
  // 早期の手動公開にも対応するため、サーバー側の実際の公開フラグも見る
  isOpenPassed = isOpenPassed || isShiftPublishedForShownMonth();
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
  const card = document.getElementById('next-shift-card');
  if (!card) return;
  const dateEl = document.getElementById('next-shift-date');
  const roleEl = document.getElementById('next-shift-role');
  const cancelEl = document.getElementById('next-shift-cancel');
  // 再構築前に前アカウント／前月の内容とclick handlerを必ず破棄する。
  card.hidden = true;
  card.onclick = null;
  card.classList.remove('cancelled');
  if (dateEl) dateEl.textContent = '';
  if (roleEl) roleEl.textContent = '';
  if (cancelEl) { cancelEl.textContent = ''; cancelEl.hidden = true; }
  if (!SHIFT_DATA || !SHIFT_DATA.dates || !SESSION) return;
  // SHIFT_DATA には「作成完了・確認完了・公開予定日到達・まだ当月内」を満たした月のシフトしか
  // 入ってこない。それは申込中の月とは別の月でありうる（今月のシフトが動いている最中に
  // 来月の申込が始まる）ため、申込側の状態（受付中・準備中・公開予定日）では判断しない
  if (!SHIFT_DATA.published) return;
  const today = getSimulatedToday(); today.setHours(0,0,0,0);
  const name  = SESSION.name;
  // 日付は「M/D」で年を持たないため、申込中の年ではなくシフト表の年で組み立てる
  const shiftYear = SHIFT_DATA.year || YEAR;
  const next  = SHIFT_DATA.dates.find(d => {
    const p = d.date.split('/');
    if (p.length !== 2) return false;
    const dt = new Date(shiftYear, parseInt(p[0]) - 1, parseInt(p[1]));
    if (dt < today) return false;
    return isMyCellInDate(d);
  });
  if (!next) return;
  card.hidden = false;
  card.onclick = () => goToShiftDetail(next);
  if (next.cancelled) {
    card.classList.add('cancelled');
    cancelEl.hidden = false;
    cancelEl.innerHTML = ic('ban', {color:'#fff'}) + ' 中止' + (next.cancelReason ? '：' + esc(next.cancelReason) : '');
  } else {
    card.classList.remove('cancelled');
    cancelEl.hidden = true;
  }
  dateEl.textContent = next.date + '（' + next.weekday + '） ' + next.time;
  // 役割判定
  let role = '奉仕者';
  if ((next.responsible || []).includes(name)) role = '責任者';
  else if ((next.cart && [...(next.cart.bring||[]), ...(next.cart.take||[])]).some(c => c.name === name)) role = 'カート担当';
  roleEl.textContent = '役割: ' + role;
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

// ── 備考（選択式） ──────────────────────────────
// 表記ゆれを防ぐため備考は自由入力ではなくパターン選択とし、
// 下の4フォーマットのいずれかの文字列を生成する（例外のみ「その他」で自由入力）。
const NOTE_TYPES = [
  { key: 'none',    label: 'なし' },
  { key: 'late',    label: '遅れて参加' },
  { key: 'early',   label: '早めに退出' },
  { key: 'partial', label: '一部のみ' },
  { key: 'other',   label: 'その他' }
];

function parseNote(s) {
  s = (s || '').trim();
  if (!s) return { type: 'none', from: '', to: '', text: '' };
  let m = s.match(/^(\d{1,2}:\d{2})\s*[〜~]\s*(\d{1,2}:\d{2})のみ参加$/);
  // 開始 < 終了 でない壊れた値は「その他」として原文を残す（黙って消さない）
  if (m && hhmmToMin(m[1]) < hhmmToMin(m[2])) return { type: 'partial', from: m[1], to: m[2], text: '' };
  m = s.match(/^(\d{1,2}:\d{2})から参加$/);
  if (m) return { type: 'late', from: m[1], to: '', text: '' };
  m = s.match(/^(\d{1,2}:\d{2})まで参加$/);
  if (m) return { type: 'early', from: '', to: m[1], text: '' };
  return { type: 'other', from: '', to: '', text: s };   // 旧・自由入力の備考はここに入る
}

function buildNote(st) {
  if (st.type === 'late')    return st.from ? st.from + 'から参加' : '';
  if (st.type === 'early')   return st.to   ? st.to   + 'まで参加' : '';
  // 「一部のみ」は開始 < 終了 が成立しないと文言を作らない（＝保存されない）
  if (st.type === 'partial') return (st.from && st.to && hhmmToMin(st.from) < hhmmToMin(st.to))
    ? st.from + '〜' + st.to + 'のみ参加' : '';
  if (st.type === 'other')   return (st.text || '').trim();
  return '';
}

function hhmmToMin(s) {
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  return m ? (+m[1]) * 60 + (+m[2]) : -1;
}

// スロットの時間帯（例 "9:00~11:00"）を区切り時間で刻んだ中間時刻の一覧
function noteTimeOptions(time, interval) {
  const m = String(time).match(/(\d{1,2}):(\d{2})\s*[~〜]\s*(\d{1,2}):(\d{2})/);
  if (!m) return [];
  const step = parseInt(interval, 10) > 0 ? parseInt(interval, 10) : 15;
  const st = (+m[1]) * 60 + (+m[2]), en = (+m[3]) * 60 + (+m[4]);
  const out = [];
  for (let t = st + step; t < en; t += step) out.push(Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'));
  return out;
}

function noteAreaHtml(time, interval, st) {
  const opts = noteTimeOptions(time, interval);
  // 選べる時刻が1つしかないスロットでは「一部のみ」は成立しない
  const types = NOTE_TYPES.filter(nt =>
    nt.key === 'none' || nt.key === 'other' ||
    (nt.key === 'partial' ? opts.length >= 2 : opts.length >= 1));
  const chips = types.map(nt =>
    '<button type="button" class="note-chip' + (st.type === nt.key ? ' on' : '') + '"'
    + ' data-type="' + nt.key + '" onclick="setNoteType(this)">' + nt.label + '</button>').join('');
  const sel = (which, cur, suffix, list) =>
    '<span class="note-sel-item"><select class="note-sel" data-which="' + which + '" onchange="onNoteInput(this)">'
    + '<option value="">--:--</option>'
    + list.map(o => '<option value="' + o + '"' + (o === cur ? ' selected' : '') + '>' + o + '</option>').join('')
    + '</select><span class="note-sel-suffix">' + suffix + '</span></span>';
  const showFrom = st.type === 'late'  || st.type === 'partial';
  const showTo   = st.type === 'early' || st.type === 'partial';
  // 「一部のみ」は開始に最終候補を出さず、終了は開始より後の時刻だけに絞る
  const fromList = st.type === 'partial' ? opts.slice(0, -1) : opts;
  const toList   = st.type !== 'partial' ? opts
                 : (st.from ? opts.filter(o => hhmmToMin(o) > hhmmToMin(st.from)) : opts.slice(1));
  const needTo   = st.type === 'partial' && st.from && !st.to;
  return '<div class="note-area" data-ntype="' + st.type + '" data-nfrom="' + (st.from || '') + '" data-nto="' + (st.to || '') + '">'
    + '<label>備考（途中参加・早退など）</label>'
    + '<div class="note-chips">' + chips + '</div>'
    + '<div class="note-detail' + ((showFrom || showTo) ? '' : ' hidden') + '">'
    +   (showFrom ? sel('from', st.from, st.type === 'partial' ? '〜' : 'から参加', fromList) : '')
    +   (showTo   ? sel('to',   st.to,   st.type === 'partial' ? 'のみ参加' : 'まで参加', toList) : '')
    + '</div>'
    + (needTo ? '<div class="note-warn">終了時刻も選んでください（未選択だと備考は保存されません）</div>' : '')
    + '<textarea class="note-other' + (st.type === 'other' ? '' : ' hidden') + '" maxlength="50"'
    +   ' placeholder="その他の連絡事項（50字まで）" oninput="onNoteInput(this)">' + esc(st.text || '') + '</textarea>'
    + '</div>';
}

// 「一部のみ」で選択肢に無い／逆転している時刻を落とす
function normalizeNote(st, time, interval) {
  if (st.type !== 'partial') return st;
  const opts = noteTimeOptions(time, interval);
  if (st.from && (opts.indexOf(st.from) < 0 || st.from === opts[opts.length - 1])) st.from = '';
  if (st.to && (opts.indexOf(st.to) < 0 || (st.from && hhmmToMin(st.to) <= hhmmToMin(st.from)))) st.to = '';
  return st;
}

function readNoteState(area) {
  const ta = area.querySelector('.note-other');
  return { type: area.dataset.ntype || 'none', from: area.dataset.nfrom || '',
           to: area.dataset.nto || '', text: ta ? ta.value : '' };
}

function commitNote(row) {
  const area = row.querySelector('.note-area');
  const key  = row.dataset.group + ' ' + row.dataset.time;
  const v    = buildNote(readNoteState(area));
  if (v) formState.noteMap[key] = v; else delete formState.noteMap[key];
}

function setNoteType(el) {
  const row  = el.closest('.slot-row'), area = el.closest('.note-area');
  const st   = readNoteState(area);
  st.type = el.dataset.type;
  if (st.type === 'late')  st.to   = '';
  if (st.type === 'early') st.from = '';
  if (st.type === 'none')  { st.from = ''; st.to = ''; }
  if (st.type !== 'other') st.text = '';
  normalizeNote(st, row.dataset.time, row.dataset.interval);
  area.outerHTML = noteAreaHtml(row.dataset.time, row.dataset.interval, st);
  commitNote(row);
  if (st.type === 'other') { const ta = row.querySelector('.note-other'); if (ta) ta.focus(); }
}

function onNoteInput(el) {
  const row = el.closest('.slot-row'), area = el.closest('.note-area');
  if (el.classList.contains('note-sel')) {
    area.dataset[el.dataset.which === 'from' ? 'nfrom' : 'nto'] = el.value;
    // 開始を変えたら終了の選択肢を絞り直す（開始以前になった終了は解除）
    if (area.dataset.ntype === 'partial' && el.dataset.which === 'from') {
      const st = normalizeNote(readNoteState(area), row.dataset.time, row.dataset.interval);
      area.outerHTML = noteAreaHtml(row.dataset.time, row.dataset.interval, st);
    }
  }
  commitNote(row);
}

function renderSlots(uid) {
  const container = document.getElementById('slots-container');
  const grouped   = groupSlots(SLOTS);
  if (grouped.length === 0) { container.innerHTML = '<p class="empty-note">スロットがありません</p>'; return; }
  const intervalMap = {};
  SLOTS.forEach(s => { intervalMap[s.week + ' ' + s.dateLabel + ' ' + s.time] = s.interval; });
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
      row.dataset.interval = intervalMap[slotKey] || 15;
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
        + noteAreaHtml(time, intervalMap[slotKey], parseNote(noteVal))
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
    const area = row.querySelector('.note-area');
    if (area) area.outerHTML = noteAreaHtml(time, row.dataset.interval, { type: 'none', from: '', to: '', text: '' });
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

  const selectedCount = Object.values(formState.checkedMap)
    .reduce((sum, times) => sum + times.size, 0);
  if (selectedCount === 0 &&
      !confirm('参加可能な日時を1件も選択していません。\n「参加可能な日時なし」として提出しますか？')) return;

  // APIが通常／限定PW共通形で返す別PW申込だけを参照する。
  // crossPwConflicts: { [uid]: [{ date:'M/D', pwType, pwName }] }
  const selectedDates = new Set();
  Object.entries(formState.checkedMap).forEach(([k, times]) => {
    if (!times || times.size === 0) return;
    // k = "週 日付" 形式（例："第2週 6/14(日)"）→ 日付部分を抽出
    const m = k.match(/(\d+\/\d+)/);
    if (m) selectedDates.add(m[1]);
  });
  const seenCrossPw = new Set();
  const crossPwConflicts = (((APP_DATA || {}).crossPwConflicts || {})[currentFormUid] || [])
    .filter(c => c && selectedDates.has(String(c.date || '')))
    .filter(c => {
      const key = String(c.date || '') + '\u0000' + String(c.pwType || '');
      if (seenCrossPw.has(key)) return false;
      seenCrossPw.add(key);
      return true;
    });
  if (crossPwConflicts.length > 0) {
    const byDate = {};
    crossPwConflicts.forEach(c => {
      const date = String(c.date || '');
      const pwName = String(c.pwName || c.pwType || '別のPW');
      if (!byDate[date]) byDate[date] = [];
      if (!byDate[date].includes(pwName)) byDate[date].push(pwName);
    });
    const conflictLines = Object.keys(byDate).map(date => '・' + date + '（' + byDate[date].join('・') + '）');
    const msg = '次の日程は別のPWにも申込があります。\n' + conflictLines.join('\n') +
      '\n\n両方に申し込んでもかまいませんが、シフトに入れるのはどちらか一方になります。\nこのまま送信しますか？';
    if (!confirm(msg)) return;
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
    // 送信成功前のDOM（disabledになった送信ボタンを含む）を次回復元しない。
    delete _tabSnapshots.form;

    await hideLoading();
    const msg = document.getElementById('form-msg');
    msg.className = 'msg success';
    msg.innerHTML = ic('circle-check-big', {color:'#15803D'}) + (selectedCount === 0
      ? ' 参加可能な日時なしとして送信しました！'
      : ' 送信が完了しました！');
    setTimeout(() => {
      buildMainScreen();
      history.back(); // フォーム送信後、main エントリへ戻る
    }, 1500);
  } catch (e) {
    await hideLoading();
    const msg = document.getElementById('form-msg');
    msg.className = 'msg error';
    msg.innerHTML = ic('triangle-alert', {color:'#B45309'}) + ' ' + esc(e.message || '送信に失敗しました。もう一度お試しください。');
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
  // シフト表の月は申込を受け付けている月とずれることがある（今月のシフトが動いている
  // 最中に来月の申込が始まる）ので、どの月の表を見ているのかを必ず示す
  const label = document.getElementById('shift-month-label');
  if (label) {
    const show = !!(SHIFT_DATA && SHIFT_DATA.published && SHIFT_DATA.year && SHIFT_DATA.month);
    label.textContent = show ? SHIFT_DATA.year + '年' + SHIFT_DATA.month + '月のシフト表' : '';
    label.style.display = show ? '' : 'none';
  }
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
      subHtml += '<div class="sdb-sub-row"><span class="sdb-sub-label sdb-chip-blue">' + ic('user') + ' 責任者</span><span class="sdb-sub-val">' + respNames.map(esc).join('、') + '</span></div>';
    }
    if (cartAll.length > 0 && d.cart) {
      const bringStr = (d.cart.bring || []).filter(c => c.name)
        .map(c => esc(c.name) + (c.cartNo ? '(' + esc(c.cartNo) + ')' : '')).join('、');
      const takeStr = (d.cart.take || []).filter(c => c.name)
        .map(c => esc(c.name) + (c.cartNo ? '(' + esc(c.cartNo) + ')' : '')).join('、');
      subHtml += '<div class="sdb-sub-row"><span class="sdb-sub-label sdb-chip-amber">' + ic('__cart__') + ' カート</span>' +
        '<span class="sdb-sub-valgroup">' +
        (bringStr ? '<span class="sdb-sub-val">持ち込み ' + bringStr + '</span>' : '') +
        (bringStr && takeStr ? '<span class="sdb-sub-sep">/</span>' : '') +
        (takeStr ? '<span class="sdb-sub-val">持ち帰り ' + takeStr + '</span>' : '') +
        '</span></div>';
    }

    btn.innerHTML =
      '<div class="sdb-main">' +
        '<div class="sdb-head"><span class="sdb-date"><span class="sdb-date-text">' + esc(d.date) + '（' + esc(d.weekday) + '）</span></span><span class="sdb-time">' + esc(d.time) + '</span></div>' +
        (d.cancelled
          ? '<div class="sdb-cancel-reason">' + ic('ban', {color:'#DC2626'}) + ' 中止' + (d.cancelReason ? '：' + esc(d.cancelReason) : '') + '</div>'
          : (subHtml ? '<div class="sdb-sub">' + subHtml + '</div>' : '')) +
      '</div>' +
      '<div class="sdb-right">' +
        (d.cancelled ? '<span class="sdb-badge cancelled">中止</span>'
            : hasMyShift ? '<span class="sdb-badge">参加</span>' : '') +
        '<span class="sdb-arrow">›</span>' +
      '</div>';
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
  history.pushState({ screen: _currentScreenName, modal: 'cancelInfo' }, '');
  _modalInHistory = 'cancelInfo';
}
function closeCancelInfoPopup() {
  document.getElementById('cancel-info-overlay').classList.remove('show');
  if (_modalInHistory === 'cancelInfo') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
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
  // 詳細は「タブ内の1段深いところ」なので戻るバーを出す
  // （タブ入口では syncTabUi が隠している）
  _setShiftBackBar(true);
  if (quickJump) {
    // メイン画面から直接開いた場合：戻るとメイン画面へ（一覧を経由しない）。
    // ホームの真上に1段だけ積まれるので深さは 1
    document.getElementById('shift-back-btn').onclick = () => history.back();
    history.pushState({ screen: 'shift', subScreen: 'detail', quickJump: true, tab: 'shift', depth: 1,
      shiftDate: dateObj.date, shiftTime: dateObj.time }, '');
    _tabDepth = 1;
  } else {
    document.getElementById('shift-back-btn').onclick = () => _shiftDetailBack();
    // 詳細ページを履歴に積む（戻るボタンで一覧に戻れるよう）。
    // シフト表タブ（深さ1）の上に積むので深さは 2
    history.pushState({ screen: 'shift', subScreen: 'detail', tab: 'shift', depth: 2,
      shiftDate: dateObj.date, shiftTime: dateObj.time }, '');
    _tabDepth = 2;
  }
  _currentTab = 'shift';
  buildShiftDetail(dateObj);
}

// シフト表画面の「‹ 戻る」バーの表示切り替え。
// 一覧＝タブ入口なので隠し、詳細に入ったときだけ出す
function _setShiftBackBar(visible) {
  const scr = document.getElementById('screen-shift');
  if (!scr) return;
  const bb = scr.querySelector('.back-bar');
  if (bb) bb.style.display = visible ? '' : 'none';
}

// fromPopstate: true の場合は popstate 経由（履歴は既に移動済み）。
// false/未指定の場合は戻るボタンからの直接呼び出しなので、履歴エントリも合わせて破棄する。
function _shiftDetailBack(fromPopstate) {
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
  // 一覧＝シフト表タブの入口に戻ったので、戻るバーを隠して深さも1に戻す
  _setShiftBackBar(false);
  _currentTab = 'shift';
  _tabDepth   = 1;
  if (!fromPopstate) {
    _suppressNextPopstate = true;
    history.go(-1);
  }
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
    html += '<div class="cancel-banner">' + ic('ban', {color:'#fff'}) + ' 中止' + (d.cancelReason ? '：' + esc(d.cancelReason) : '') + '</div>';
  }

  if (d.memo) {
    html += '<div class="memo-box"><label>' + ic('square-pen') + ' 責任者メモ</label>' + esc(d.memo) + '</div>';
  }

  if (staffEditMode) {
    html += buildRespEditHtml(d);
  } else if (d.responsible && d.responsible.length > 0) {
    html += '<div class="resp-row"><span class="resp-label">責任者：</span>';
    d.responsible.forEach(name => {
      html += '<span style="font-weight:700;">' + esc(name) + '</span>&nbsp;';
    });
    html += '</div>';
  }

  if (staffEditMode) {
    html += buildCartEditHtml(d);
  } else if (d.cart) {
    const allCart = [...(d.cart.bring || []), ...(d.cart.take || [])].filter(c => c.name);
    if (allCart.length > 0) {
      html += '<div class="cart-info-row"><span class="cart-label-s">カート：</span>';
      (d.cart.bring || []).filter(c => c.name).forEach(c => {
        html += '<span>持ち込み: <b>' + esc(c.name) + '</b>' + (c.cartNo ? '(' + esc(c.cartNo) + ')' : '') + '</span>&nbsp;';
      });
      (d.cart.take || []).filter(c => c.name).forEach(c => {
        html += '<span>持ち帰り: <b>' + esc(c.name) + '</b>' + (c.cartNo ? '(' + esc(c.cartNo) + ')' : '') + '</span>&nbsp;';
      });
      html += '</div>';
    }
  }
  if (d.cart) {
    html += '<button onclick="openExhibitPhotoFromShift()" style="margin:4px 0 8px;padding:8px 16px;background:var(--purple);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">' + ic('image') + ' 展示内容写真を見る</button>';
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
      if (placeNames.length > 2) {
        html += '<div class="stv2-scroll-hint">↔ 横にスクロールして全ての場所を確認できます</div>';
      }
      html += '<div class="area-section" style="overflow-x:auto;">';
      html += '<table class="shift-tbl-v2"><thead>';

      // 場所名ヘッダー行（場所ごとに色分け）。編集モードは自由入力で場所名を変更できる
      html += '<tr><th class="stv2-hdr-time">時間</th>';
      placeNames.forEach((loc, i) => {
        if (staffEditMode) {
          const realName = (Array.isArray(d.placeNames) && d.placeNames[i]) || '';
          html += '<th class="stv2-hdr-place" style="background:' + PC[i % PC.length] + ';">'
               + '<input type="text" class="place-name-edit" id="place-name-' + i + '" value="' + esc(realName) + '" placeholder="場所' + (i + 1) + '" oninput="onStaffEditChanged()"></th>';
        } else {
          html += '<th class="stv2-hdr-place" style="background:' + PC[i % PC.length] + ';">' + esc(loc) + '</th>';
        }
      });
      html += '</tr>';

      // カート番号行（場所ごとに何号車を置くか）。編集モードは常に表示してチップで選択
      const hasPlaceCart = placeNames.some(loc => placeCart[loc]);
      if (hasPlaceCart || staffEditMode) {
        html += '<tr class="stv2-cart-row"><td>カート番号</td>';
        placeNames.forEach((loc, i) => {
          if (staffEditMode) {
            html += '<td>' + cartNumButtonHtml('place-cart-' + i, placeCart[loc] || '') + '</td>';
          } else {
            html += '<td>' + (placeCart[loc] ? esc(placeCart[loc]) : '—') + '</td>';
          }
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
              const curWatch = !!(person && person.watch);
              html += '<select class="staff-edit-sel" id="staff-sel-' + ri + '-' + li + '-' + pi
                   + '" data-watch="' + (curWatch ? '1' : '0') + '" onchange="onStaffEditChanged()">';
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
        html += '<div id="staff-edit-warnings"></div>';
        html += '<div class="edit-mode-actions">';
        html += '<button class="btn-cancel-shift-edit" onclick="exitStaffEditMode()">キャンセル</button>';
        html += '<button class="btn-reset-shift-edit" onclick="resetStaffEdits()">編集前に戻す</button>';
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
    _isOpenPassed = _isOpenPassed || isShiftPublishedForShownMonth();
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
  if (_isPreviewMode) { alert('閲覧モード中は操作できません。'); return; }
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

// 責任者／カート担当のセレクト候補。資格情報（_memberFlags）が取れているときは
// その役の資格を持つ人だけに絞る。現在値の人が資格なし・無効化済みでも
// 選択肢から消えて黙って外れることがないよう、現在値だけは必ず残す
function buildRoleOptions(flagKey, curUid) {
  const staff = (APP_DATA && APP_DATA.staffJSON) || [];
  const flags = _memberFlags || {};
  const hasFlags = Object.keys(flags).length > 0;
  let list = hasFlags ? staff.filter(m => (flags[m.uid] || {})[flagKey]) : staff;
  if (curUid && !list.some(m => m.uid === curUid)) {
    const cur = staff.find(m => m.uid === curUid);
    if (cur) list = [cur, ...list];
  }
  let html = '<option value="">—</option>';
  list.forEach(m => {
    html += '<option value="' + esc(m.uid) + '"' + (m.uid === curUid ? ' selected' : '') + '>' + esc(m.name) + '</option>';
  });
  return html;
}

function buildRespEditHtml(d) {
  const r1 = (d.responsibleUids && d.responsibleUids[0]) || '';
  const r2 = (d.responsibleUids && d.responsibleUids[1]) || '';
  return '<div class="resp-row resp-edit-row"><span class="resp-label">責任者：</span>'
       + '<select class="role-edit-sel" id="resp-edit-1" onchange="onStaffEditChanged()">' + buildRoleOptions('respFlag', r1) + '</select>'
       + '<select class="role-edit-sel" id="resp-edit-2" onchange="onStaffEditChanged()">' + buildRoleOptions('respFlag', r2) + '</select>'
       + '</div>';
}

function buildCartEditHtml(d) {
  const cart = d.cart || {};
  const bring = cart.bring || [];
  const take  = cart.take  || [];
  const item = (label, idPrefix, person) => {
    const uid    = person ? person.uid    : '';
    const cartNo = person ? person.cartNo : '';
    return '<div class="cart-edit-item"><span class="cart-edit-lbl">' + label + '</span>'
         + '<select class="role-edit-sel" id="' + idPrefix + '-uid" onchange="onStaffEditChanged()">' + buildRoleOptions('cartFlag', uid) + '</select>'
         + cartNumButtonHtml(idPrefix + '-no', cartNo)
         + '</div>';
  };
  return '<div class="cart-edit-block">'
       + '<div class="cart-edit-title">カート担当（持ち込み）</div>'
       + '<div class="cart-edit-row">' + item('①', 'cart-bring1', bring[0]) + item('②', 'cart-bring2', bring[1]) + '</div>'
       + '<div class="cart-edit-title">カート担当（持ち帰り）</div>'
       + '<div class="cart-edit-row">' + item('①', 'cart-take1', take[0]) + item('②', 'cart-take2', take[1]) + '</div>'
       + '</div>';
}

// カート番号（丸数字表示・複数選択可）。シフト作成アプリと同じチェックボックス式
// ポップオーバー（js/picker.js）を使う
function cartCircled(n) {
  const M = { '1':'①','2':'②','3':'③','4':'④','5':'⑤','6':'⑥','7':'⑦','8':'⑧','9':'⑨' };
  return M[String(n).trim()] || String(n);
}
function cartNumLabel(v) {
  const arr = String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  return arr.length ? arr.map(cartCircled).join('') : '—';
}
function cartNumButtonHtml(id, value) {
  return '<button type="button" class="cart-num-chip' + (value ? '' : ' empty') + '" id="' + id
       + '" data-value="' + esc(value || '') + '" onclick="openCartNumPicker(this)">' + cartNumLabel(value) + '</button>';
}
function openCartNumPicker(el) {
  const cur  = String(el.dataset.value || '').split(',').map(x => x.trim()).filter(Boolean);
  const list = (_cartNumbers && _cartNumbers.length) ? _cartNumbers : ['1','2','3','4'];
  const items = list.map(n => ({
    value: String(n), label: cartCircled(n),
    html: '<span style="font-size:15px;">' + cartCircled(n) + '</span>',
  }));
  openPicker(el, {
    title: 'カート番号を選択（複数可）', multi: true, value: cur, items,
    onToggle: vals => {
      const next = list.filter(n => vals.includes(String(n))).join(',');
      el.dataset.value = next;
      el.textContent = cartNumLabel(next);
      el.classList.toggle('empty', !next);
      onStaffEditChanged();
    },
  });
}

function nameToUid(name) {
  if (!name || !APP_DATA || !APP_DATA.staffJSON) return '';
  const m = APP_DATA.staffJSON.find(s => s.name === name);
  return m ? (m.uid || '') : '';
}

async function enterStaffEditMode() {
  staffEditMode = true;
  history.pushState({ screen: 'shift', modal: 'staffEdit' }, '');
  _modalInHistory = 'staffEdit';
  // 責任者・カート担当の候補絞り込みとカート番号選択肢は初回だけ取得してキャッシュする
  if (!_memberFlags || !_cartNumbers) {
    showLoading('編集データを読み込み中...');
    try {
      const [flagsRes, cartRes] = await Promise.all([apiGet('getMemberFlags'), apiGet('getCartNumbers')]);
      _memberFlags = (flagsRes && flagsRes.flags) || {};
      _cartNumbers = (cartRes && cartRes.cartNumbers && cartRes.cartNumbers.length) ? cartRes.cartNumbers : ['1','2','3','4'];
    } catch (e) {
      _memberFlags = _memberFlags || {};
      _cartNumbers = _cartNumbers || ['1','2','3','4'];
    }
    await hideLoading();
  }
  buildShiftDetail(shiftViewingDate);
}

// 編集中の未保存の変更（名前欄・プルダウン・カート番号など）を編集開始時点の
// 状態に戻す。shiftViewingDate は編集モード中も一切書き換えていないため、
// 編集モードのまま buildShiftDetail を再実行するだけでフォームが元の値に戻る
function resetStaffEdits() {
  if (!confirm('編集内容を破棄して編集前の状態に戻しますか？')) return;
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

// 編集中のDOMから保存用データを組み立てる。saveStaffEdits() と
// ライブ検証（onStaffEditChanged）の両方から呼ぶための共通処理
function collectStaffEditPayload(d) {
  if (!d.slots || d.slots.length === 0) return null;

  // 表内のセルは「表示ラベル」（名前が空の列は「場所N」）で引いているが、
  // 保存するのは場所名編集欄に入っている実際の場所名。列の対応は名前ではなく
  // 並び順（列番号）で決まるため、ラベルと同じ並びで場所名欄を読む
  const labels     = Object.keys((d.slots[0] && d.slots[0].places) || {});
  const placeNames = labels.map((_, i) => (document.getElementById('place-name-' + i)?.value || '').trim());
  // カート番号（場所別）もラベルキーではなく列番号順の配列で送る
  const placeCartArr = labels.map((_, i) => document.getElementById('place-cart-' + i)?.dataset.value || '');

  // 各スロット×場所のドロップダウン値を収集
  // 列番号順の配列で送る（管理アプリと同じ新形式）。
  // 1番目は固定枠なので空欄でも詰めずに位置を保ち、見守りは元の状態を引き継ぐ。
  // 以前は空欄を捨てて詰めていたため位置がずれ、slot.watch は元データに
  // 存在しないキーだったため、保存するたび見守りが全部外れていた
  const slotsPayload = (d.slots || []).map((slot, ri) => {
    const places = [];
    const watch  = [];
    placeNames.forEach((loc, li) => {
      const uids = [];
      let cellWatch = false;
      for (let pi = 0; pi < 3; pi++) {
        const sel = document.getElementById('staff-sel-' + ri + '-' + li + '-' + pi);
        const v = sel ? sel.value : '';
        uids.push(v);
        if (pi === 0 && v && sel && sel.dataset.watch === '1') cellWatch = true;
      }
      while (uids.length && !uids[uids.length - 1]) uids.pop();  // 末尾の空欄だけ落とす
      places.push(uids);
      watch.push(cellWatch);
    });
    return { time: slot.time, places, watch };
  });

  // 責任者・カート担当は編集欄の select（uid値）から読む
  const responsible = {
    r1: document.getElementById('resp-edit-1')?.value || '',
    r2: document.getElementById('resp-edit-2')?.value || ''
  };

  const cart = {
    ki1: document.getElementById('cart-bring1-uid')?.value || '',
    kc1: document.getElementById('cart-bring1-no')?.dataset.value || '',
    ki2: document.getElementById('cart-bring2-uid')?.value || '',
    kc2: document.getElementById('cart-bring2-no')?.dataset.value || '',
    ko1: document.getElementById('cart-take1-uid')?.value || '',
    oc1: document.getElementById('cart-take1-no')?.dataset.value || '',
    ko2: document.getElementById('cart-take2-uid')?.value || '',
    oc2: document.getElementById('cart-take2-no')?.dataset.value || ''
  };

  return { placeNames, placeCartArr, slotsPayload, responsible, cart };
}

function uidToNameLocal(uid) {
  if (!uid || !APP_DATA || !APP_DATA.staffJSON) return uid;
  const m = APP_DATA.staffJSON.find(s => s.uid === uid);
  return m ? (m.name || uid) : uid;
}

// ===== 保存前ライブ検証（ブロック内で完結する重要な配置エラーのみ） =====
// シフト作成アプリの validation.js と違い、他奉仕者の申込状況や他PWでの
// 配置状況（conflictMap）はここでは取得していないため対象外。
// 物理的に不可能・データが壊れる類のエラーだけを見る
function checkDupSlot(slotsPayload, placeNames) {
  const issues = [];
  slotsPayload.forEach(slot => {
    const seen = {};
    (slot.places || []).forEach((uids, li) => {
      (uids || []).forEach(uid => { if (uid) (seen[uid] = seen[uid] || []).push(li); });
    });
    Object.entries(seen).forEach(([uid, lis]) => {
      if (lis.length < 2) return;
      const where = lis.map(li => placeNames[li] || '（場所未設定）').join('・');
      issues.push('⛔ ' + uidToNameLocal(uid) + ' が ' + slot.time + ' に重複して配置されています（' + where + '）');
    });
  });
  return issues;
}
function checkNoPlace(slotsPayload, placeNames) {
  const issues = [];
  placeNames.forEach((loc, li) => {
    if (loc) return;
    const has = slotsPayload.some(s => ((s.places || [])[li] || []).some(Boolean));
    if (has) issues.push('⛔ ' + (li + 1) + '列目の場所が未設定のまま奉仕者が配置されています');
  });
  return issues;
}
function checkCartNumDup(cart, placeCartArr, placeNames) {
  const issues = [];
  [['持ち込み', [cart.kc1, cart.kc2]], ['持ち帰り', [cart.oc1, cart.oc2]]].forEach(([lbl, vals]) => {
    const seen = {};
    (vals || []).filter(Boolean).forEach(v => {
      String(v).split(',').map(x => x.trim()).filter(Boolean).forEach(n => { seen[n] = (seen[n] || 0) + 1; });
    });
    const dup = Object.keys(seen).filter(n => seen[n] > 1);
    if (dup.length) issues.push('⛔ ' + lbl + 'のカート番号 ' + dup.join('・') + ' が重複しています');
  });
  const pcSeen = {};
  (placeCartArr || []).forEach((v, li) => {
    String(v || '').split(',').map(x => x.trim()).filter(Boolean)
      .forEach(n => { (pcSeen[n] = pcSeen[n] || []).push(li); });
  });
  Object.entries(pcSeen).forEach(([n, lis]) => {
    if (lis.length < 2) return;
    const where = lis.map(li => placeNames[li] || '（場所未設定）').join('・');
    issues.push('⛔ カート番号 ' + n + ' が ' + where + ' に重複して設置されています');
  });
  return issues;
}
function validateStaffEditLive(payload) {
  return [].concat(
    checkDupSlot(payload.slotsPayload, payload.placeNames),
    checkNoPlace(payload.slotsPayload, payload.placeNames),
    checkCartNumDup(payload.cart, payload.placeCartArr, payload.placeNames)
  );
}
function renderStaffEditWarnings(issues) {
  const el = document.getElementById('staff-edit-warnings');
  if (!el) return;
  if (!issues || issues.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="edit-warn-box">' + issues.map(msg =>
    '<div class="edit-warn-item">' + esc(msg) + '</div>'
  ).join('') + '</div>';
}
// 奉仕者・責任者・カート担当・場所名・カート番号のいずれかが変わるたびに呼ぶ
function onStaffEditChanged() {
  if (!shiftViewingDate) return;
  const payload = collectStaffEditPayload(shiftViewingDate);
  if (!payload) return;
  renderStaffEditWarnings(validateStaffEditLive(payload));
}

async function saveStaffEdits() {
  if (_isPreviewMode) { alert('閲覧モード中は操作できません。'); return; }
  if (!shiftViewingDate) return;
  const d = shiftViewingDate;
  const payload = collectStaffEditPayload(d);
  // 場所列が取れない（スロットが無い）状態で保存すると usedPlaces が空で送られ、
  // 保存済みの場所設定ごと消える。何も編集できていないので保存しない
  if (!payload) { alert('この時間帯には編集できる枠がありません。'); return; }

  const issues = validateStaffEditLive(payload);
  if (issues.length > 0) {
    const ok = confirm('配置に問題がある可能性があります。\n\n' + issues.join('\n') + '\n\nこのまま保存しますか？');
    if (!ok) return;
  }

  const btn = document.getElementById('btn-save-staff');
  if (btn) btn.disabled = true;

  showLoading('シフトを保存中...');
  try {
    const result = await apiGet('saveShiftBlock', {
      date: d.date,
      time: d.time,
      responsible: payload.responsible,
      cart: payload.cart,
      placeCart: payload.placeCartArr,
      usedPlaces: payload.placeNames,
      slots: payload.slotsPayload,
      uid: SESSION ? SESSION.uid : '',
      adminUid: SESSION ? (SESSION.uid || '') : '',
      adminName: SESSION ? (SESSION.name || '') : '',
      viaForm: true
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
    msg.className = 'msg success'; msg.innerHTML = ic('circle-check-big', {color:'#15803D'}) + ' 要望を送信しました！';
    ta.value = '';
    setTimeout(() => { msg.className = 'msg'; msg.textContent = ''; }, 3000);
  } catch (e) {
    hideLoading();
    msg.className = 'msg error'; msg.innerHTML = ic('triangle-alert', {color:'#B45309'}) + ' 送信に失敗しました。';
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
    msg.className = 'msg success'; msg.innerHTML = ic('circle-check-big', {color:'#15803D'}) + ' バグ報告を送信しました！担当者に通知されます。';
    ta.value = '';
    setTimeout(() => { msg.className = 'msg'; msg.textContent = ''; }, 3000);
  } catch (e) {
    hideLoading();
    msg.className = 'msg error'; msg.innerHTML = ic('triangle-alert', {color:'#B45309'}) + ' 送信に失敗しました。';
    setTimeout(() => { msg.className = 'msg'; msg.textContent = ''; }, 3000);
  } finally {
    btn.disabled = false; btn.textContent = '送信する';
  }
}

// ===== 配布報告送信 =====
function _showDistribReportScreen() {
  const dateInput = document.getElementById('distrib-date');
  if (dateInput && !dateInput.value) {
    const t = getSimulatedToday();
    const y = t.getFullYear(), m = String(t.getMonth() + 1).padStart(2, '0'), d = String(t.getDate()).padStart(2, '0');
    dateInput.value = `${y}-${m}-${d}`;
  }
}

async function submitDistributionReport() {
  if (_isPreviewMode) { alert('閲覧モード中は送信できません。'); return; }
  const dateInput  = document.getElementById('distrib-date');
  const timeInput  = document.getElementById('distrib-time');
  const itemsInput = document.getElementById('distrib-items');
  const notesInput = document.getElementById('distrib-notes');
  const btn = document.getElementById('btn-distrib-submit');
  const msg = document.getElementById('distrib-msg');
  if (!dateInput.value) { alert('日付を入力してください。'); return; }
  if (!itemsInput.value.trim()) { alert('配布物を入力してください。'); return; }
  btn.disabled = true;
  showLoading('配布報告を送信中...');
  try {
    const data = await apiGet('postDistributionReport', {
      uid: SESSION.uid, name: SESSION.name,
      reportDate: dateInput.value, reportTime: timeInput.value || '',
      items: itemsInput.value.trim(), notes: notesInput.value.trim(),
    });
    if (!data.ok) throw new Error(data.error);
    hideLoading();
    msg.className = 'msg success'; msg.innerHTML = ic('circle-check-big', {color:'#15803D'}) + ' 配布報告を送信しました！';
    timeInput.value = ''; itemsInput.value = ''; notesInput.value = '';
    setTimeout(() => { msg.className = 'msg'; msg.textContent = ''; }, 3000);
  } catch (e) {
    hideLoading();
    msg.className = 'msg error'; msg.innerHTML = ic('triangle-alert', {color:'#B45309'}) + ' 送信に失敗しました。';
    setTimeout(() => { msg.className = 'msg'; msg.textContent = ''; }, 3000);
  } finally {
    btn.disabled = false; btn.textContent = '送信する';
  }
}

// ===== 困ったときのかんたん案内 =====
// まずは選択式で目的を絞り、最後に既存の画面へ移動する。
// 自由入力やAI APIは使わず、案内の内容を毎回同じにする。
const GUIDE_NODES = {
  start: {
    message: '何をしたいですか？',
    choices: [
      { label: '希望を提出・確認したい', next: 'form' },
      { label: 'シフト表・自分の担当を見たい', action: 'openShift' },
      { label: '配布報告を送りたい', next: 'distribution' },
      { label: '要望・質問を送りたい', next: 'request' },
      { label: '不具合を報告したい', next: 'bug' },
      { label: '設定や通知を確認したい', action: 'openMore' },
      { label: '操作マニュアルを見たい', action: 'openManual' },
      { label: 'この画面の説明を見たい', action: 'openHelp' },
    ]
  },
  form: {
    message: '希望についてですね。どちらですか？',
    choices: [
      { label: '希望提出画面を開く', action: 'openForm' },
      { label: '提出した希望を確認したい', action: 'openForm' },
      { label: '提出後の希望を変更したい', next: 'formChange' },
      { label: '最初に戻る', action: 'reset' },
    ]
  },
  formChange: {
    message: '提出後の希望の変更は、このアプリのフォームからは受け付けていません。区域係へ直接ご連絡ください。',
    choices: [
      { label: '最初に戻る', action: 'reset' },
    ]
  },
  request: {
    message: '区域係へ送る要望・質問を入力してください。入力後に内容を確認してから送信します。',
    form: { kind: 'request', title: '要望・質問', field: 'body', label: '内容', placeholder: 'ご意見・ご質問を入力してください' }
  },
  bug: {
    message: '不具合の内容を入力してください。「どの画面で」「何をしたら」「どうなったか」を書くと伝わりやすくなります。',
    form: { kind: 'bug', title: '不具合の報告', field: 'body', label: '不具合の内容', placeholder: '例：シフト表で日付を押したら表示されませんでした' }
  },
  distribution: {
    message: '配布報告の内容を入力してください。入力後に内容を確認してから送信します。',
    form: { kind: 'distribution', title: '配布報告' }
  }
};

let _guideFormValues = {};
let _guideFormError = '';
let _guideDraft = null;
let _guideResult = null;
let _guideSubmitting = false;

function _guideAddBubble(parent, type, message) {
  const el = document.createElement('div');
  el.className = 'guide-bubble ' + type;
  el.textContent = message;
  parent.appendChild(el);
}

function renderGuide() {
  const messages = document.getElementById('guide-messages');
  const choices = document.getElementById('guide-choice-list');
  if (!messages || !choices) return;

  messages.innerHTML = '';
  choices.innerHTML = '';

  let node = GUIDE_NODES.start;
  _guideAddBubble(messages, 'assistant', node.message);
  _guideTrail.forEach(choice => {
    _guideAddBubble(messages, 'user', choice.label);
    node = GUIDE_NODES[choice.next] || GUIDE_NODES.start;
    _guideAddBubble(messages, 'assistant', node.message);
  });

  if (_guideResult) {
    _guideAddBubble(messages, 'assistant', _guideResult.message);
    if (_guideResult.ok) {
      _guideAddChoice(choices, '閉じる', { action: 'close' });
      _guideAddChoice(choices, '別の操作をする', { action: 'reset' });
    } else {
      _guideAddChoice(choices, 'もう一度送信する', { action: 'submitDraft' });
      _guideAddChoice(choices, '入力内容を修正する', { action: 'editDraft' });
      _guideAddChoice(choices, '最初に戻る', { action: 'reset' });
    }
  } else if (_guideDraft) {
    _guideAddBubble(messages, 'assistant', '次の内容で送信しますか？\n\n' + _guideDraft.summary);
    _guideAddChoice(choices, 'この内容で送信する', { action: 'submitDraft' });
    _guideAddChoice(choices, '入力内容を修正する', { action: 'editDraft' });
    _guideAddChoice(choices, '最初に戻る', { action: 'reset' });
  } else if (node.form) {
    _guideRenderForm(choices, node.form);
  } else {
    (node.choices || []).forEach(choice => _guideAddChoice(choices, choice.label, choice));
  }

  const back = document.getElementById('guide-back-btn');
  const reset = document.getElementById('guide-reset-btn');
  if (back) back.disabled = _guideTrail.length === 0 && !_guideDraft && !_guideResult;
  if (reset) reset.disabled = _guideTrail.length === 0 && !_guideDraft && !_guideResult;

  const body = document.querySelector('.guide-modal-body');
  if (body) setTimeout(() => { body.scrollTop = body.scrollHeight; }, 0);
}

function _guideAddChoice(parent, labelText, choice) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'guide-choice';
  button.disabled = _guideSubmitting;
  button.onclick = () => guideChoose(choice);

  const label = document.createElement('span');
  label.textContent = labelText;
  const arrow = document.createElement('span');
  arrow.className = 'guide-choice-arr';
  arrow.textContent = '›';
  button.appendChild(label);
  button.appendChild(arrow);
  parent.appendChild(button);
}

function _guideRenderForm(parent, form) {
  if (form.kind === 'distribution' && !_guideFormValues.reportDate) {
    const today = getSimulatedToday();
    _guideFormValues.reportDate = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
  }

  const wrap = document.createElement('div');
  wrap.className = 'guide-form';

  const title = document.createElement('div');
  title.className = 'guide-form-title';
  title.textContent = form.title;
  wrap.appendChild(title);

  const addField = (key, labelText, type, placeholder, multiline) => {
    const field = document.createElement('label');
    field.className = 'guide-field';
    const label = document.createElement('span');
    label.className = 'guide-field-label';
    label.textContent = labelText;
    field.appendChild(label);
    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.className = 'guide-field-input';
    if (!multiline) input.type = type;
    input.placeholder = placeholder || '';
    input.value = _guideFormValues[key] || '';
    input.oninput = () => { _guideFormValues[key] = input.value; };
    field.appendChild(input);
    wrap.appendChild(field);
  };

  if (form.kind === 'distribution') {
    addField('reportDate', '日付', 'date', '', false);
    addField('reportTime', '時刻（任意）', 'time', '', false);
    addField('items', '配布物', 'text', '例：暮らせます冊子×1', true);
    addField('notes', '備考（任意）', 'text', '必要があれば入力してください', true);
  } else {
    addField(form.field, form.label, 'text', form.placeholder, true);
  }

  if (_guideFormError) {
    const error = document.createElement('div');
    error.className = 'guide-form-error';
    error.textContent = _guideFormError;
    wrap.appendChild(error);
  }

  const note = document.createElement('div');
  note.className = 'guide-form-note';
  note.textContent = '送信前に内容を確認する画面が表示されます。';
  wrap.appendChild(note);

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'guide-form-submit';
  submit.textContent = '内容を確認する';
  submit.disabled = _guideSubmitting;
  submit.onclick = () => guideConfirmForm(form.kind);
  wrap.appendChild(submit);
  parent.appendChild(wrap);
}

function _guideReadForm(kind) {
  const data = Object.assign({}, _guideFormValues);
  if (kind === 'distribution') {
    if (!data.reportDate) return { error: '日付を選択してください。' };
    if (!String(data.items || '').trim()) return { error: '配布物を入力してください。' };
    data.items = String(data.items).trim();
    data.notes = String(data.notes || '').trim();
    data.reportTime = String(data.reportTime || '');
    return { data };
  }
  if (!String(data.body || '').trim()) return { error: '内容を入力してください。' };
  data.body = String(data.body).trim();
  return { data };
}

function _guideDraftSummary(kind, data) {
  if (kind === 'distribution') {
    return '日付：' + data.reportDate +
      '\n時刻：' + (data.reportTime || '未入力') +
      '\n配布物：' + data.items +
      (data.notes ? '\n備考：' + data.notes : '');
  }
  return data.body;
}

function guideConfirmForm(kind) {
  _guideFormError = '';
  const result = _guideReadForm(kind);
  if (result.error) {
    _guideFormError = result.error;
    renderGuide();
    return;
  }
  _guideDraft = { kind, data: result.data, summary: _guideDraftSummary(kind, result.data) };
  _guideResult = null;
  renderGuide();
}

function guideChoose(choice) {
  if (!choice) return;
  if (choice.action) {
    _guideRunAction(choice.action);
    return;
  }
  if (!choice.next || !GUIDE_NODES[choice.next]) return;
  _guideTrail.push(choice);
  renderGuide();
}

function guideBack() {
  if (_guideResult) {
    _guideResult = null;
    renderGuide();
    return;
  }
  if (_guideDraft) {
    _guideDraft = null;
    renderGuide();
    return;
  }
  if (_guideTrail.length === 0) return;
  _guideTrail.pop();
  renderGuide();
}

function guideReset() {
  _guideTrail = [];
  _guideFormValues = {};
  _guideFormError = '';
  _guideDraft = null;
  _guideResult = null;
  renderGuide();
}

function openGuide() {
  if (_modalInHistory) return;
  guideReset();
  document.getElementById('guide-overlay').classList.add('show');
  history.pushState({ screen: _currentScreenName, modal: 'guide' }, '');
  _modalInHistory = 'guide';
}

function closeGuide() {
  const overlay = document.getElementById('guide-overlay');
  if (overlay) overlay.classList.remove('show');
  _guideTrail = [];
  if (_modalInHistory === 'guide') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
    return true;
  }
  return false;
}

function closeGuideOutside(e) {
  if (e.target === document.getElementById('guide-overlay')) closeGuide();
}

function _guideRunAction(actionName) {
  const actions = {
    openForm:   () => switchTab('form'),
    openShift:  () => switchTab('shift'),
    openMore:   () => switchTab('more'),
    openRequest: () => showScreen('request'),
    openBug:      () => showScreen('bug'),
    openManual:   () => openManualModal(),
    openHelp:     () => openHelp(HELP_CONTENTS[_currentScreenName] ? _currentScreenName : 'main'),
  };
  if (actionName === 'reset') {
    guideReset();
    return;
  }
  if (actionName === 'editDraft') {
    _guideDraft = null;
    _guideResult = null;
    _guideFormError = '';
    renderGuide();
    return;
  }
  if (actionName === 'submitDraft') {
    guideSubmitDraft();
    return;
  }
  if (actionName === 'close') {
    closeGuide();
    return;
  }
  const action = actions[actionName];
  if (!action) return;
  if (closeGuide()) _afterPopstate = action;
  else action();
}

async function guideSubmitDraft() {
  if (_guideSubmitting || !_guideDraft) return;
  if (_isPreviewMode) {
    _guideResult = { ok: false, message: '閲覧モード中は送信できません。' };
    renderGuide();
    return;
  }
  if (!SESSION || !SESSION.uid) {
    _guideResult = { ok: false, message: 'ログイン情報を確認できません。いったんログインし直してください。' };
    renderGuide();
    return;
  }

  const draft = _guideDraft;
  _guideSubmitting = true;
  showLoading('送信中...');
  try {
    let data;
    if (draft.kind === 'request') {
      data = await apiGet('postRequest', {
        uid: SESSION.uid, name: SESSION.name, body: draft.data.body
      });
    } else if (draft.kind === 'bug') {
      data = await apiGet('postBugReport', {
        uid: SESSION.uid, name: SESSION.name, body: draft.data.body
      });
    } else if (draft.kind === 'distribution') {
      data = await apiGet('postDistributionReport', {
        uid: SESSION.uid, name: SESSION.name,
        reportDate: draft.data.reportDate,
        reportTime: draft.data.reportTime || '',
        items: draft.data.items,
        notes: draft.data.notes || '',
      });
    } else {
      throw new Error('送信対象が見つかりません');
    }
    if (!data || !data.ok) throw new Error((data && data.error) || '送信に失敗しました');
    _guideDraft = null;
    _guideFormValues = {};
    _guideResult = {
      ok: true,
      message: draft.kind === 'request' ? '要望・質問を送信しました。' :
        draft.kind === 'bug' ? '不具合報告を送信しました。' : '配布報告を送信しました。'
    };
  } catch (e) {
    _guideResult = { ok: false, message: '送信できませんでした。\n' + (e.message || 'もう一度お試しください。') };
  } finally {
    _guideSubmitting = false;
    await hideLoading();
    renderGuide();
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
          { icon: ic('square-pen'), text: 'シフト希望を送る（参加できる時間帯を申告）' },
          { icon: ic('clipboard'), text: 'シフト表を確認する（公開後に閲覧可能）' },
          { icon: ic('message-circle'), text: '区域係への要望・ご意見を送る' },
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
          { icon: ic('triangle-alert', {color:'#B45309'}), text: 'アクセス許可されていないアカウントではログインできません。区域係にご連絡ください。' },
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
          { icon: ic('square-pen'), text: '「シフト希望を送る」：受付中のみ利用可。参加できる時間帯を選んで送信します。' },
          { icon: ic('clipboard'), text: '「シフト表を見る」：シフト公開後に全員のシフト表を確認できます。' },
          { icon: ic('image'), text: '「〇月の展示内容」：公開されたシフトの月の展示写真です。サムネイルをタップすると拡大して見られます。シフト公開前や、写真が登録されていない月は表示されません。' },
          { icon: ic('settings'), text: '「その他のメニュー」：要望・バグ報告・インストール・操作マニュアルがまとまっています。タップで開きます。' },
          { icon: ic('message-circle'), text: '「要望を送る」：区域係へのご意見・要望を送ることができます。' },
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
          { icon: ic('__cart__'), text: 'カート担当に指定されている方のみ表示される項目です' },
          { icon: ic('triangle-alert', {color:'#B45309'}), text: 'その時間帯にカート担当ができない場合はチェックを入れてください' },
        ]
      },
      {
        title: '備考欄について',
        items: [
          { icon: ic('square-pen'), text: '途中参加・早退などがある場合はボタンで種類を選んでください' },
          { icon: ic('clock'), text: '「遅れて参加」「早めに退出」「一部のみ」を選ぶと時刻を選択できます' },
          { icon: ic('pencil'), text: 'それ以外の連絡事項は「その他」を選んで入力してください' },
        ]
      },
      {
        title: '先月と同じにする',
        items: [
          { icon: ic('refresh-cw'), text: '先月の回答がある場合に表示されます。ONにすると先月と同じ時間帯が自動で選択されます。' },
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
          { icon: ic('__dot__', {color:'#2563eb'}), text: '北口エリアの担当者一覧（時間ごとに最大3名）' },
          { icon: ic('__dot__', {color:'#ea580c'}), text: '南口エリアの担当者一覧（時間ごとに最大3名）' },
          { icon: ic('__cart__'), text: 'カート欄：持ち込み・持ち帰り担当者とカート番号' },
        ]
      },
      {
        title: 'その他の表示',
        items: [
          { icon: ic('ban', {color:'#DC2626'}), text: '赤いバナーが表示されている日は「中止」です' },
          { icon: ic('square-pen'), text: '責任者メモが表示されている場合は内容を確認してください' },
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
          { icon: ic('triangle-alert', {color:'#B45309'}), text: 'このフォームはシフト希望の変更には使用できません。シフト希望の変更は直接区域係にご連絡ください。' },
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
      // 画面を見ながら1つずつ進める新しいマニュアル
      url: 'https://jw-utazu.github.io/manual/walkthrough.html#/volunteer',
      icon: ic('book-open'), bg: 'var(--green-light)', color: 'var(--green-dark)',
      title: '奉仕者マニュアル', sub: '画面を見ながら1つずつ進められます',
      badge: null
    },
    SESSION && SESSION.isResponsible ? {
      url: 'https://jw-utazu.github.io/manual/walkthrough.html#/responsible',
      icon: ic('book-open'), bg: '#fef9c3', color: '#713f12',
      title: '責任者マニュアル', sub: '中止・メモ・奉仕者の入れ替え',
      badge: { text: '責任者', bg: '#fef9c3', color: '#713f12' }
    } : null,
    SESSION && SESSION.isAccountant ? {
      url: 'https://jw-utazu.github.io/manual/walkthrough.html#/accountant',
      icon: ic('book-open'), bg: '#dbeafe', color: '#1e40af',
      title: '会計者マニュアル', sub: '道路使用許可書の登録・差し替え',
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
  history.pushState({ screen: _currentScreenName, modal: 'manual' }, '');
  _modalInHistory = 'manual';
}

function closeManualModal() {
  document.getElementById('manual-overlay').classList.remove('show');
  if (_modalInHistory === 'manual') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
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
  // 基準時刻より前の古いセッションは破棄して、共通ログイン画面からやり直してもらう
  // （Googleのアイコンなどログイン時にしか取れない情報を集めるため。1度きり）
  if (pwgwsEnforceRelogin()) {
    clearSession();
    pwgwsGoToLogin();
    return;
  }

  // 疑似日付は「日付ピッカーで変更した直後のreload」以外では毎回リセットする
  // （閉じ忘れて実日付だと勘違いする事故を防ぐため）
  if (sessionStorage.getItem('debugFakeNowKeepOnce')) {
    sessionStorage.removeItem('debugFakeNowKeepOnce');
  } else {
    localStorage.removeItem('debugFakeNow');
  }

  // 起動スプラッシュを表示（ログインは共通ログイン画面で完了済み）
  showBootSplash();

  // 救済ログインのセッションを先に確認する（Googleアカウントが使えない人のため、
  // 通常のGoogle認証より前に判定する）。有効期限はサーバー側で検証される
  if (await tryRecoverySession()) return; // initApp() 内でスプラッシュを閉じる

  // アプリ固有キャッシュでは本人確認しない。共通セッションの不透明tokenと、
  // サーバーが返す現在の権限だけで復元する。
  const shared = pwgwsGetSession();
  const sessionToken = pwgwsGetSessionToken();
  const appCache = loadSession();
  const saved = shared && sessionToken ? {
    email: shared.email,
    token: sessionToken,
    picture: shared.picture || (appCache && appCache.email === shared.email ? appCache.picture : '') || ''
  } : null;
  if (saved) {
    try {
      // 権限確認と初期データ取得を1回のAPI呼び出し（formBootstrap）にまとめて、
      // 起動時の往復を1回減らす
      const restoreAuthQuery = { source: 'form' };
      if (_consumeSimulateRegisterFlag()) restoreAuthQuery.simulateRegister = '1';
      const data = await apiGet('formBootstrap', restoreAuthQuery);
      if (!data.ok) {
        hideBootSplash();
        clearSession();
        pwgwsGoToLogin('expired');
        return;
      }
      if (data.needsRegister) {
        hideBootSplash();
        buildRegisterScreen(data.members || [], data.email || saved.email, saved.token, '', saved.picture || '');
        return;
      }
      SESSION = {
        uid: data.uid, name: data.name, email: data.email || saved.email, token: saved.token,
        isAdmin: data.isAdmin, isResponsible: data.isResponsible,
        isCart: data.isCart, isAccountant: data.isAccountant || false, proxyTargets: data.proxyTargets || [],
        positionName: data.positionName || '', extraCaps: data.extraCaps || [],
        picture: saved.picture || '', avatar: data.avatar || '',
        avatarIsCustom: !!data.avatarIsCustom, avatarIsPrivate: !!data.avatarIsPrivate,
        avatarHasGoogle: !!data.avatarHasGoogle
      };
      // スプラッシュを閉じずそのままinitAppへ。formBootstrapで取得済みのデータを渡し、
      // isLimitedMember・dataMini・getFormDetail・getShiftTableの再取得を省く
      await initApp({ limited: data.limited, formData: data.formData, detail: data.detail, shiftTable: data.shiftTable });
      return;
    } catch(e) {
      hideBootSplash();
      // アプリ表示用キャッシュだけ破棄する。別アカウントの有効なsession一覧は残す。
      try { localStorage.removeItem(SS_KEY); } catch (_) {}
      pwgwsGoToLogin(e && e.authError ? 'expired' : '');
      return;
    }
  }
  // 未ログイン：共通ログイン画面へ送る（このアプリ内に認証画面は持たない）
  hideBootSplash();
  pwgwsGoToLogin();
})();
// ===== 写真閲覧モーダル =====
const ACCOUNTING_URL = 'https://docs.google.com/spreadsheets/d/1_eacoOvEoj2k6SjuoTJnM8_QBRGxzhogWkhjZkP1Vyk/edit';

let _photoList    = [];
let _photoCurrent = 0;

// ym を渡すとその年月の写真を表示する（省略時は申込中の月）。
// シフト表から開く場合は、申込中の月と別の月のシフトを見ていることがあるため必ず渡す
async function openPhotoModal(category, ym) {
  const overlay = document.getElementById('photo-modal-overlay');
  const titleEl = document.getElementById('photo-modal-title');
  const imgEl   = document.getElementById('photo-modal-img');
  const loadEl  = document.getElementById('photo-modal-loading');

  overlay.style.display = 'flex';
  history.pushState({ screen: _currentScreenName, modal: 'photo' }, '');
  _modalInHistory = 'photo';
  titleEl.innerHTML   = category === 'road' ? (ic('map') + ' 道路使用許可書') : (ic('image') + ' カート展示内容');
  imgEl.style.display   = 'none';
  loadEl.style.display  = 'block';
  _photoList    = [];
  _photoCurrent = 0;

  try {
    const res = await apiGet('getPhotos', {
      category,
      year:  (ym && ym.year)  || YEAR  || new Date().getFullYear(),
      month: (ym && ym.month) || MONTH || (new Date().getMonth() + 1),
    });
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
  const imgEl  = document.getElementById('photo-modal-img');
  const loadEl = document.getElementById('photo-modal-loading');
  if (!_photoList.length) return;
  _photoCurrent = Math.max(0, Math.min(idx, _photoList.length - 1));
  imgEl.style.display  = 'none';
  loadEl.style.display = 'block';
  loadEl.textContent   = '読み込み中...';
  const photo    = _photoList[_photoCurrent];
  const fallback = photo.fallbackUrl && photo.fallbackUrl !== photo.url ? photo.fallbackUrl : '';
  let triedFallback = false;
  imgEl.onload = () => { loadEl.style.display = 'none'; imgEl.style.display = 'block'; };
  imgEl.onerror = () => {
    if (fallback && !triedFallback) { triedFallback = true; imgEl.src = fallback; return; }
    loadEl.textContent = '画像を読み込めませんでした';
  };
  imgEl.src = photo.url;
}

function closePhotoModal() {
  document.getElementById('photo-modal-overlay').style.display = 'none';
  _photoList = []; _photoCurrent = 0;
  if (_modalInHistory === 'photo') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
}

function openAccountingSheet() {
  window.open(ACCOUNTING_URL, '_blank');
}

// ===== シフト表詳細：カート展示写真ボタン =====
function openExhibitPhotoFromShift() {
  // 見ているシフト表の月の展示内容を出す（申込中の月とは別の月のことがある）
  openPhotoModal('exhibit', SHIFT_DATA ? { year: SHIFT_DATA.year, month: SHIFT_DATA.month } : null);
}

// ===== ホーム：展示内容写真カード =====
// 月に1枚だけ登録される運用のため、複数枚の選択UI（サムネイル一覧・+N表示）は持たない
let _exhibitPhotos  = [];
let _exhibitLoadSeq = 0;

// 一覧のサムネイルは軽量サイズで取得する（拡大モーダル側は w1920 のまま）。
// URLは2形式ある：Drive CDN直リンク（末尾 =w1920）と drive.google.com（&sz=w1920）
function _exhibitThumbUrl(url) {
  const s = String(url || '');
  if (/=w\d+$/.test(s)) return s.replace(/=w\d+$/, '=w400');
  return s.replace(/([?&]sz=)w\d+/, '$1w400');
}

// Drive CDN直リンクは署名に有効期限があるため、読めなかったら従来URLで1度だけ再試行する
function _photoImgFallback(img) {
  const fb = img.getAttribute('data-fallback');
  img.removeAttribute('data-fallback');
  img.onerror = null;
  if (fb) img.src = fb;
}

// buildMainScreen から呼ぶ。表示するのは公開済みシフトの年月の写真のみ。
// 読み込み中や写真が無い月は常に非表示のままにし、写真が確認できたときだけ表示する
// （「まず表示してから無ければ隠す」ではなく「無ければ表示しない」の順にする）
async function loadExhibitPhotoCard(isOpenPassed) {
  const card    = document.getElementById('exhibit-photo-card');
  const thumbs  = document.getElementById('exhibit-photo-thumbs');
  const titleEl = document.getElementById('exhibit-photo-title');
  if (!card || !thumbs || !titleEl) return;
  // 年月・PWタイプの切替が連続したとき、古い応答が後着して上書きするのを防ぐ
  const seq = ++_exhibitLoadSeq;
  _exhibitPhotos = [];
  card.style.display = 'none';
  thumbs.innerHTML   = '';
  // 公開中のシフトがあればその月を、無ければ申込中の月を対象にする。
  // 来月の申込が始まっても今月のシフトはまだ動いているため、公開中のシフトを優先する
  const exYear  = (SHIFT_DATA && SHIFT_DATA.published && SHIFT_DATA.year)  || YEAR  || new Date().getFullYear();
  const exMonth = (SHIFT_DATA && SHIFT_DATA.published && SHIFT_DATA.month) || MONTH || (new Date().getMonth() + 1);
  // シフト公開前は通信もせずに非表示のままにする
  if (!isOpenPassed && !(SHIFT_DATA && SHIFT_DATA.published)) return;
  try {
    const res = await apiGet('getPhotos', { category: 'exhibit', year: exYear, month: exMonth });
    if (seq !== _exhibitLoadSeq) return;
    _exhibitPhotos = (res && res.photos) || [];
  } catch (e) {
    if (seq !== _exhibitLoadSeq) return;
    _exhibitPhotos = [];
  }
  if (_exhibitPhotos.length === 0) return; // 非表示のまま
  const p  = _exhibitPhotos[0];
  const fb = p.fallbackUrl && p.fallbackUrl !== p.url ? _exhibitThumbUrl(p.fallbackUrl) : '';
  titleEl.innerHTML = ic('image') + ' ' + exMonth + '月の展示内容';
  thumbs.innerHTML = '<div class="exhibit-thumb" onclick="event.stopPropagation();openExhibitPhotoCard()">'
        +   '<img src="' + esc(_exhibitThumbUrl(p.url)) + '"'
        +     (fb ? ' data-fallback="' + esc(fb) + '" onerror="_photoImgFallback(this)"' : '')
        +     ' alt="展示内容写真" loading="lazy">'
        + '</div>';
  card.style.display = '';
}

// カードから開く：取得済みの1枚を使い回すので再取得せず即座に表示できる
function openExhibitPhotoCard() {
  if (!_exhibitPhotos.length) { openPhotoModal('exhibit'); return; }
  document.getElementById('photo-modal-title').innerHTML   = ic('image') + ' カート展示内容';
  document.getElementById('photo-modal-overlay').style.display = 'flex';
  history.pushState({ screen: _currentScreenName, modal: 'photo' }, '');
  _modalInHistory = 'photo';
  _photoList = _exhibitPhotos.slice();
  showPhoto(0);
}

// ===== 道路使用許可書PDF閲覧モーダル（全ユーザー向け） =====
async function openRoadPdfModal() {
  const modal = document.getElementById('road-pdf-view-modal');
  const body = document.getElementById('road-pdf-view-body');
  showLoading('道路使用許可書を読み込み中...');
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
    body.classList.remove('has-document');
    body.replaceChildren();
    if (!pdfs.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:var(--sub);padding:20px;font-size:14px;';
      empty.textContent = '道路使用許可書が登録されていません';
      body.appendChild(empty);
    } else {
      body.classList.add('has-document');
      const iframe = document.createElement('iframe');
      iframe.src = 'https://drive.google.com/file/d/' + String(pdfs[0].fileId || '') + '/preview';
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.title = '道路使用許可書';
      body.appendChild(iframe);
    }
  } catch(e) {
    const error = document.createElement('div');
    error.style.cssText = 'color:var(--danger);padding:12px;font-size:13px;';
    error.textContent = '読み込みに失敗しました';
    body.replaceChildren(error);
  } finally {
    modal.classList.add('show');
    history.pushState({ screen: _currentScreenName, modal: 'roadPdf' }, '');
    _modalInHistory = 'roadPdf';
    await hideLoading();
  }
}

function closeRoadPdfModal() {
  document.getElementById('road-pdf-view-modal').classList.remove('show');
  if (_modalInHistory === 'roadPdf') {
    _modalInHistory = null;
    _suppressNextPopstate = true;
    history.go(-1);
  }
}

// ===== 道路使用許可書PDF管理画面（会計者向け） =====
async function _initRoadPermitScreen() {
  const card = document.getElementById('road-permit-list-card');
  const today = new Date();
  function _pad(n) { return String(n).padStart(2, '0'); }
  function _fmtDate(d) { return d.getFullYear() + '-' + _pad(d.getMonth()+1) + '-' + _pad(d.getDate()); }
  const managedYear  = YEAR  || today.getFullYear();
  const managedMonth = MONTH || (today.getMonth() + 1);
  const endOfMonth   = new Date(managedYear, managedMonth, 0);
  showLoading('道路使用許可書を読み込み中...');
  try {
    const res = await apiGet('getRoadPdfs', {});
    const pdfs = (res && res.pdfs) || [];

    document.getElementById('road-permit-file-input').value = '';
    document.getElementById('road-permit-upload-status').hidden = true;
    document.getElementById('road-permit-display-name').value = '道路使用許可書' + managedMonth + '月';
    document.getElementById('road-permit-start-date').value   = _fmtDate(today);
    document.getElementById('road-permit-end-date').value     = _fmtDate(endOfMonth);
    card.replaceChildren();
    if (!pdfs.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:20px;color:var(--sub);font-size:13px;';
      empty.textContent = '登録されているPDFはありません';
      card.appendChild(empty);
      return;
    }

    const title = document.createElement('div');
    title.className = 'card-title';
    title.style.marginBottom = '12px';
    title.innerHTML = ic('clipboard') + ' 登録済みPDF';
    card.appendChild(title);

    pdfs.forEach(p => {
      const fileId = String(p.fileId || '');
      const label = String(p.displayName || p.fileName || '名称未設定');
      const startDate = String(p.startDate || '');
      const endDate = String(p.endDate || '');
      const period = (startDate || endDate)
        ? (startDate ? startDate.replace(/-/g, '/') : '') + '〜' + (endDate ? endDate.replace(/-/g, '/') : '')
        : '';

      const row = document.createElement('div');
      row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--border);';
      const summary = document.createElement('div');
      summary.style.cssText = 'display:flex;align-items:center;gap:10px;';
      const icon = document.createElement('span');
      icon.style.cssText = 'font-size:20px;flex-shrink:0;';
      icon.innerHTML = ic('file-text');
      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      labelEl.textContent = label;
      info.appendChild(labelEl);
      if (period) {
        const periodEl = document.createElement('div');
        periodEl.style.cssText = 'font-size:11px;color:#92400e;font-weight:700;margin-top:1px;';
        periodEl.innerHTML = ic('calendar') + ' ' + esc(period);
        info.appendChild(periodEl);
      }
      const updatedEl = document.createElement('div');
      updatedEl.style.cssText = 'font-size:12px;color:var(--sub);margin-top:1px;';
      updatedEl.textContent = String(p.updatedAt || '');
      info.appendChild(updatedEl);
      summary.append(icon, info);
      row.appendChild(summary);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;margin-top:8px;padding-left:30px;';
      const makeButton = (text, style, handler) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.style.cssText = 'flex:1;padding:7px 6px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;' + style;
        button.innerHTML = text;
        button.addEventListener('click', handler);
        return button;
      };
      actions.append(
        makeButton(ic('search') + ' プレビュー', 'background:#f0fdf4;border:1px solid var(--border);color:var(--green);', () => showAdminPdfPreview(fileId, label)),
        makeButton(ic('pencil') + ' 編集', 'background:#fffbeb;border:1px solid #fde68a;color:#92400e;', () => openEditRoadPdf(fileId, label, startDate, endDate)),
        makeButton(ic('trash-2') + ' 削除', 'background:#fff1f2;border:1px solid #fca5a5;color:#b91c1c;', () => deleteRoadPdf(fileId, label))
      );
      row.appendChild(actions);
      card.appendChild(row);
    });
  } catch(e) {
    const error = document.createElement('div');
    error.style.cssText = 'color:var(--danger);padding:12px;font-size:13px;';
    error.textContent = '読み込みに失敗しました: ' + e.message;
    card.replaceChildren(error);
  } finally {
    await hideLoading();
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
  statusEl.hidden = true;
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
    statusEl.hidden = false;
    statusEl.textContent = 'アップロード完了！';
    document.getElementById('road-permit-file-input').value = '';
    await _initRoadPermitScreen();
  } catch(e) {
    await hideLoading();
    statusEl.hidden = false;
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
  document.getElementById('road-pdf-edit-overlay').classList.add('show');
  history.pushState({ screen: _currentScreenName, modal: 'roadPdfEdit' }, '');
  _modalInHistory = 'roadPdfEdit';
}
function closeEditRoadPdf() {
  document.getElementById('road-pdf-edit-overlay').classList.remove('show');
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
// 限定PWデータをサーバーから取得し LIMITED_* に格納
async function _loadLimitedPwData(type) {
  const [limFormData, limDetail, limShiftData] = await Promise.all([
    apiGet('dataMini',      { type }),
    apiGet('getFormDetail', { type }),
    apiGet('getShiftTable', { type })
  ]);
  limFormData.crossPwConflicts = limDetail.crossPwConflicts || limFormData.crossPwConflicts || {};
  LIMITED_APP_DATA   = limFormData;
  LIMITED_SHIFT_DATA = limShiftData;
  LIMITED_DETAIL     = limDetail;
}

// LIMITED_* を画面用のグローバル状態に反映
function _applyLimitedPwData() {
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
}

// ============================================================
// テストアカウント専用：限定PWメンバーでなくても全タイプを閲覧できるようにする
// ============================================================
let _testLimitedTypes = [];
// ピッカーの表示は「テストアカウント・候補が2つ以上・現在限定PWタブを見ている」の場合のみ
// （候補が1つしかない場合は切り替える意味がないので出さない）
function _updateTestLimitedPickerVisibility() {
  const picker = document.getElementById('test-limited-type-picker');
  if (!picker) return;
  const isTest = SESSION && SESSION.email === TEST_EMAIL;
  picker.classList.toggle('show', isTest && _testLimitedTypes.length > 1 && currentPwType === 'limited');
}
// 候補が複数あるときはタブ名は「限定PW」固定、1つだけならその限定PWの名前にする
function _testLimitedTabLabel(name) {
  return _testLimitedTypes.length > 1 ? '限定PW' : (name || '限定PW');
}
async function loadTestLimitedTypePicker() {
  const picker = document.getElementById('test-limited-type-picker');
  if (!picker) return;
  try {
    const res = await apiGet('getLimitedSlots', {});
    // 旧型の既定枠'limited'は実際に使われていないケースがあるため含めない。
    // 管理者が実際に作成した限定PWタイプのみを候補にする
    _testLimitedTypes = (res && res.slots) || [];
  } catch (e) {
    _testLimitedTypes = [];
  }
  // 実在するタイプがあればデフォルト選択にする（未設定の可能性がある旧型'limited'は使わない）
  if (_testLimitedTypes.length > 0) {
    limitedPwType = _testLimitedTypes[0].id;
    limitedPwName = _testLimitedTabLabel(_testLimitedTypes[0].name);
    const tabLimited = document.getElementById('pw-tab-form-limited');
    if (tabLimited) tabLimited.textContent = limitedPwName;
  }
  picker.innerHTML = _testLimitedTypes.map(t =>
    '<button type="button" class="test-limited-chip' + (t.id === limitedPwType ? ' active' : '') +
    '" data-type="' + esc(t.id) + '" onclick="selectTestLimitedType(\'' + esc(t.id) + '\',\'' + esc(t.name) + '\')">' +
    esc(t.name) + '</button>'
  ).join('');
  _updateTestLimitedPickerVisibility();
}

// テストアカウントが特定の限定PWタイプを選択したときの切り替え
async function selectTestLimitedType(newType, newName) {
  if (limitedPwType === newType && currentPwType === 'limited') return;
  const prev = _capturePwViewState();
  showLoading('限定PWデータを読み込み中...');
  try {
    await _loadLimitedPwData(newType);
    limitedPwType = newType;
    limitedPwName = _testLimitedTabLabel(newName);
    currentPwType = 'limited';
    _applyLimitedPwData();
    _knownTimestamp = null;
    _setPwTypeUi('limited');
    _tabSnapshots = {};
    buildMainScreen();
    await hideLoading();
  } catch(e) {
    _restorePwViewState(prev);
    _setPwTypeUi(prev.currentPwType);
    try { buildMainScreen(); } catch (_) {}
    await hideLoading();
    alert('データ読み込みエラー: ' + e.message);
  }
}

async function switchFormPwType(type) {
  if (currentPwType === type) return;
  const prev = _capturePwViewState();
  showLoading(type === 'limited' ? '限定PWデータを読み込み中...' : '通常PWデータを読み込み中...');
  try {
    if (type === 'limited') {
      // 限定PW データを再フェッチ（キャッシュがあれば使う）
      if (!LIMITED_APP_DATA) await _loadLimitedPwData(limitedPwType);
      _applyLimitedPwData();
    } else {
      // 通常PW に戻す（initApp で取得したデータを再フェッチ）
      const [formData, detail, shiftData] = await Promise.all([
        apiGet('dataMini',      { type: 'normal' }),
        apiGet('getFormDetail', { type: 'normal' }),
        apiGet('getShiftTable', { type: 'normal' })
      ]);
      formData.crossPwConflicts = detail.crossPwConflicts || formData.crossPwConflicts || {};
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
    }
    currentPwType = type;
    _knownTimestamp = null;
    _setPwTypeUi(type);
    _tabSnapshots = {};
    buildMainScreen();
    await hideLoading();
  } catch(e) {
    _restorePwViewState(prev);
    _setPwTypeUi(prev.currentPwType);
    try { buildMainScreen(); } catch (_) {}
    await hideLoading();
    alert('データ読み込みエラー: ' + e.message);
  }
}

function _capturePwViewState() {
  return {
    currentPwType, limitedPwType, limitedPwName,
    APP_DATA, SHIFT_DATA, THIS_MONTH, SLOTS, LAST_MONTH, YEAR, MONTH,
    SHIFT_DATES, SHIFT_DATES_MAP, LIMITED_APP_DATA, LIMITED_SHIFT_DATA, LIMITED_DETAIL,
    knownTimestamp: _knownTimestamp,
  };
}

function _restorePwViewState(s) {
  currentPwType = s.currentPwType; limitedPwType = s.limitedPwType; limitedPwName = s.limitedPwName;
  APP_DATA = s.APP_DATA; SHIFT_DATA = s.SHIFT_DATA; THIS_MONTH = s.THIS_MONTH;
  SLOTS = s.SLOTS; LAST_MONTH = s.LAST_MONTH; YEAR = s.YEAR; MONTH = s.MONTH;
  SHIFT_DATES = s.SHIFT_DATES; SHIFT_DATES_MAP = s.SHIFT_DATES_MAP;
  LIMITED_APP_DATA = s.LIMITED_APP_DATA; LIMITED_SHIFT_DATA = s.LIMITED_SHIFT_DATA; LIMITED_DETAIL = s.LIMITED_DETAIL;
  _knownTimestamp = s.knownTimestamp;
}

function _setPwTypeUi(type) {
  document.getElementById('pw-tab-form-normal').className =
    'pw-type-tab-form' + (type === 'normal' ? ' active' : '');
  document.getElementById('pw-tab-form-limited').className =
    'pw-type-tab-form limited' + (type === 'limited' ? ' active' : '');
  const tabLimited = document.getElementById('pw-tab-form-limited');
  if (tabLimited) tabLimited.textContent = limitedPwName;
  document.querySelectorAll('#test-limited-type-picker .test-limited-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.type === limitedPwType);
  });
  _updateTestLimitedPickerVisibility();
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
