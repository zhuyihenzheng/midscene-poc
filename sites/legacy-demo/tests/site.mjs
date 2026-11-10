// 受注管理システム（レガシー画面のデモ）：試験のサイト設定
// label・h1 のない画面のため、表形式フォーム用の辞書（TABLE_FORM）と、見出しの帯を画面名として読む設定を使う。
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createLocators, DEFAULTS, TABLE_FORM, exact } from '../../../core/locators.mjs';
import { here } from '../../../core/paths.mjs';

const PORT = Number(process.env.LEGACY_DEMO_PORT || 8095);
const URL0 = `http://localhost:${PORT}/`;
const DIR = here(import.meta.url);
const api = (p, opts) => fetch(URL0 + p.replace(/^\//, ''), { ...opts, headers: { connection: 'close' } });

const USER = process.env.LEGACY_DEMO_USER || 'u001';
const PASS = process.env.LEGACY_DEMO_PASS || 'pass1234';

// サイト固有の辞書：h1 がないため、画面名は上部の帯（.pageTitle）で判定する
const SITE = {
  aiWaitFor: [[/^「(.+)」画面が表示されている$/, (page, [, title]) => page.locator('.pageTitle').filter({ hasText: exact(title) })]],
};

export default {
  name: 'legacy-demo', dir: DIR, url: URL0, viewport: { width: 1280, height: 900 }, cookieFile: DIR + 'out/session-cookie.json',
  locators: createLocators(SITE, TABLE_FORM, DEFAULTS),
  design: fileURLToPath(new URL('../app/設計書.md', import.meta.url)),
  // 入力エラー・確認はブラウザのダイアログで出るため、文言を記録して判定する
  dialogs: true,
  // 画面状態の読み取り位置（cases.mjs の makeState と画面採取が使う）
  state: { titleSelector: '.pageTitle', statusSelector: 'div.msg', alertSelector: '.err', extra: { count: '#count' } },
  // label のない入力欄はこのシステムの作りどおりなので、自動検査の注意から外す
  health: { ignore: [/^ラベルのない入力欄/] },

  async login(browser, { viewport } = {}) {
    const context = await browser.newContext({ viewport, locale: 'ja-JP' });
    const page = await context.newPage();
    await page.goto(URL0 + 'login');
    await page.locator('[name=uid]').fill(USER);
    await page.locator('[name=pw]').fill(PASS);
    await Promise.all([page.waitForURL(URL0 + 'orders'), page.getByRole('button', { name: 'ログイン' }).click()]);
    return { context, page };
  },

  async startApp() {
    if (await api('/login').then(r => r.ok, () => false)) return null;
    const p = spawn(process.execPath, [fileURLToPath(new URL('../app/server.mjs', import.meta.url))], { stdio: 'ignore', env: process.env });
    for (let i = 0; i < 50 && !(await api('/login').then(r => r.ok, () => false)); i++) await new Promise(r => setTimeout(r, 100));
    return async () => p.kill();
  },
  beforeSuite: async () => { await api('/__test/reset', { method: 'POST' }); },
  afterSuite: async () => ({ requests: await (await api('/__test/requests')).json() }),
  emptyJournal: { requests: [] },

  explore: {
    flows: [
      // 〈新規登録〉はボタン（リンクではない）のため、URL を直接開いて採取する
      { name: '受注検索で〈新規登録〉', run: async page => { await page.goto(URL0 + 'orders/new'); } },
    ],
  },

  report: {
    title: '受注管理システム 画面試験 結果一覧',
    target: () => `legacy-demo（${URL0}${process.env.LEGACY_DEMO_FIXED === '1' ? '・修正版' : ''}）`,
    basis: 'DOM 記録値・ダイアログの文言・在庫引当 API 送信電文',
    sections: () => ['## 判定方法', '',
      '- label・h1 のない画面。入力欄は「項目名のセルの隣」（core/locators.mjs の TABLE_FORM）、画面名は上部の帯（.pageTitle）で特定する。',
      '- 入力エラー・確認のダイアログ（alert / confirm）は文言を記録して判定する（site.dialogs）。',
      '- 期待値は sites/legacy-demo/app/設計書.md による。スイートごとに /__test/reset で初期データへ戻す。', '',
      '## 再実行', '', '```bash', 'node sites/legacy-demo/tests/run.mjs --engine playwright', '```'],
  },
};
