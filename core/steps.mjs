// flow のステップを作る小道具（全サイト共通）。cases.mjs から使う。
//   import { makeState, go, shot } from '../../../core/steps.mjs';
//   const state = makeState({ extra: { balance: '#balance' } });
//   flow: [...go('/coupons', 'クーポン一覧'), { aiTap: '「絞り込む」ボタン' }, state('S02'), shot('S-02 絞り込み後')]

// 画面の状態を 1 回で記録する（ブラウザ内で実行される。外側の変数は参照できない）。
// 戻り値：{ title, path, fields, checks, radios, errors, dl, dialogs, alert, status, caption, headers, table, rows, rowActions, rowLinks, text, buttons, links, ...extra }
//   fields  { id または name: { value, visible, disabled, readonly, invalid, text? } }（text は select の選択肢の表示名）
//   checks  { id または name: true/false }（チェックボックス）
//   radios  { name: 選択中の value または null }
//   errors  { 項目キー: 文言 }（表示中の項目エラー。キーは id の末尾「-error」を除いたもの）
//   dl      { 項目名: 値 }。dt/dd の組と、「見出しセル（th）＋値セル（td）」の 2 セルの行（古い画面の表形式の詳細表示）の両方を拾う
//   dialogs この前の state() 以降に出たダイアログ（alert / confirm / prompt）の文言の配列。site.dialogs = true のときだけ記録される
//   table   一覧の表（見出し行を持つ最初の表）の各行のセル文言（配列）。rows は同じ内容を「先頭セルの文言」で引ける形にしたもの
//   rowActions  { 先頭セルの文言: 行内のリンク・ボタンの文言の配列 }。rowLinks は行内にリンクがあるか（table と同じ順）
//   text    本文（main、なければ body）の表示文言。「〜と表示されている」を includes で確認する用
// opt：{ titleSelector（h1 がない画面の見出し）, errorSelector, alertSelector, statusSelector, extra: { 名前: セレクター } }
export function pageState(opt = {}) {
  const txt = e => (e?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const vis = e => !!e && e.getClientRects().length > 0 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden';
  const key = e => e.id || e.name || '';
  const fields = {}; const checks = {}; const radios = {};
  for (const e of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (e.type === 'radio') { radios[e.name] ??= null; if (e.checked) radios[e.name] = e.value; continue; }
    if (!key(e)) continue;
    if (e.type === 'checkbox') { checks[key(e)] = e.checked; continue; }
    fields[key(e)] = { value: e.value, visible: vis(e), disabled: e.disabled, readonly: !!e.readOnly, invalid: e.getAttribute('aria-invalid') === 'true',
      ...(e.tagName === 'SELECT' ? { text: e.selectedOptions[0]?.textContent.trim() ?? null } : {}) };
  }
  const errorSelector = opt.errorSelector ?? '.field-error, .invalid-feedback, .error-message, [id$="-error"]';
  const errors = {}; const errorEls = new Set();
  document.querySelectorAll(errorSelector).forEach((p, i) => {
    if (!vis(p) || !txt(p)) return;
    errorEls.add(p);
    const owner = p.id && document.querySelector(`[aria-describedby~="${CSS.escape(p.id)}"]`);
    errors[(owner && key(owner)) || p.id.replace(/[-_]?error$/i, '') || `#${i}`] = txt(p);
  });
  const first = sel => [...document.querySelectorAll(sel)].find(e => vis(e) && txt(e) && !errorEls.has(e));
  const dl = {};
  document.querySelectorAll('dt').forEach(dt => { dl[txt(dt)] = txt(dt.nextElementSibling); });
  // 「見出しセル＋値セル」の行は項目と値の組として dl に入れ、一覧の行（table）には含めない
  const pair = r => r.cells.length === 2 && r.cells[0].tagName === 'TH' && r.cells[1].tagName === 'TD';
  document.querySelectorAll('tr').forEach(r => { if (pair(r) && !r.cells[1].querySelector('input, select, textarea')) dl[txt(r.cells[0])] = txt(r.cells[1]); });
  // 一覧の表：見出し行（th）を持つ最初の表。なければ、入力部品を含まないデータ行（レイアウト用の表のフォームを一覧と見なさない）
  const dataRow = r => !r.querySelector('th') && !pair(r) && vis(r);
  const tableEl = [...document.querySelectorAll('table')].find(t => vis(t) && [...t.rows].some(r => r.cells.length > 1 && [...r.cells].every(c => c.tagName === 'TH'))) ?? null;
  const rows = tableEl ? [...tableEl.querySelectorAll('tbody tr')].filter(dataRow) : [...document.querySelectorAll('tbody tr')].filter(r => dataRow(r) && !r.querySelector('input, select, textarea'));
  // ダイアログの記録（DIALOG_HOOK が sessionStorage に積んだもの）を読み取り、読んだ分は消す
  let dialogs = [];
  try { dialogs = JSON.parse(sessionStorage.getItem('__dialogs') || '[]').map(d => d.message); sessionStorage.removeItem('__dialogs'); } catch {}
  const rowsByKey = {}; const rowActions = {};
  for (const r of rows) { const k = txt(r.cells[0]); if (!k) continue; rowsByKey[k] = [...r.cells].map(txt); rowActions[k] = [...r.querySelectorAll('a, button')].filter(vis).map(txt); }
  const extra = {};
  for (const [name, sel] of Object.entries(opt.extra ?? {})) extra[name] = txt(document.querySelector(sel)) || null;
  return { title: txt(document.querySelector(opt.titleSelector ?? 'h1')), path: location.pathname, fields, checks, radios, errors, dl, dialogs,
    alert: txt(first(opt.alertSelector ?? '[role=alert]')) || null, status: txt(first(opt.statusSelector ?? '[role=status]')) || null,
    caption: txt(document.querySelector('caption')) || null, headers: tableEl ? [...[...tableEl.rows].find(r => r.cells.length > 1 && [...r.cells].every(c => c.tagName === 'TH')).cells].map(txt) : [],
    table: rows.map(r => [...r.cells].map(txt)), rows: rowsByKey, rowActions, rowLinks: rows.map(r => !!r.querySelector('a')),
    text: txt(document.querySelector('main') ?? document.body).slice(0, 4000),
    buttons: [...document.querySelectorAll('button, input[type=submit], input[type=button], [role=button]')].filter(vis).map(b => txt(b) || b.value),
    links: [...document.querySelectorAll('a[href]')].filter(vis).map(txt), ...extra };
}

// 画面状態を name で出力 JSON に記録するステップを作る関数を返す
export const makeState = (opt = {}) => name => ({ javascript: `(${pageState.toString()})(${JSON.stringify(opt)})\n`, name });
export const state = makeState();

// 画面遷移（URL 直接）。title を渡すと見出しの表示まで待つ。
// Playwright では page.goto、Midscene の YAML では javascript＋sleep に変換される（core/runner.mjs の toYamlSteps）
export const go = (path, title, timeout = 15000) => [{ goto: path }, ...(title ? [{ aiWaitFor: `「${title}」画面が表示されている`, timeout }] : [])];

// 証跡の画面を撮る。label は「ケースID 説明」
export const shot = label => ({ recordToReport: label });

// ---------- ダイアログ（alert / confirm / prompt） ----------
// 古い画面は入力エラーや確認をブラウザのダイアログで出す。ダイアログは DOM に現れず、自動操作では放置すると勝手に閉じられるため、
// site.dialogs = true のとき、ページ側の alert / confirm / prompt を差し替えて「文言を記録し、決めた答えを返す」ようにする。
//   記録：state() の dialogs に、前回の state() 以降の文言が入る
//   答え：既定は OK。次のダイアログでキャンセルしたいときは、その操作の前に answerDialog('cancel') を置く（1 回だけ有効）
// Playwright では全ページの読み込み時に、Midscene の YAML ではクリック・キー入力の直前に自動で差し込む。
export function dialogHook() {
  if (window.__dialogHook) return;
  window.__dialogHook = true;
  const log = (type, message) => { try { const l = JSON.parse(sessionStorage.getItem('__dialogs') || '[]'); l.push({ type, message: String(message) }); sessionStorage.setItem('__dialogs', JSON.stringify(l)); } catch {} };
  const answer = () => { const a = sessionStorage.getItem('__dialogAnswer'); sessionStorage.removeItem('__dialogAnswer'); return a; };
  window.alert = m => { log('alert', m); answer(); }; // 答えの指定は「次のダイアログ 1 回」だけに効く
  window.confirm = m => { log('confirm', m); return answer() !== 'cancel'; };
  window.prompt = (m, d) => { log('prompt', m); const a = answer(); return a === 'cancel' ? null : a ?? d ?? ''; };
}
export const DIALOG_HOOK = `(${dialogHook.toString()})()\n`;
// 次に出るダイアログへの答えを決める：'ok'（既定）/ 'cancel' / prompt に入力する文字列
export const answerDialog = answer => ({ javascript: `sessionStorage.setItem('__dialogAnswer', ${JSON.stringify(answer)});\n` });

// Midscene の YAML には goto がないため、遷移を setTimeout で予約して sleep で待つ（javascript ステップは遷移完了を待てない）。
// dialogs:true のときは、ダイアログを出しうる操作（クリック・キー入力）の直前に差し替えを入れる
export function toYamlSteps(step, { dialogs = false } = {}) {
  if ('goto' in step) return [{ javascript: `setTimeout(() => { location.href = '${step.goto}'; }, 300);\n` }, { sleep: 1500 }];
  if (dialogs && ('aiTap' in step || 'aiKeyboardPress' in step)) return [{ javascript: DIALOG_HOOK }, step];
  return [step];
}

// 前のケースの画面を引き継ぐケースか（flow が goto で始まらない）。continues を明示すればそれを優先
export const continues = c => c.continues ?? !(c.flow[0] && 'goto' in c.flow[0]);
