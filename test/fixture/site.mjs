// フレームワーク自身の試験用の小さなサイト（エンジンの挙動を確かめるための画面だけを持つ）
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path';
import { createLocators, DEFAULTS } from '../../core/locators.mjs';

const page = (title, body) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

export async function startFixture() {
  let flaky = 0;
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
      case '/renamed': return html(page('編集', `<form action="/saved"><button type="submit">登録</button></form>`));
      case '/flaky': return html(page(++flaky === 1 ? '準備中' : '安定', '<p>本文</p>'));
      case '/loading': return html(page('読込', `<p id="l">読み込み中</p><script>setTimeout(() => document.getElementById('l').remove(), 300);</script>`));
      default: return html(page('エラー', '<p>見つかりません。</p>'), 404);
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(r)) };
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
