// 新しいサイトの試験ひな形を作る：node core/new-site.mjs <name> [--url http://localhost:3000/]
//   sites/<name>/tests/{site.mjs, run.mjs, cases.mjs} を作り、.env.example にログイン項目のキーを足す。
//   続きは docs/new-site-guide.md（設計書の用意 → 画面採取 → 観点表 → ケース → 実行）。
import fs from 'fs'; import path from 'path';
import { ROOT } from './paths.mjs';

const args = process.argv.slice(2);
const name = args[0];
const url = (args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:3000/').replace(/\/?$/, '/');
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) { console.error('使い方：node core/new-site.mjs <name> [--url http://localhost:3000/]\n  name は英小文字・数字・ハイフン（例 order-system）'); process.exit(1); }
const dir = path.join(ROOT, 'sites', name, 'tests');
if (fs.existsSync(dir)) { console.error(`すでにあります：sites/${name}/tests`); process.exit(1); }
const KEY = name.toUpperCase().replace(/-/g, '_');

const files = {
  'site.mjs': `// ${name}：試験のサイト設定（core/runner.mjs・core/explore.mjs が読む）
import { createLocators, DEFAULTS } from '../../../core/locators.mjs';
import { here } from '../../../core/paths.mjs';

const DIR = here(import.meta.url);
const URL0 = process.env.${KEY}_URL || '${url}';

export default {
  name: '${name}', dir: DIR, url: URL0, viewport: { width: 1280, height: 1000 }, cookieFile: DIR + 'out/session-cookie.json',
  // label・fieldset/legend・h1 が整った画面なら標準辞書だけで足りる。足りない指示文は locators.mjs を作って createLocators(SITE, DEFAULTS) にする
  locators: createLocators(DEFAULTS),
  // 設計書（Markdown）。観点カバレッジ（未対応の項目・根拠のない期待値）の確認に使う
  // design: DIR + '../docs/設計書.md',

  // ログイン。資格情報は .env から読む（.env.example にキーだけ書く）
  async login(browser, { viewport } = {}) {
    const context = await browser.newContext({ viewport, locale: 'ja-JP' });
    const page = await context.newPage();
    await page.goto(URL0);
    // TODO：実画面のラベル・ボタン名に合わせる
    await page.getByLabel('ユーザーID', { exact: true }).fill(process.env.${KEY}_USER ?? '');
    await page.getByLabel('パスワード', { exact: true }).fill(process.env.${KEY}_PASS ?? '');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await page.waitForLoadState('networkidle');
    return { context, page };
  },

  // スイートごとにデータを初期状態へ戻し、終了後に裏側の記録（送信電文など）を取得する。開発側に口を用意してもらう
  // beforeSuite: async () => { await fetch(URL0 + '__test/reset', { method: 'POST' }); },
  // afterSuite: async () => ({ requests: await (await fetch(URL0 + '__test/requests')).json() }),
  // emptyJournal: { requests: [] },

  // リンクでたどれない画面（確認画面・入力エラー）を core/explore.mjs で採取する操作
  explore: { flows: [] },
};
`,
  'run.mjs': `// 実行：node sites/${name}/tests/run.mjs --engine playwright [--only 01-xxx] [--build-only] [--eval-only]（--help で一覧）
import { runTests } from '../../../core/runner.mjs';
import site from './site.mjs';
import { SUITES } from './cases.mjs';

await runTests({ ...site, suites: SUITES });
`,
  'cases.mjs': `// ${name} 画面試験：ケース定義（試験仕様書・YAML・判定の単一ソース）
// 期待値はすべて設計書から取る。画面は「どう操作し、どこから値を読むか」だけを教える（inventory/inventory.md）。
import { makeState, go, shot } from '../../../core/steps.mjs';
import { AI, absent, count, includes, partial } from '../../../core/check.mjs';

const state = makeState();
const screen = title => ({ aiWaitFor: \`「\${title}」画面が表示されている\`, timeout: 15000 });

export const SUITES = [
{
  file: '01-top', title: 'トップ画面', cases: [
  { id: 'T-01', screen: 'TODO 画面 ID と画面名', kind: '表示', title: 'ログイン後の初期表示',
    steps: '1. ログインする', expect: 'TODO：設計書の記述',
    flow: [...go('/'), state('T01'), shot('T-01 初期表示')],
    verify: [
      ['画面の見出し', 'T01.title', 'TODO：設計書の画面名']] },
  ] },
];
`,
};
fs.mkdirSync(dir, { recursive: true });
for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
const envExample = path.join(ROOT, '.env.example');
const keys = `\n# ${name}\n${KEY}_URL=\n${KEY}_USER=\n${KEY}_PASS=\n`;
if (fs.existsSync(envExample) && !fs.readFileSync(envExample, 'utf8').includes(`${KEY}_USER=`)) fs.appendFileSync(envExample, keys);
console.log(`作成：sites/${name}/tests/{site.mjs, run.mjs, cases.mjs}
.env.example に ${KEY}_URL / ${KEY}_USER / ${KEY}_PASS を追加（値は .env に書く）

次の手順
  1. site.mjs の login を実画面に合わせる
  2. node core/explore.mjs sites/${name}/tests/site.mjs          画面採取 → inventory/inventory.md
  3. 設計書と inventory をもとに cases.mjs を書く（Copilot なら /new-site-tests）
  4. node sites/${name}/tests/run.mjs --engine playwright --build-only   ケース定義・辞書・観点カバレッジの検査
  5. node sites/${name}/tests/run.mjs --engine playwright                実行`);
