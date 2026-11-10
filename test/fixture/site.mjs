// フレームワーク自身の試験用の小さなサイト（エンジンの挙動を確かめるための画面だけを持つ）
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path';
import { createLocators, DEFAULTS } from '../../core/locators.mjs';

const page = (title, body) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

export async function startFixture() {
  let flaky = 0; const look = { color: '#1d4ed8' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const html = (s, status = 200) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(s); };
    switch (url.pathname) {
      case '/': return html(page('ホーム', `<form action="/saved"><p><label for="name">名前</label> <input id="name" name="name"></p>
<p><label for="kind">区分</label> <select id="kind" name="kind"><option value="">選択してください</option><option value="a">個人</option><option value="b">法人</option></select></p>
<button type="submit">保存</button></form>`));
      case '/saved': return html(page('保存完了', `<p role="status">保存しました。</p><dl><dt>名前</dt><dd>${url.searchParams.get('name') ?? ''}</dd><dt>区分</dt><dd>${url.searchParams.get('kind') ?? ''}</dd></dl>`));
      case '/broken': return html(page('集計', `<p>合計：undefined 円</p><script>fetch('/api/fail'); setTimeout(() => { throw new Error('boom'); }, 0);</script>`));
      case '/api/fail': res.writeHead(500); return res.end('error');
      case '/wide': return html(page('横長', `<div style="width:3000px">横に長い表</div><input name="memo">`));
      // 位置を固定した画面（模型の代わりをするサーバーが、決めておいた座標で要素の位置を答えられるようにする）
      case '/renamed': return html(page('編集', `<form action="/saved"><button type="submit" style="position:absolute;left:100px;top:220px;width:120px;height:40px">登録</button></form>`));
      case '/fixed-dialog': return html(page('削除', `<button type="button" style="position:absolute;left:100px;top:220px;width:120px;height:40px" onclick="if (confirm('削除します。よろしいですか？')) location.href = '/saved?name=deleted'">削除</button>`));
      case '/fixed': return html(page('入力', `<form action="/saved"><label for="name" style="position:absolute;left:100px;top:120px">名前</label>
<input id="name" name="name" style="position:absolute;left:100px;top:150px;width:300px;height:30px;box-sizing:border-box">
<button type="submit" style="position:absolute;left:100px;top:220px;width:120px;height:40px">保存</button></form>`));
      case '/flaky': return html(page(++flaky === 1 ? '準備中' : '安定', '<p>本文</p>'));
      case '/styled': return html(page('見た目', `<p style="background:${look.color};color:#fff;padding:40px">お知らせ</p><p id="clock">${Date.now()}</p>`));
      // iframe の中の画面
      case '/frame': return html(page('枠つき', '<iframe name="main" src="/frame-inner" style="width:600px;height:300px"></iframe>'));
      case '/frame-inner': return html(page('検索', `<form action="/frame-inner"><p><label for="q">検索語</label> <input id="q" name="q" value="${url.searchParams.get('q') ?? ''}"></p><button type="submit">検索</button></form>${url.searchParams.get('q') ? `<p role="status">「${url.searchParams.get('q')}」の検索結果：3 件</p>` : ''}`));
      // 別ウィンドウで選ぶ画面（選ぶと元の画面の入力欄に反映して閉じる）
      case '/popup': return html(page('注文', `<p><label for="cust">顧客</label> <input id="cust" name="cust" readonly></p><button type="button" onclick="window.open('/popup-list', 'sub', 'width=500,height=400')">顧客選択</button>`));
      case '/popup-list': return html(page('顧客選択', `<table><thead><tr><th>顧客名</th><th>操作</th></tr></thead><tbody>${['青葉商事', '北山電機'].map(n => `<tr><td>${n}</td><td><button type="button" onclick="opener.document.getElementById('cust').value='${n}'; window.close()">選択</button></td></tr>`).join('')}</tbody></table>`));
      // ファイルのアップロード・ダウンロード
      case '/files': return html(page('ファイル', `<form method="post" action="/upload" enctype="multipart/form-data"><p><label for="f">添付ファイル</label> <input type="file" id="f" name="f"></p><button type="submit">アップロード</button></form><p><a href="/export.csv">CSV ダウンロード</a></p>`));
      case '/upload': { let n = 0; const chunks = []; req.on('data', d => { n += d.length; chunks.push(d); }); req.on('end', () => { const body = Buffer.concat(chunks).toString('latin1'); const name = Buffer.from(body.match(/filename="([^"]*)"/)?.[1] ?? '', 'latin1').toString('utf8'); const content = body.split('\r\n\r\n')[1]?.split('\r\n--')[0] ?? ''; html(page('アップロード完了', `<dl><dt>ファイル名</dt><dd>${name}</dd><dt>バイト数</dt><dd>${content.length}</dd></dl>`)); }); return; }
      case '/export.csv': res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="orders.csv"' }); return res.end('\uFEFF受注番号,顧客名\r\nJ-0001,青葉商事\r\nJ-0002,北山電機\r\n');
      case '/slow': return setTimeout(() => html(page('遅い画面', '<p>本文</p>')), 1200);
      case '/loading': return html(page('読込', `<p id="l">読み込み中</p><script>setTimeout(() => document.getElementById('l').remove(), 300);</script>`));
      default: return html(page('エラー', '<p>見つかりません。</p>'), 404);
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, look, close: () => new Promise(r => server.close(r)) };
}

// 結果の出力先を一時ディレクトリにしたサイト設定
export function makeSite(url, suites, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-test-')) + path.sep;
  return { name: 'fixture', dir, url, viewport: { width: 1000, height: 700 }, cookieFile: dir + 'out/session-cookie.json', suites,
    locators: createLocators(DEFAULTS),
    async login(browser, { viewport } = {}) { const context = await browser.newContext({ viewport, locale: 'ja-JP' }); const page = await context.newPage(); await page.goto(url); return { context, page }; },
    ...extra };
}

export const base = { screen: 'F01 試験用', kind: '表示', steps: '1. 操作', expect: '期待' };
