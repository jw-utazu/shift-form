// ============================================================
// 確認・通知・入力ダイアログ（uiConfirm / uiAlert / uiPrompt）
// ============================================================
// ブラウザ標準の confirm() / alert() / prompt() の置き換え。標準ダイアログは
//   ・端末ごとに見た目が違い、PWA では文面の頭にサイトのURLが出る
//   ・改行や強調が効かず、危険な操作ほど文面が読み飛ばされる
//   ・iOS の PWA では表示位置が不安定
// という問題があるため、アプリ内ダイアログに統一する。
// admin/js/confirm.js と同じ仕組み。見た目はこのアプリの緑系の変数に合わせ、
// 文字とボタンは奉仕者向けに大きめにしている（スタイルはこのファイルから1度だけ注入する）。

(function () {
  'use strict';

  var STYLE_ID = 'ui-confirm-style';
  var _root = null;      // オーバーレイ要素（初回生成後は使い回す）
  var _resolve = null;   // 表示中のダイアログの解決関数
  var _prevFocus = null; // 開く前にフォーカスがあった要素（閉じたら戻す）

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    // z-index はトースト(10000)より上。確認ダイアログは常に最前面に出す
    s.textContent = [
      '.uic-ov{position:fixed;inset:0;z-index:10500;background:rgba(0,0,0,.45);',
      '  display:none;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(2px);}',
      '.uic-ov.open{display:flex;}',
      '.uic-hidden{display:none!important;}',
      '.uic-box{background:var(--card,#fff);color:var(--text,#1e293b);border-radius:var(--radius,14px);',
      '  width:100%;max-width:420px;max-height:88vh;overflow-y:auto;font-family:\"Noto Sans JP\",sans-serif;',
      '  box-shadow:0 10px 30px rgba(0,0,0,.22);animation:uic-in .16s ease;}',
      '@keyframes uic-in{from{opacity:0;transform:translateY(10px) scale(.98);}}',
      '.uic-hd{display:flex;align-items:flex-start;gap:10px;padding:16px 18px 0;}',
      '.uic-ic{font-size:20px;line-height:1.2;flex-shrink:0;}',
      '.uic-ic svg{width:22px;height:22px;display:block;}',
      '.uic-tt{font-size:16px;font-weight:700;line-height:1.5;padding-top:1px;}',
      '.uic-bd{padding:9px 18px 16px 46px;font-size:15px;line-height:1.75;color:var(--sub,#374151);',
      '  white-space:pre-wrap;word-break:break-word;}',
      '.uic-ft{padding:0 18px 16px;display:flex;gap:8px;justify-content:flex-end;}',
      '.uic-btn{padding:8px 16px;border:none;border-radius:10px;font-family:\"Noto Sans JP\",sans-serif;',
      '  font-size:15px;font-weight:700;cursor:pointer;min-height:44px;transition:filter .15s;}',
      '.uic-btn:hover{filter:brightness(.94);}',
      '.uic-btn:focus-visible{outline:2px solid var(--green,#15803d);outline-offset:2px;}',
      '.uic-cancel{background:#f8fafc;color:var(--sub,#374151);border:1px solid #cbd5e1;}',
      '.uic-ok{background:var(--green,#15803d);color:#fff;}',
      '.uic-ok.danger{background:var(--danger,#dc2626);}',
      '.uic-ok.warn{background:var(--amber-dark,#f59e0b);}',
      '.uic-in-wrap{padding:0 18px 14px 46px;}',
      '.uic-in{width:100%;box-sizing:border-box;min-height:84px;resize:vertical;padding:8px 10px;',
      '  border:1px solid #cbd5e1;border-radius:10px;background:var(--card,#fff);',
      '  color:var(--text,#1e293b);font-family:\"Noto Sans JP\",sans-serif;font-size:16px;line-height:1.6;}',
      '.uic-in:focus{outline:2px solid var(--green,#15803d);outline-offset:1px;border-color:transparent;}',
      '.uic-in-hint{margin-top:4px;font-size:12px;color:#6b7280;}',
      '@media (max-width:480px){',
      '  .uic-bd{padding-left:18px;}',
      '  .uic-in-wrap{padding-left:18px;}',
      '  .uic-ft{flex-direction:column-reverse;}',
      '  .uic-ft .uic-btn{width:100%;padding:11px 16px;}',
      '}',
    ].join('\n');
    document.head.appendChild(s);
  }

  function build() {
    injectStyle();
    if (_root) return _root;
    _root = document.createElement('div');
    _root.className = 'uic-ov';
    _root.innerHTML =
      '<div class="uic-box" role="alertdialog" aria-modal="true" aria-labelledby="uic-tt" aria-describedby="uic-bd">'
      + '<div class="uic-hd"><span class="uic-ic" id="uic-ic"></span><div class="uic-tt" id="uic-tt"></div></div>'
      + '<div class="uic-bd" id="uic-bd"></div>'
      + '<div class="uic-in-wrap uic-hidden" id="uic-in-wrap">'
      + '<textarea class="uic-in" id="uic-in" rows="3"></textarea>'
      + '<div class="uic-in-hint" id="uic-in-hint"></div>'
      + '</div>'
      + '<div class="uic-ft" id="uic-ft"></div>'
      + '</div>';
    document.body.appendChild(_root);
    // 背景クリックはキャンセル扱い（誤操作で「実行」になることは無いようにする）
    _root.addEventListener('click', function (e) { if (e.target === _root) done(false); });
    return _root;
  }

  // Esc＝キャンセル / Enter＝既定ボタン。キャプチャ段階で拾い、
  // 背後の画面のショートカットに二重で流れないようにする
  function onKey(e) {
    if (!_resolve) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    else if (e.key === 'Enter') {
      // 入力欄では Enter を改行に使う。確定は Ctrl/⌘+Enter かボタンで行う
      if (_promptMode && !(e.ctrlKey || e.metaKey)) return;
      if (e.isComposing) return;
      e.preventDefault(); e.stopPropagation(); done(true);
    }
  }

  var _promptMode = false; // uiPrompt 表示中か（入力欄を表示し、結果を文字列で返す）

  function done(result) {
    if (!_resolve) return;
    var r = _resolve;
    _resolve = null;
    document.removeEventListener('keydown', onKey, true);
    _root.classList.remove('open');
    _root.querySelector('#uic-in-wrap').classList.add('uic-hidden');
    _promptMode = false;
    if (_prevFocus && _prevFocus.focus) { try { _prevFocus.focus(); } catch (err) {} }
    _prevFocus = null;
    r(result);
  }

  // 種類ごとの見た目。危険な操作ほど赤く、既定ボタンの色で取り返しのつかなさを示す
  var TYPES = {
    danger:  { icon: ic('triangle-alert', { color: '#B45309' }), okClass: 'danger' },  // 削除・取り消しなど元に戻せない操作
    warn:    { icon: ic('circle-help'), okClass: 'warn'   },  // 影響が大きいが復旧できる操作
    info:    { icon: ic('bell', { color: '#15803D' }), okClass: ''       },  // 単なる確認
    error:   { icon: ic('triangle-alert', { color: '#B45309' }), okClass: '' },  // 失敗の知らせ（uiAlert 用）
    success: { icon: ic('circle-check-big', { color: '#15803D' }), okClass: ''       },
  };

  /**
   * 確認ダイアログ。標準 confirm() の置き換え。
   * @param {Object|string} opt 文字列を渡した場合は message として扱う
   *   title       見出し（既定：'確認'）
   *   message     本文。\n はそのまま改行として表示される
   *   confirmText 実行ボタンの文言（既定：'実行する'）
   *   cancelText  取消ボタンの文言（既定：'キャンセル'）
   *   type        'danger' | 'warn' | 'info'（既定：'warn'）
   * @returns {Promise<boolean>} 実行を選んだら true
   */
  window.uiConfirm = function (opt) {
    if (typeof opt === 'string') opt = { message: opt };
    opt = opt || {};
    var t = TYPES[opt.type] || TYPES.warn;
    var ov = build();
    // 表示中に別のダイアログを開こうとした場合、前のものはキャンセル扱いで閉じる
    if (_resolve) done(false);
    _prevFocus = document.activeElement;
    ov.querySelector('#uic-ic').innerHTML = t.icon;
    ov.querySelector('#uic-tt').textContent = opt.title || '確認';
    ov.querySelector('#uic-bd').textContent = opt.message || '';
    ov.querySelector('#uic-bd').classList.toggle('uic-hidden', !opt.message);
    ov.querySelector('#uic-ft').innerHTML =
      '<button class="uic-btn uic-cancel" id="uic-no"></button>'
      + '<button class="uic-btn uic-ok ' + t.okClass + '" id="uic-yes"></button>';
    ov.querySelector('#uic-no').textContent = opt.cancelText || 'キャンセル';
    ov.querySelector('#uic-yes').textContent = opt.confirmText || '実行する';
    ov.querySelector('#uic-no').onclick = function () { done(false); };
    ov.querySelector('#uic-yes').onclick = function () { done(true); };
    ov.classList.add('open');
    // 既定フォーカスは「キャンセル」。Enter 連打で危険な操作が通らないようにする
    ov.querySelector('#uic-no').focus();
    document.addEventListener('keydown', onKey, true);
    return new Promise(function (res) { _resolve = res; });
  };

  /**
   * 入力つき確認ダイアログ。標準 prompt() の置き換え。
   * 理由の入力と実行の確認を1つのダイアログで済ませる（prompt → confirm の2段にしない）。
   * @param {Object} opt uiConfirm と同じ項目に加えて
   *   placeholder 入力欄の例示
   *   value       入力欄の初期値
   *   hint        入力欄の下に出す補足
   *   maxLength   入力できる最大文字数（既定：500）
   * @returns {Promise<string|null>} 実行を選んだら入力文字列（前後の空白は除く）、キャンセルなら null
   */
  window.uiPrompt = function (opt) {
    opt = opt || {};
    var ov = build();
    var result = window.uiConfirm(opt);
    _promptMode = true;
    var input = ov.querySelector('#uic-in');
    input.value = opt.value || '';
    input.placeholder = opt.placeholder || '';
    input.maxLength = opt.maxLength || 500;
    var hint = ov.querySelector('#uic-in-hint');
    hint.textContent = opt.hint || '';
    hint.classList.toggle('uic-hidden', !opt.hint);
    ov.querySelector('#uic-in-wrap').classList.remove('uic-hidden');
    input.focus();
    return result.then(function (ok) { return ok ? input.value.trim() : null; });
  };

  /**
   * 通知ダイアログ。標準 alert() の置き換え。ボタンは1つだけ。
   * @returns {Promise<void>}
   */
  window.uiAlert = function (opt) {
    if (typeof opt === 'string') opt = { message: opt };
    opt = opt || {};
    var t = TYPES[opt.type] || TYPES.info;
    var ov = build();
    if (_resolve) done(false);
    _prevFocus = document.activeElement;
    ov.querySelector('#uic-ic').innerHTML = t.icon;
    ov.querySelector('#uic-tt').textContent = opt.title || 'お知らせ';
    ov.querySelector('#uic-bd').textContent = opt.message || '';
    ov.querySelector('#uic-bd').classList.toggle('uic-hidden', !opt.message);
    ov.querySelector('#uic-ft').innerHTML =
      '<button class="uic-btn uic-ok ' + t.okClass + '" id="uic-yes"></button>';
    ov.querySelector('#uic-yes').textContent = opt.okText || 'OK';
    ov.querySelector('#uic-yes').onclick = function () { done(true); };
    ov.classList.add('open');
    ov.querySelector('#uic-yes').focus();
    document.addEventListener('keydown', onKey, true);
    return new Promise(function (res) { _resolve = res; }).then(function () {});
  };
})();
