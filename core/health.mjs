// 自動検査（Playwright エンジン・全ケース共通）：ケースを書かなくても毎回確認する項目。
// AI の目視（aiAssert）を実施しない Playwright モードで、画面の壊れ方のうち機械的に拾えるものを補う。
//   error（ケースを NG にする）：JS の例外、HTTP 5xx、画像の読み込み失敗、画面に「undefined」「NaN」「[object Object]」が表示されている
//   warn （結果には載せるが合否は変えない）：console.error、同一オリジンの 4xx、横スクロールの発生、文字の切れ、ラベルのない入力欄、id の重複
// site.health = false で無効化。site.health = { ignore: [/正規表現/] } で「種別：内容」に一致する検出を除外する。

// ブラウザ内で実行する画面検査
export function lintPage() {
  const txt = e => (e?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const vis = e => !!e && e.getClientRects().length > 0 && !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden';
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const bad = /(^|[^\w.])(undefined|NaN)(?![\w.])|\[object Object\]/;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || p.closest('script, style, pre, code, textarea, noscript') || !bad.test(n.nodeValue) || !vis(p)) continue;
    out.push({ level: 'error', kind: '不正な表示値', detail: txt(p).slice(0, 80) });
  }
  for (const img of document.images) if (img.complete && img.naturalWidth === 0 && img.getAttribute('src') && vis(img)) out.push({ level: 'error', kind: '画像の読み込み失敗', detail: img.getAttribute('src').slice(0, 80) });
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.push({ level: 'warn', kind: '横スクロールの発生', detail: `内容の幅 ${de.scrollWidth}px ＞ 画面の幅 ${de.clientWidth}px` });
  for (const e of document.querySelectorAll('td, th, dd, dt, label, button, a, p, li, h1, h2, h3, span')) {
    if (e.children.length || !vis(e) || e.scrollWidth <= e.clientWidth + 1) continue;
    const cs = getComputedStyle(e);
    if (cs.overflowX !== 'visible' && cs.display !== 'inline') out.push({ level: 'warn', kind: '文字の切れ', detail: txt(e).slice(0, 60) });
  }
  for (const e of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')) {
    if (!vis(e)) continue;
    const named = e.labels?.length || e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.title || (/radio|checkbox/.test(e.type) && e.closest('label'));
    if (!named) out.push({ level: 'warn', kind: 'ラベルのない入力欄', detail: e.id || e.name || e.outerHTML.slice(0, 60) });
  }
  const ids = {};
  for (const e of document.querySelectorAll('[id]')) ids[e.id] = (ids[e.id] ?? 0) + 1;
  for (const [id, n] of Object.entries(ids)) if (n > 1) out.push({ level: 'warn', kind: 'id の重複', detail: `#${id}（${n} 個）` });
  return out;
}

// ページのイベントを監視し、現在のケースに検出を積む。戻り値：{ setCase, lint, result }
export function watch(page, site) {
  if (site.health === false) return { setCase() {}, async lint() {}, note() {}, attach() {}, result: () => null };
  const ignore = site.health?.ignore ?? [];
  const origin = new URL(site.url).origin;
  const found = {}; let current = null;
  const add = (level, kind, detail) => {
    if (!current) return;
    detail = String(detail).replace(/\s+/g, ' ').slice(0, 200);
    if (ignore.some(re => re.test(`${kind}：${detail}`))) return;
    const list = (found[current] ??= []);
    if (!list.some(f => f.kind === kind && f.detail === detail)) list.push({ level, kind, detail });
  };
  // 別ウィンドウ（ポップアップ）が開いたら、そのページも同じように監視する
  const attach = p => {
    p.on('pageerror', e => add('error', 'JS の例外', e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) add('warn', 'console.error', m.text()); });
    p.on('response', r => {
      const s = r.status(); const u = r.url();
      if (s >= 500) add('error', 'HTTP 5xx', `${s} ${r.request().method()} ${u}`);
      else if (s >= 400 && u.startsWith(origin) && r.request().resourceType() !== 'document') add('warn', 'HTTP 4xx（部品）', `${s} ${u}`);
    });
  };
  attach(page);
  return {
    setCase(id) { current = id; if (id) found[id] ??= []; },
    note: add,
    async lint(p = page) { for (const f of await p.evaluate(lintPage).catch(() => [])) add(f.level, f.kind, f.detail); },
    attach,
    result: () => found,
  };
}

// 検出をケースの観点（items）に変換する。health は out/<スイート>-health.json の内容
export function healthItems(found) {
  if (!found) return [];
  const errors = found.filter(f => f.level === 'error'); const warns = found.filter(f => f.level === 'warn');
  return [
    { desc: '自動検査：JS の例外・HTTP 5xx・不正な表示値・画像', auto: true, pass: !errors.length, expected: '検出なし', actual: errors.length ? errors.map(f => `${f.kind}：${f.detail}`).join(' ／ ') : '検出なし' },
    ...warns.map(f => ({ desc: `自動検査（注意）：${f.kind}`, auto: true, warn: true, pass: true, expected: '検出なし', actual: f.detail })),
  ];
}
