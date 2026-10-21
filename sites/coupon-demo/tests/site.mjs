// ポイントクーポン交換サイト（デモ）：試験のサイト設定（core/runner.mjs・core/explore.mjs が読む）
import { spawn } from 'child_process';
import { createLocators, DEFAULTS } from '../../../core/locators.mjs';

const PORT = Number(process.env.COUPON_DEMO_PORT || 8090);
const URL0 = `http://localhost:${PORT}/`;
const DIR = new URL('./', import.meta.url).pathname;
const api = (p, opts) => fetch(URL0 + p.replace(/^\//, ''), { ...opts, headers: { connection: 'close' } });

// 試験用の会員（デモサイトの固定値。実サイトでは .env から読む）
const USER = process.env.COUPON_DEMO_USER || 'M0001';
const PASS = process.env.COUPON_DEMO_PASS || 'pass1234';

export default {
  name: 'coupon-demo', dir: DIR, url: URL0, viewport: { width: 1280, height: 1000 }, cookieFile: DIR + 'out/session-cookie.json',
  // 画面が label・fieldset/legend・h1 を備えているため、標準辞書だけで全指示文を解決できる（サイト固有の辞書なし）
  locators: createLocators(DEFAULTS),

  async login(browser, { viewport } = {}) {
    const context = await browser.newContext({ viewport, locale: 'ja-JP' });
    const page = await context.newPage();
    await page.goto(URL0 + 'login');
    await page.getByLabel('会員ID', { exact: true }).fill(USER);
    await page.getByLabel('パスワード', { exact: true }).fill(PASS);
    await Promise.all([page.waitForURL(URL0), page.getByRole('button', { name: 'ログイン' }).click()]);
    return { context, page };
  },

  // 起動していなければアプリを起動し、終了時に止める（COUPON_DEMO_FIXED=1 を引き継げば修正版で試験）
  async startApp() {
    if (await api('/login').then(r => r.ok, () => false)) return null;
    const p = spawn(process.execPath, [new URL('../app/server.mjs', import.meta.url).pathname], { stdio: 'ignore', env: process.env });
    for (let i = 0; i < 50 && !(await api('/login').then(r => r.ok, () => false)); i++) await new Promise(r => setTimeout(r, 100));
    return async () => p.kill();
  },
  // スイートごとにデータを初期化し、終了後にポイント基盤 API への送信電文を取得する（check の ctx.journal.ledger）
  beforeSuite: async () => { await api('/__test/reset', { method: 'POST' }); },
  afterSuite: async () => ({ ledger: await (await api('/__test/ledger')).json() }),
  emptyJournal: { ledger: [] },

  // core/explore.mjs：リンクでたどれない画面（確認画面・入力エラー）を採取する操作
  explore: {
    flows: [
      { name: 'クーポン交換で未入力のまま〈確認〉', run: async page => { await page.goto(URL0 + 'coupons/1/exchange'); await page.getByRole('button', { name: '確認' }).click(); } },
      { name: 'クーポン交換で 1 枚・アプリを入力して〈確認〉', run: async page => {
        await page.goto(URL0 + 'coupons/1/exchange'); await page.getByLabel('枚数', { exact: true }).fill('1');
        await page.getByRole('radio', { name: 'アプリ' }).check(); await page.getByRole('button', { name: '確認' }).click(); } },
    ],
  },

  report: {
    title: 'ポイントクーポン交換サイト 画面試験 結果一覧',
    target: () => `coupon-demo（${URL0}${process.env.COUPON_DEMO_FIXED === '1' ? '・修正版' : ''}）`,
    basis: 'DOM 記録値・ポイント基盤 API 送信電文',
    sections: ({ pw, aiUsed }) => ['## 判定方法', '',
      pw ? '- 画面操作は Playwright で実施。AI 指示文は標準辞書（core/locators.mjs の DEFAULTS）で固定ロケーターへ解決（モデル不要・サイト固有の辞書なし）。'
        : '- 画面操作は Midscene の AI 操作（aiTap / aiInput）で実施。',
      '- 合否は「DOM から記録した表示値」と「ポイント基盤 API への送信電文（/__test/ledger）」で判定。AI の目視判定（aiAssert）は参考' + (pw && !aiUsed ? '（Playwright モードでは未実施）。' : '。'),
      '- 期待値は sites/coupon-demo/app/設計書.md による。スイートごとに /__test/reset で初期データへ戻す。', '',
      '## 再実行', '', '```bash', 'node sites/coupon-demo/tests/run.mjs --engine playwright',
      'COUPON_DEMO_FIXED=1 node sites/coupon-demo/tests/run.mjs --engine playwright   # 修正版アプリで実行', '```'],
  },
};
