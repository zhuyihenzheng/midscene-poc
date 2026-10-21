// ポイントクーポン交換サイト（デモ・依存なし）。仕様は 設計書.md
//   node sites/coupon-demo/app/server.mjs   → http://localhost:8090/（COUPON_DEMO_PORT で変更）
// 自動テストの新規サイト適用を試すため、既知の不具合を 1 件含む（COUPON_DEMO_FIXED=1 で修正版の動作）。
import http from 'http';
import crypto from 'crypto';

const PORT = Number(process.env.COUPON_DEMO_PORT || 8090);
const FIXED = process.env.COUPON_DEMO_FIXED === '1';

// ---------- データ（メモリのみ） ----------
const MEMBERS = { M0001: { password: 'pass1234', name: '山田 太郎' } };
let db;
function seed() {
  db = {
    balance: { M0001: 1200 },
    coupons: [
      { id: 1, name: 'カフェ 200円引き', cat: '飲食', pt: 300, stock: 10 },
      { id: 2, name: 'ベーカリー 100円引き', cat: '飲食', pt: 150, stock: 0 },
      { id: 3, name: '書店 500円券', cat: '買物', pt: 600, stock: 2 },
      { id: 4, name: '映画 1,000円券', cat: '娯楽', pt: 1200, stock: 3 },
    ],
    exchanges: [], ledger: [], seq: 0,
  };
}
seed();
const sessions = new Map();

// ---------- HTML ----------
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = n => n.toLocaleString('ja-JP');
const CSS = `body{font-family:system-ui,"Hiragino Sans",sans-serif;margin:0;background:#f8fafc;color:#0f172a}
header{display:flex;justify-content:space-between;align-items:center;padding:12px 32px;background:#fff;border-bottom:3px solid #0f766e}
header .brand{font-weight:700;color:#0f766e}main{max-width:760px;margin:24px auto;padding:0 24px}
h1{font-size:22px;border-left:5px solid #0f766e;padding-left:10px}
.field{margin:16px 0}.field>label,legend{font-weight:600;display:inline-block;margin-bottom:6px}
.req{font-size:11px;color:#fff;background:#dc2626;border-radius:3px;padding:1px 5px;margin-left:6px}
input[type=text],input[type=password],input[type=email]{padding:8px;border:1px solid #94a3b8;border-radius:4px;width:260px}
fieldset{border:0;padding:0;margin:16px 0}fieldset label{margin-right:16px}
.hint{font-size:12px;color:#64748b;margin-left:8px}.field-error{color:#dc2626;font-size:13px;margin:4px 0 0}
.alert{background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;padding:10px 14px;border-radius:4px}
.status{background:#d1fae5;border:1px solid #6ee7b7;color:#065f46;padding:10px 14px;border-radius:4px}
table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:left}th{background:#f1f5f9}
dl{display:grid;grid-template-columns:200px 1fr;background:#fff;border:1px solid #e2e8f0}dt,dd{margin:0;padding:10px;border-bottom:1px solid #e2e8f0}dt{color:#475569}
.actions{display:flex;gap:12px;margin-top:24px}button{padding:10px 24px;border-radius:4px;border:1px solid #94a3b8;background:#fff;cursor:pointer;font-size:15px}
button.primary{background:#0f766e;border-color:#0f766e;color:#fff}.muted{color:#94a3b8}`;

function page(title, body, user) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${h(title)}｜ポイントクーポン</title><style>${CSS}</style></head><body>
<header><span class="brand">ポイントクーポン</span>${user ? `<form method="post" action="/logout"><span>${h(MEMBERS[user].name)} 様</span> <button type="submit">ログアウト</button></form>` : ''}</header>
<main><h1>${h(title)}</h1>${body}</main></body></html>`;
}
const fieldError = (id, msg) => msg ? `<p class="field-error" id="${id}-error">${h(msg)}</p>` : '';
const alertBox = msg => msg ? `<div class="alert" role="alert">${h(msg)}</div>` : '';

// ---------- 画面 ----------
function loginPage(v = {}, e = {}) {
  return page('ログイン', `${alertBox(e.global)}
<form method="post" action="/login" novalidate>
<div class="field"><label for="memberId">会員ID</label><span class="req">必須</span><br><input type="text" id="memberId" name="memberId" value="${h(v.memberId)}">${fieldError('memberId', e.memberId)}</div>
<div class="field"><label for="password">パスワード</label><span class="req">必須</span><br><input type="password" id="password" name="password">${fieldError('password', e.password)}</div>
<div class="actions"><button class="primary" type="submit">ログイン</button></div></form>`);
}

function myPage(user) {
  return page('マイページ', `<dl><dt>会員名</dt><dd>${h(MEMBERS[user].name)}</dd><dt>保有ポイント</dt><dd id="balance">${num(db.balance[user])} pt</dd></dl>
<ul><li><a href="/coupons">クーポン一覧</a></li><li><a href="/history">交換履歴</a></li></ul>`, user);
}

function listPage(user, cat) {
  const cats = ['すべて', '飲食', '買物', '娯楽'];
  cat = cats.includes(cat) ? cat : 'すべて';
  const rows = db.coupons.filter(c => cat === 'すべて' || c.cat === cat).map(c => `<tr><td>${h(c.name)}</td><td>${h(c.cat)}</td><td>${num(c.pt)} pt</td><td>${c.stock} 枚</td>
<td>${c.stock > 0 ? `<a href="/coupons/${c.id}/exchange">交換する</a>` : '<span class="muted">在庫なし</span>'}</td></tr>`).join('');
  return page('クーポン一覧', `<p>保有ポイント：<strong id="balance">${num(db.balance[user])} pt</strong></p>
<form method="get" action="/coupons"><fieldset><legend>カテゴリ</legend>${cats.map(c => `<label><input type="radio" name="cat" value="${c}"${c === cat ? ' checked' : ''}> ${c}</label>`).join('')}</fieldset>
<button type="submit">絞り込む</button></form>
<table><caption class="muted">クーポン ${db.coupons.filter(c => cat === 'すべて' || c.cat === cat).length} 件</caption>
<thead><tr><th>クーポン名</th><th>カテゴリ</th><th>必要ポイント</th><th>在庫</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>
<p><a href="/">マイページへ戻る</a></p>`, user);
}

function exchangePage(user, c, v = {}, e = {}) {
  const mail = v.method === 'メール';
  return page('クーポン交換', `${alertBox(e.global)}
<dl><dt>クーポン名</dt><dd>${h(c.name)}</dd><dt>必要ポイント（1 枚）</dt><dd>${num(c.pt)} pt</dd><dt>在庫</dt><dd>${c.stock} 枚</dd><dt>保有ポイント</dt><dd>${num(db.balance[user])} pt</dd></dl>
<form method="post" action="/coupons/${c.id}/confirm" novalidate>
<div class="field"><label for="qty">枚数</label><span class="req">必須</span><br><input type="text" id="qty" name="qty" inputmode="numeric" value="${h(v.qty)}"><span class="hint">1〜5 枚</span>${fieldError('qty', e.qty)}</div>
<fieldset><legend>受取方法</legend><span class="req">必須</span><br>${['メール', 'アプリ'].map(m => `<label><input type="radio" name="method" value="${m}"${v.method === m ? ' checked' : ''}> ${m}</label>`).join('')}${fieldError('method', e.method)}</fieldset>
<div class="field" id="emailRow"${mail ? '' : ' hidden'}><label for="email">メールアドレス</label><span class="req">必須</span><br><input type="email" id="email" name="email" value="${h(mail ? v.email : '')}"${mail ? '' : ' disabled'}>${fieldError('email', e.email)}</div>
<div class="actions"><button class="primary" type="submit">確認</button></div></form>
<p><a href="/coupons">クーポン一覧へ戻る</a></p>
<script>
// 受取方法＝メールのときだけメールアドレスを表示。非表示にしたら値をクリア（設計書 S04）
document.querySelectorAll('[name=method]').forEach(r => r.addEventListener('change', () => {
  const mail = document.querySelector('[name=method]:checked')?.value === 'メール';
  const row = document.getElementById('emailRow'), input = document.getElementById('email');
  row.hidden = !mail; input.disabled = !mail; if (!mail) input.value = '';
}));
</script>`, user);
}

function confirmPage(user, c, v) {
  const total = c.pt * Number(v.qty);
  const hidden = ['qty', 'method', 'email'].map(k => `<input type="hidden" name="${k}" value="${h(v[k])}">`).join('');
  return page('交換内容の確認', `<dl><dt>クーポン名</dt><dd>${h(c.name)}</dd><dt>枚数</dt><dd>${Number(v.qty)} 枚</dd><dt>受取方法</dt><dd>${h(v.method)}</dd>
${v.method === 'メール' ? `<dt>メールアドレス</dt><dd>${h(v.email)}</dd>` : ''}<dt>必要ポイント合計</dt><dd id="total">${num(total)} pt</dd>
<dt>交換後の保有ポイント</dt><dd id="after">${num(db.balance[user] - total)} pt</dd></dl>
<form method="post" action="/coupons/${c.id}/exchange">${hidden}
<div class="actions"><button class="primary" type="submit">交換する</button><button type="submit" formaction="/coupons/${c.id}/back">戻る</button></div></form>`, user);
}

function donePage(user, x) {
  return page('交換完了', `<div class="status" role="status">クーポンの交換が完了しました。</div>
<dl><dt>交換番号</dt><dd id="kokanNo">${h(x.no)}</dd><dt>クーポン名</dt><dd>${h(x.name)}</dd><dt>枚数</dt><dd>${x.qty} 枚</dd><dt>交換後の保有ポイント</dt><dd id="balance">${num(db.balance[user])} pt</dd></dl>
<p><a href="/">マイページへ</a>　<a href="/history">交換履歴</a></p>`, user);
}

function historyPage(user) {
  const xs = db.exchanges.filter(x => x.user === user).slice().reverse();
  return page('交換履歴', xs.length ? `<table><thead><tr><th>交換番号</th><th>クーポン名</th><th>枚数</th><th>使用ポイント</th><th>受取方法</th></tr></thead><tbody>
${xs.map(x => `<tr><td>${h(x.no)}</td><td>${h(x.name)}</td><td>${x.qty} 枚</td><td>${num(x.total)} pt</td><td>${h(x.method)}</td></tr>`).join('')}</tbody></table>`
    : '<p>交換履歴はありません。</p>', user) .replace('</main>', '<p><a href="/">マイページへ戻る</a></p></main>');
}

// ---------- 入力チェック（設計書 S04） ----------
function validate(user, c, v) {
  const e = {};
  if (!v.qty) e.qty = '枚数を入力してください。';
  else if (!/^[0-9]+$/.test(v.qty)) e.qty = '枚数は半角数字で入力してください。';
  else if (Number(v.qty) < 1 || Number(v.qty) > 5) e.qty = '枚数は1〜5の範囲で入力してください。';
  if (!['メール', 'アプリ'].includes(v.method)) e.method = '受取方法を選択してください。';
  else if (v.method === 'メール') {
    if (!v.email) e.email = 'メールアドレスを入力してください。';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) e.email = 'メールアドレスの形式が正しくありません。';
  }
  if (Object.keys(e).length) return e;
  const qty = Number(v.qty), total = c.pt * qty;
  if (qty > c.stock) return { global: `在庫が不足しています（残り ${c.stock} 枚）。` };
  // 既知の不具合：保有ポイント＝合計のときも不足と判定する（設計書では交換可）
  if (FIXED ? total > db.balance[user] : total >= db.balance[user]) return { global: '保有ポイントが不足しています。' };
  return null;
}

// ---------- ルーティング ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const body = req.method === 'POST' ? Object.fromEntries(new URLSearchParams(await readBody(req))) : {};
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  const user = sessions.get(sid);
  const send = (html, status = 200) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); };
  const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const go = loc => { res.writeHead(303, { location: loc }); res.end(); };
  const p = url.pathname;

  // 試験用フック（WireMock の受信履歴・データ初期化に相当）
  if (p === '/__test/reset' && req.method === 'POST') { seed(); return json({ ok: true }); }
  if (p === '/__test/ledger') return json(db.ledger);

  if (p === '/login' && req.method === 'GET') return send(loginPage());
  if (p === '/login' && req.method === 'POST') {
    const e = {};
    if (!body.memberId) e.memberId = '会員IDを入力してください。';
    if (!body.password) e.password = 'パスワードを入力してください。';
    if (!Object.keys(e).length && MEMBERS[body.memberId]?.password !== body.password) e.global = '会員IDまたはパスワードが正しくありません。';
    if (Object.keys(e).length) return send(loginPage({ memberId: body.memberId }, e));
    const id = crypto.randomUUID(); sessions.set(id, body.memberId);
    res.setHeader('set-cookie', `sid=${id}; Path=/; HttpOnly; SameSite=Lax`);
    return go('/');
  }
  if (!user) return go('/login');
  if (p === '/logout' && req.method === 'POST') { sessions.delete(sid); res.setHeader('set-cookie', 'sid=; Path=/; Max-Age=0'); return go('/login'); }
  if (p === '/') return send(myPage(user));
  if (p === '/coupons') return send(listPage(user, url.searchParams.get('cat')));
  if (p === '/history') return send(historyPage(user));
  const xm = p.match(/^\/exchanges\/(EX-\d+)$/);
  if (xm) { const x = db.exchanges.find(x => x.no === xm[1] && x.user === user); return x ? send(donePage(user, x)) : send(page('エラー', '<p>見つかりません。</p>', user), 404); }

  const m = p.match(/^\/coupons\/(\d+)\/(exchange|confirm|back)$/);
  const c = m && db.coupons.find(c => c.id === Number(m[1]));
  if (!c) return send(page('エラー', '<p>見つかりません。</p>', user), 404);
  const v = { qty: (body.qty ?? '').trim(), method: body.method, email: (body.email ?? '').trim() };
  if (m[2] === 'exchange' && req.method === 'GET') return send(exchangePage(user, c));
  if (m[2] === 'back') return send(exchangePage(user, c, v));
  const e = validate(user, c, v);
  if (e) return send(exchangePage(user, c, v, e));
  if (m[2] === 'confirm') return send(confirmPage(user, c, v));
  // 交換確定：ポイント基盤 API へ使用電文を送信（デモでは ledger に記録）し、在庫・保有ポイントを減らす
  const qty = Number(v.qty), total = c.pt * qty, no = `EX-${String(++db.seq).padStart(6, '0')}`;
  db.ledger.push({ API: 'POINT_USE', KAIIN_NO: user, USE_PT: total, COUPON_ID: c.id, MAISU: qty, KOKAN_NO: no });
  db.balance[user] -= total; c.stock -= qty;
  db.exchanges.push({ no, user, name: c.name, qty, total, method: v.method });
  return go(`/exchanges/${no}`);
});

function readBody(req) { return new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => r(b)); }); }

server.listen(PORT, () => console.log(`coupon-demo: http://localhost:${PORT}/${FIXED ? '（修正版）' : ''}`));
