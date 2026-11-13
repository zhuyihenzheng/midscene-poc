// Flaskr（Flask 公式チュートリアルのアプリ）：試験のサイト設定
// アプリは .ext/flask/examples/tutorial（git clone、リポジトリ外）。.ext/venv の Flask で起動する。手順は sites/flaskr/README.md
import { spawn, spawnSync } from 'child_process';
import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
import { createLocators, DEFAULTS, esc } from '../../../core/locators.mjs';
import { here, ROOT } from '../../../core/paths.mjs';

const PORT = Number(process.env.FLASKR_PORT || 8096);
const URL0 = `http://127.0.0.1:${PORT}/`;
const DIR = here(import.meta.url);
const APP = path.join(ROOT, '.ext', 'flask', 'examples', 'tutorial');
const FLASK = path.join(ROOT, '.ext', 'venv', process.platform === 'win32' ? 'Scripts/flask.exe' : 'bin/flask');

// 試験データ（パスワードは試験用の仮の値）
export const USERS = { alice: 'alice-pw', bob: 'bob-pw' };

// アプリ自身の画面（エンドポイント）でデータを作る。戻り値は Set-Cookie
async function post(p, form, cookie) {
  const r = await fetch(URL0 + p, { method: 'POST', redirect: 'manual', body: new URLSearchParams(form), headers: { connection: 'close', ...(cookie ? { cookie } : {}) } });
  return r.headers.get('set-cookie')?.split(';')[0];
}

// サイト固有の辞書：
// - ボタン（submit）は画面本体の中だけを探す（ナビの「Log In」「Register」リンクと名前が同じため）
// - リンクはリンクだけを探す
// - 投稿は表ではなく article.post なので「「タイトル」の投稿の「Edit」リンク」で指す
const SITE = {
  aiTap: [
    [/^「(.+)」の投稿の「(.+)」リンク$/, (page, [, title, name]) => page.locator('article.post').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).getByRole('link', { name, exact: true })],
    [/^「(.+)」ボタン$/, (page, [, name]) => page.locator('section.content').getByRole('button', { name, exact: true })],
    [/^「(.+)」リンク$/, (page, [, name]) => page.getByRole('link', { name, exact: true }).first()],
  ],
  // 画面名は section.content の見出し（ナビの「Flaskr」・投稿タイトルも h1 のため）。エラー画面（403・404）は body 直下の h1
  aiWaitFor: [[/^「(.+)」画面が表示されている$/, (page, [, title]) => page.locator('section.content > header > h1, body > h1').filter({ hasText: new RegExp(`^${esc(title)}$`) })]],
};

export default {
  name: 'flaskr', dir: DIR, url: URL0, viewport: { width: 1280, height: 900 }, cookieFile: DIR + 'out/session-cookie.json',
  locators: createLocators(SITE, DEFAULTS),
  design: fileURLToPath(new URL('../設計書.md', import.meta.url)),
  dialogs: true,
  // 画面状態の読み取り位置：見出しは画面本体の h1（エラー画面は body 直下の h1）、エラーは div.flash
  state: { titleSelector: 'section.content > header > h1, body > h1', alertSelector: '.flash' },

  // 未ログインのページを返す（データを初期化するたびにユーザーの id が変わるため、セッションは使い回さない）
  async login(browser, { viewport } = {}) {
    const context = await browser.newContext({ viewport, locale: 'en-US' });
    return { context, page: await context.newPage() };
  },

  async startApp() {
    if (!fs.existsSync(FLASK) || !fs.existsSync(APP)) throw new Error('Flaskr がありません。sites/flaskr/README.md の手順で .ext/ に取得してください');
    const up = () => fetch(URL0 + 'hello').then(r => r.ok, () => false);
    if (await up()) return null;
    const p = spawn(FLASK, ['--app', 'flaskr', 'run', '--port', String(PORT)], { cwd: APP, stdio: 'ignore' });
    for (let i = 0; i < 100 && !(await up()); i++) await new Promise(r => setTimeout(r, 100));
    return async () => p.kill();
  },

  beforeSuite: s => SITE_RESET(s),

  explore: {
    // 採取の前に DB を空にしてユーザーを登録し、bob の投稿を 1 件作る（一覧の採取に投稿が要る）
    setup: () => SITE_RESET({ seed: { bobPost: 'Hello from bob' } }),
    flows: [
      { name: 'Log In 画面', run: async page => { await page.goto(URL0 + 'auth/login'); } },
      { name: 'alice でログインして New Post', run: async page => {
        await page.goto(URL0 + 'auth/login'); await page.getByLabel('Username').fill('alice'); await page.getByLabel('Password').fill(USERS.alice);
        await page.locator('section.content').getByRole('button', { name: 'Log In' }).click(); await page.waitForURL(URL0);
        await page.goto(URL0 + 'create'); } },
    ],
  },

  report: {
    title: 'Flaskr 画面試験 結果一覧',
    target: () => `Flaskr（Flask 3.1.3 公式チュートリアル・${URL0}）`,
    basis: 'DOM 記録値・ダイアログの文言',
    sections: () => ['## 判定方法', '', '- 期待値は sites/flaskr/設計書.md（Flask 公式チュートリアルとアプリのソース）による。スイートごとに init-db で DB を空にする。'],
  },
};

// スイートごとに DB を空にし、アプリの画面からユーザー（と必要なら bob の投稿）を作る
async function SITE_RESET(s) {
  const r = spawnSync(FLASK, ['--app', 'flaskr', 'init-db'], { cwd: APP, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('init-db に失敗：' + (r.stderr || r.stdout));
  for (const [u, p] of Object.entries(USERS)) await post('auth/register', { username: u, password: p });
  if (s.seed?.bobPost) {
    const cookie = await post('auth/login', { username: 'bob', password: USERS.bob });
    await post('create', { title: s.seed.bobPost, body: 'bob の投稿' }, cookie);
  }
}
