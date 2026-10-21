// 画面採取（全サイト共通・モデル不要）：ログイン後にリンクをたどって各画面の構成を JSON / Markdown に書き出す
//   node core/explore.mjs <site.mjs> [--max 30] [--out <dir>]
// 出力（既定 <site.mjs のディレクトリ>/inventory/）
//   inventory.json  画面ごとの見出し・入力項目（ラベル・必須・型・選択肢）・ボタン・リンク・表・メッセージ
//   inventory.md    同じ内容を人／AI（Copilot 等）が読む形にしたもの。ケース起草の入力にする
//   各画面の「指示文候補」は標準辞書（core/locators.mjs の DEFAULTS）の書き方で生成し、実画面で 1 要素に解決できたものだけ載せる
// 注意：リンク（GET）でたどれる画面だけを採取する。フォーム送信後の画面（確認・完了など）は site.explore.flows で操作を指定するか、
//      Midscene（AI）での初回実行の画面証跡から補う。
import fs from 'fs'; import path from 'path';
import { launch } from './browser.mjs';
import { createLocators, DEFAULTS, KINDS } from './locators.mjs';

const args = process.argv.slice(2);
const siteFile = path.resolve(args[0] ?? '');
const site = (await import(siteFile)).default;
const max = Number(args.includes('--max') ? args[args.indexOf('--max') + 1] : 30);
const outDir = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : path.join(path.dirname(siteFile), 'inventory');
const loc = site.locators ?? createLocators(DEFAULTS);

const stopApp = site.startApp ? await site.startApp() : null;
const browser = await launch();
const pages = [];
try {
  const { page } = await site.login(browser, { viewport: site.viewport });
  const origin = new URL(site.url).origin;
  const skip = site.explore?.skip ?? /logout|__test/;
  const queue = [site.url]; const seen = new Set();
  while (queue.length && pages.length < max) {
    // 同じ画面の別データ（/coupons/1/exchange と /coupons/3/exchange 等）は 1 つだけ採取する
    const u = queue.shift(); const key = new URL(u).pathname.replace(/\d+/g, '{n}');
    if (seen.has(key)) continue; seen.add(key);
    await page.goto(u); await page.waitForLoadState('networkidle').catch(() => {});
    const inv = await collect(page);
    inv.prompts = await prompts(page, inv);
    pages.push(inv);
    console.log(`  ${inv.h1 ?? '(見出しなし)'}  ${new URL(page.url()).pathname}`);
    for (const l of inv.links) { const abs = new URL(l.href, page.url()); if (abs.origin === origin && !skip.test(abs.pathname)) queue.push(abs.href); }
  }
  // リンクでたどれない画面：site.explore.flows = [{ name, run: async page => {...} }]
  for (const f of site.explore?.flows ?? []) {
    await f.run(page); await page.waitForLoadState('networkidle').catch(() => {});
    const inv = { ...(await collect(page)), via: f.name }; inv.prompts = await prompts(page, inv); pages.push(inv);
    console.log(`  ${inv.h1 ?? '(見出しなし)'}  （操作：${f.name}）`);
  }
} finally { await browser.close(); await stopApp?.(); }

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'inventory.json'), JSON.stringify(pages, null, 1));
fs.writeFileSync(path.join(outDir, 'inventory.md'), toMd(pages));
console.log(`\n${pages.length} 画面 → ${path.relative(process.cwd(), outDir)}/inventory.{json,md}`);

// ---------- 画面の構成を採取（ブラウザ内） ----------
function collect(page) {
  return page.evaluate(() => {
    const txt = e => (e?.innerText ?? e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const visible = e => !!e && e.offsetParent !== null && !e.closest('[hidden]');
    const labelOf = el => (el.labels?.[0] && txt(el.labels[0])) || el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && txt(document.getElementById(el.getAttribute('aria-labelledby')))) || el.placeholder || el.name || '';
    const fields = []; const groups = {};
    for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      const type = el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase();
      if (type === 'radio' || type === 'checkbox') {
        const fs = el.closest('fieldset'); const g = fs ? txt(fs.querySelector('legend')) : el.name;
        (groups[g + '|' + type] ??= { group: g, type, name: el.name, options: [], visible: visible(el) }).options.push({ label: labelOf(el), value: el.value, checked: el.checked });
        continue;
      }
      const wrap = el.closest('.field, div, td, li') ?? el.parentElement;
      fields.push({ label: labelOf(el), type, name: el.name, id: el.id, required: el.required || /必須/.test(txt(wrap)), maxlength: el.maxLength > 0 ? el.maxLength : null,
        inputmode: el.inputMode || null, hint: txt(wrap.querySelector('.hint, small')) || null, visible: visible(el), disabled: el.disabled,
        options: el.tagName === 'SELECT' ? [...el.options].map(o => o.textContent.trim()) : undefined });
    }
    return {
      url: location.pathname + location.search, title: document.title, h1: txt(document.querySelector('h1')) || null,
      headings: [...document.querySelectorAll('h2,h3')].map(txt),
      fields, groups: Object.values(groups),
      buttons: [...document.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible).map(b => txt(b) || b.value),
      links: [...document.querySelectorAll('a[href]')].filter(visible).map(a => ({ text: txt(a), href: a.getAttribute('href') })),
      tables: [...document.querySelectorAll('table')].map(t => ({ caption: txt(t.caption) || null, headers: [...t.querySelectorAll('th')].map(txt),
        rows: [...t.querySelectorAll('tbody tr')].slice(0, 10).map(r => [...r.cells].map(txt)) })),
      descriptions: [...document.querySelectorAll('dl')].map(dl => Object.fromEntries([...dl.querySelectorAll('dt')].map(dt => [txt(dt), txt(dt.nextElementSibling)]))),
      // sel：cases.mjs の画面状態取得（pageState）で値を読むためのセレクター
      messages: [...document.querySelectorAll('[role=alert], [role=status], .field-error, .error')].filter(visible).map(e => ({ role: e.getAttribute('role') ?? 'field', text: txt(e),
        sel: e.id ? '#' + e.id : e.getAttribute('role') ? `[role=${e.getAttribute('role')}]` : '.' + [...e.classList].join('.') })).filter(m => m.text),
    };
  });
}

// ---------- 指示文候補：標準の書き方で作り、実画面で 1 要素に解決できたものだけ残す ----------
async function prompts(page, inv) {
  const cand = [];
  if (inv.h1) cand.push(['aiWaitFor', `「${inv.h1}」画面が表示されている`]);
  for (const f of inv.fields) if (f.label) cand.push(['aiInput', `${f.label}の入力欄`]);
  for (const g of inv.groups) for (const o of g.options) cand.push(['aiTap', `${g.group}の「${o.label}」${g.type === 'radio' ? 'ラジオボタン' : 'チェックボックス'}`]);
  for (const b of new Set(inv.buttons)) if (b) cand.push(['aiTap', `「${b}」ボタン`]);
  const rowLinks = new Set();
  for (const t of inv.tables) for (const r of t.rows) for (const a of inv.links) if (r.includes(a.text) && r[0] !== a.text) rowLinks.add(`「${r[0]}」の行の「${a.text}」リンク`);
  for (const p of rowLinks) cand.push(['aiTap', p]);
  for (const a of new Set(inv.links.map(l => l.text))) if (a && ![...rowLinks].some(p => p.endsWith(`「${a}」リンク`))) cand.push(['aiTap', `「${a}」リンク`]);
  for (const m of inv.messages) cand.push(['aiWaitFor', `「${m.text}」と表示されている`]);
  const out = [];
  for (const [kind, prompt] of cand) {
    let ok = false;
    // 複数一致はエンジン実行時に strict mode エラーになるため、1 要素に解決できたものだけ OK
    try { const r = loc.resolve(kind, prompt, page); ok = typeof r === 'function' || (await r.count()) === 1; } catch {}
    out.push({ kind, prompt, ok });
  }
  return out;
}

function toMd(pages) {
  const L = ['# 画面一覧（自動採取）', '', `採取日：${new Date().toLocaleDateString('sv-SE')}　対象：${site.url}　${pages.length} 画面`, '',
    '> ケース起草の入力用。期待値は必ず設計書から取ること（この一覧は「どう操作し、どこから値を読むか」の根拠）。', ''];
  for (const p of pages) {
    L.push(`## ${p.h1 ?? p.title}（${p.via ? '操作：' + p.via : p.url}）`, '');
    if (p.fields.length) { L.push('| 入力項目 | 型 | name / id | 必須 | 補足 | 表示 |', '|---|---|---|---|---|---|');
      for (const f of p.fields) L.push(`| ${f.label} | ${f.type}${f.inputmode ? `（${f.inputmode}）` : ''} | ${f.name} / ${f.id} | ${f.required ? '○' : ''} | ${[f.hint, f.maxlength && `最大 ${f.maxlength}`, f.options?.join('/')].filter(Boolean).join('、')} | ${f.visible ? '' : '非表示'} |`);
      L.push(''); }
    for (const g of p.groups) L.push(`- ${g.type === 'radio' ? 'ラジオ' : 'チェック'}「${g.group}」：${g.options.map(o => o.label + (o.checked ? '（選択）' : '')).join('／')}`);
    if (p.buttons.length) L.push(`- ボタン：${[...new Set(p.buttons)].join('／')}`);
    if (p.links.length) L.push(`- リンク：${[...new Set(p.links.map(l => `${l.text}（${l.href}）`))].join('／')}`);
    for (const t of p.tables) L.push(`- 表${t.caption ? `「${t.caption}」` : ''}：${t.headers.join('／')}（${t.rows.length} 行）`, ...t.rows.map(r => `  - ${r.join('｜')}`));
    for (const d of p.descriptions) L.push(`- 表示項目：${Object.entries(d).map(([k, v]) => `${k}＝${v}`).join('／')}`);
    for (const m of p.messages) L.push(`- メッセージ（${m.role}・\`${m.sel}\`）：${m.text}`);
    L.push('', '指示文候補（標準辞書で解決を確認済み）：', '', ...p.prompts.filter(x => x.ok).map(x => `- \`${x.kind}\` ${x.prompt}`));
    const ng = p.prompts.filter(x => !x.ok);
    if (ng.length) L.push('', '解決できなかった候補（ラベル・role の不足。開発側に改善を依頼するか、サイト固有の辞書を追加）：', '', ...ng.map(x => `- \`${x.kind}\` ${x.prompt}`));
    L.push('');
  }
  return L.join('\n') + '\n';
}
