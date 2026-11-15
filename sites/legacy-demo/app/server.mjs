// 受注管理システム（レガシー画面のデモ・依存なし）。仕様は 設計書.md
//   node sites/legacy-demo/app/server.mjs   → http://localhost:8095/（LEGACY_DEMO_PORT で変更）
// 古い業務システムによくある作りを再現している：表でレイアウトしたフォーム（label なし）、h1 のない見出し、
// 入力エラーと確認はブラウザのダイアログ（alert / confirm）、検索結果は非同期で描画。
// 既知の不具合を 2 件含む（LEGACY_DEMO_FIXED=1 で修正版の動作）。
import http from 'http';
import crypto from 'crypto';

const PORT = Number(process.env.LEGACY_DEMO_PORT || 8095);
const FIXED = process.env.LEGACY_DEMO_FIXED === '1';

const USERS = { u001: { password: 'pass1234', name: '佐藤' } };
const ITEMS = { P01: { name: 'ノートPC', price: 120000 }, P02: { name: 'マウス', price: 2500 }, P03: { name: 'モニター', price: 30000 } };
let db;
function seed() {
  db = { seq: 5, requests: [], orders: [
    { no: 'J-0001', cust: '青葉商事', item: 'P01', qty: 2, status: '受付', urgent: true, memo: '' },
    { no: 'J-0002', cust: '青葉商事', item: 'P02', qty: 10, status: '出荷済', urgent: false, memo: '' },
    { no: 'J-0003', cust: '北山電機', item: 'P03', qty: 1, status: '受付', urgent: false, memo: '午前着' },
    { no: 'J-0004', cust: '南風物産', item: 'P02', qty: 4, status: '取消', urgent: false, memo: '' },
    { no: 'J-0005', cust: '北山電機', item: 'P01', qty: 1, status: '出荷済', urgent: true, memo: '' },
  ] };
}
seed();
const sessions = new Map();

const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const yen = n => `${n.toLocaleString('ja-JP')} 円`;
const amount = o => ITEMS[o.item].price * o.qty;
const CSS = `body{font-family:"MS PGothic","Hiragino Sans",sans-serif;font-size:13px;margin:0;background:#e8eef5;color:#000}
.head{background:#003366;color:#fff;padding:6px 12px}.head a{color:#fff}.pageTitle{background:#6688aa;color:#fff;font-weight:bold;padding:4px 12px;margin-bottom:10px}
.body{padding:0 12px 20px}table.form,table.list,table.detail{border-collapse:collapse;background:#fff;margin-bottom:10px}
table.form td,table.list td,table.list th,table.detail td,table.detail th{border:1px solid #7a8ea3;padding:4px 8px}
table.form td.lbl,table.list th,table.detail th{background:#cfdcea;text-align:left;white-space:nowrap}.req{color:#c00;margin-left:4px}
.msg{color:#060;font-weight:bold;margin:8px 0}.err{color:#c00;font-weight:bold;margin:8px 0}input[type=button],input[type=submit]{padding:2px 14px}`;

function page(title, body, user) {
  return `<html lang="ja"><head><meta charset="utf-8"><title>受注管理</title><style>${CSS}</style></head><body>
<div class="head">受注管理システム${user ? `　${h(USERS[user].name)} さん　<a href="/logout">ログアウト</a>` : ''}</div>
<div class="pageTitle">${h(title)}</div><div class="body">${body}</div></body></html>`;
}

function loginPage(err, uid = '') {
  return page('ログイン', `${err ? `<div class="err">${h(err)}</div>` : ''}<form method="post" action="/login"><table class="form">
<tr><td class="lbl">ユーザーID</td><td><input type="text" name="uid" value="${h(uid)}"></td></tr>
<tr><td class="lbl">パスワード</td><td><input type="password" name="pw"></td></tr></table>
<input type="submit" value="ログイン"></form>`);
}

function searchPage(user) {
  return page('受注検索', `<table class="form">
<tr><td class="lbl">顧客名</td><td><input type="text" name="q" size="24"></td></tr>
<tr><td class="lbl">ステータス</td><td><select name="st"><option value="">すべて</option><option>受付</option><option>出荷済</option><option>取消</option></select></td></tr>
<tr><td class="lbl">至急</td><td><input type="checkbox" name="urgent" value="1"> 至急のみ</td></tr></table>
<input type="button" value="検索" onclick="search()"> <input type="button" value="新規登録" onclick="location.href='/orders/new'">
<div id="result"></div>
<script>
// 検索結果は非同期で取得して描画する（取得中は「検索中…」）
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function search() {
  var p = new URLSearchParams({ q: document.querySelector('[name=q]').value, st: document.querySelector('[name=st]').value, urgent: document.querySelector('[name=urgent]').checked ? '1' : '' });
  var box = document.getElementById('result'); box.innerHTML = '<p id="loading">検索中…</p>';
  fetch('/api/orders?' + p).then(function (r) { return r.json(); }).then(function (rows) {
    if (!rows.length) { box.innerHTML = '<p class="msg" id="count">0 件</p><p id="empty">該当する受注はありません。</p>'; return; }
    box.innerHTML = '<p class="msg" id="count">' + rows.length + ' 件</p><table class="list"><thead><tr><th>受注番号</th><th>顧客名</th><th>商品</th><th>数量</th><th>金額</th><th>ステータス</th><th>至急</th></tr></thead><tbody>' +
      rows.map(function (o) { return '<tr><td><a href="/orders/' + o.no + '">' + o.no + '</a></td><td>' + esc(o.cust) + '</td><td>' + esc(o.itemName) + '</td><td>' + o.qty + '</td><td>' + o.amount + '</td><td>' + o.status + '</td><td>' + (o.urgent ? '至急' : '') + '</td></tr>'; }).join('') + '</tbody></table>';
  });
}
search();
</script>`, user);
}

function newPage(user) {
  // 既知の不具合①：数量の上限チェックが 99 ではなく 999 になっている（設計書では 1〜99）
  const max = FIXED ? 99 : 999;
  return page('受注登録', `<form method="post" action="/orders" name="f"><table class="form">
<tr><td class="lbl">顧客名<span class="req">※</span></td><td><input type="text" name="cust" size="30"></td></tr>
<tr><td class="lbl">商品<span class="req">※</span></td><td><select name="item"><option value="">選択してください</option>${Object.entries(ITEMS).map(([k, v]) => `<option value="${k}">${h(v.name)}</option>`).join('')}</select></td></tr>
<tr><td class="lbl">数量<span class="req">※</span></td><td><input type="text" name="qty" size="6"></td></tr>
<tr><td class="lbl">至急</td><td><input type="checkbox" name="urgent" value="1"></td></tr>
<tr><td class="lbl">備考</td><td><textarea name="memo" rows="2" cols="30"></textarea></td></tr></table>
<input type="button" value="登録" onclick="submitOrder()"> <input type="button" value="一覧へ戻る" onclick="location.href='/orders'"></form>
<script>
// 入力チェック：最初に見つかったエラー 1 件をダイアログで表示する（設計書 G02）
function submitOrder() {
  var f = document.forms.f, cust = f.cust.value.trim(), qty = f.qty.value.trim();
  if (!cust) return alert('顧客名を入力してください。');
  if (cust.length > 20) return alert('顧客名は20文字以内で入力してください。');
  if (!f.item.value) return alert('商品を選択してください。');
  if (!qty) return alert('数量を入力してください。');
  if (!/^[0-9]+$/.test(qty)) return alert('数量は半角数字で入力してください。');
  if (Number(qty) < 1 || Number(qty) > ${max}) return alert('数量は1〜99の範囲で入力してください。');
  if (confirm('登録します。よろしいですか？')) f.submit();
}
</script>`, user);
}

function detailPage(user, o, msg) {
  const it = ITEMS[o.item];
  // 既知の不具合②：詳細画面の金額に 3 桁区切りが付かない（設計書では「240,000 円」形式）
  const total = FIXED ? yen(amount(o)) : `${amount(o)} 円`;
  return page('受注詳細', `${msg ? `<div class="msg">${h(msg)}</div>` : ''}<table class="detail">
<tr><th>受注番号</th><td>${h(o.no)}</td></tr><tr><th>顧客名</th><td>${h(o.cust)}</td></tr><tr><th>商品</th><td>${h(it.name)}</td></tr>
<tr><th>数量</th><td>${o.qty}</td></tr><tr><th>単価</th><td>${yen(it.price)}</td></tr><tr><th>金額</th><td>${total}</td></tr>
<tr><th>ステータス</th><td>${h(o.status)}</td></tr><tr><th>至急</th><td>${o.urgent ? '至急' : '通常'}</td></tr><tr><th>備考</th><td>${h(o.memo)}</td></tr></table>
<form method="post" action="/orders/${o.no}/cancel" name="c">
${o.status === '受付' ? `<input type="button" value="取消" onclick="if (confirm('この受注を取り消します。よろしいですか？')) document.forms.c.submit()"> ` : ''}<input type="button" value="一覧へ戻る" onclick="location.href='/orders'"></form>`, user);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const body = req.method === 'POST' ? Object.fromEntries(new URLSearchParams(await readBody(req))) : {};
  const sid = /(?:^|;\s*)lsid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  const user = sessions.get(sid);
  const send = (html, status = 200) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); };
  const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const go = loc => { res.writeHead(303, { location: loc }); res.end(); };
  const p = decodeURIComponent(url.pathname);

  // 試験用フック（データ初期化・在庫引当 API への送信記録）
  if (p === '/__test/reset' && req.method === 'POST') { seed(); return json({ ok: true }); }
  if (p === '/__test/requests') return json(db.requests);

  if (p === '/login' && req.method === 'GET') return send(loginPage());
  if (p === '/login' && req.method === 'POST') {
    if (USERS[body.uid]?.password !== body.pw) return send(loginPage('ユーザーIDまたはパスワードが違います。', body.uid));
    const id = crypto.randomUUID(); sessions.set(id, body.uid);
    res.setHeader('set-cookie', `lsid=${id}; Path=/; HttpOnly; SameSite=Lax`);
    return go('/orders');
  }
  if (!user) return go('/login');
  if (p === '/logout') { sessions.delete(sid); return go('/login'); }
  if (p === '/' ) return go('/orders');
  if (p === '/orders' && req.method === 'GET') return send(searchPage(user));
  if (p === '/api/orders') {
    const q = url.searchParams.get('q') ?? '', st = url.searchParams.get('st') ?? '', urgent = url.searchParams.get('urgent') === '1';
    const rows = db.orders.filter(o => o.cust.includes(q) && (!st || o.status === st) && (!urgent || o.urgent))
      .map(o => ({ no: o.no, cust: o.cust, itemName: ITEMS[o.item].name, qty: o.qty, amount: yen(amount(o)), status: o.status, urgent: o.urgent }));
    return setTimeout(() => json(rows), 400);
  }
  if (p === '/orders/new') return send(newPage(user));
  if (p === '/orders' && req.method === 'POST') {
    const no = `J-${String(++db.seq).padStart(4, '0')}`;
    const o = { no, cust: (body.cust ?? '').trim(), item: body.item, qty: Number(body.qty), status: '受付', urgent: body.urgent === '1', memo: body.memo ?? '' };
    if (!ITEMS[o.item] || !o.cust || !(o.qty >= 1)) return send(page('エラー', '<div class="err">入力内容が正しくありません。</div>', user), 400);
    db.orders.push(o);
    db.requests.push({ API: 'HIKIATE', JUCHU_NO: no, SHOHIN_CD: o.item, SURYO: o.qty });
    return go(`/orders/${no}?m=created`);
  }
  const m = p.match(/^\/orders\/(J-\d+)(\/cancel)?$/);
  const o = m && db.orders.find(o => o.no === m[1]);
  if (!o) return send(page('エラー', '<div class="err">受注が見つかりません。</div>', user), 404);
  if (m[2] && req.method === 'POST') {
    if (o.status === '受付') { o.status = '取消'; db.requests.push({ API: 'HIKIATE_KAIJO', JUCHU_NO: o.no }); }
    return go(`/orders/${o.no}?m=cancelled`);
  }
  return send(detailPage(user, o, { created: '受注を登録しました。', cancelled: '受注を取り消しました。' }[url.searchParams.get('m')]));
});

function readBody(req) { return new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => r(b)); }); }

server.listen(PORT, () => console.log(`legacy-demo: http://localhost:${PORT}/${FIXED ? '（修正版）' : ''}`));
