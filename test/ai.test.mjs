// AI を使う経路の試験：模型の代わりをするサーバー（test/fixture/mock-model.mjs）を相手に、本物の Midscene ライブラリを通して
// --ai-assert・--heal・Midscene エンジン（YAML を CLI で実行）を端から端まで確かめる。
import test, { before, after } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'fs';
import { runTests } from '../core/runner.mjs';
import { makeState, go, shot, answerDialog, upload, download } from '../core/steps.mjs';
import path from 'path'; import { fileURLToPath } from 'url';
import { AI } from '../core/check.mjs';
import { startFixture, makeSite, base } from './fixture/site.mjs';
import { startMockModel } from './fixture/mock-model.mjs';
import { evaluateModel, toMarkdown } from '../core/model-eval.mjs';

const state = makeState();
const screen = t => ({ aiWaitFor: `「${t}」画面が表示されている`, timeout: 8000 });
let fx, model;
// 失敗時の手がかり：Midscene CLI のログからエラーの行だけを抜き出す
function cliErrors(site, file) {
  const f = site.dir + `out/${file}.log`;
  if (!fs.existsSync(f)) return 'CLI のログなし';
  const lines = fs.readFileSync(f, 'utf8').split('\n').map(l => l.trim()).filter(l => /error|fail|cannot|not found|ENOENT|timeout/i.test(l) && !/^at /.test(l));
  return 'CLI-ERRORS: ' + [...new Set(lines)].slice(0, 12).map(l => l.slice(0, 260)).join(' || ');
}
before(async () => {
  fx = await startFixture();
  model = await startMockModel({
    // 画面上の位置（test/fixture/site.mjs の /fixed・/renamed で固定してある）
    locate: { '名前の入力欄': [100, 150, 300, 30], '「保存」ボタン': [100, 220, 120, 40], '「削除」ボタン': [100, 220, 120, 40] },
    truthy: s => !s.includes('エラー'),
  });
  Object.assign(process.env, model.env);
});
after(async () => { await fx.close(); await model.close(); });

test('--ai-assert：Playwright で操作し、aiAssert だけを Midscene で判定する（AI の NG は参考で、合否は変えない）', async () => {
  const site = makeSite(fx.url, [{ file: '01-ai', title: 'AI 判定', cases: [
    { ...base, id: 'A-01', title: '目視の確認', flow: [...go('/', 'ホーム'), state('A01'), { aiAssert: '「保存」ボタンが表示されている', name: 'A01_ok' }, { aiAssert: 'エラーが表示されている', name: 'A01_ng' }],
      verify: [['見出し', 'A01.title', 'ホーム'], ['AI：ボタン', 'A01_ok', AI], ['AI：エラー表示', 'A01_ng', AI]] }] }]);
  const r = await runTests(site, ['--engine', 'playwright', '--ai-assert'], { setExitCode: false });
  const [c] = r.results;
  assert.equal(c.verdict, 'OK');
  assert.deepEqual(c.items.filter(i => i.ai).map(i => [i.pass, !!i.skipped]), [[true, false], [false, false]]);
  assert.deepEqual([c.aiRun, c.aiNg], [2, 1]);
  assert.deepEqual(model.calls.filter(x => x.type === 'assert').map(x => x.ok).slice(-2), [true, false]);
});

test('--heal：辞書のロケーターが外れたステップを、Midscene が画面上の位置を特定してクリックする', async () => {
  const site = makeSite(fx.url, [{ file: '01-heal', title: '代替操作', cases: [
    // 画面のボタン名は「登録」。辞書は「保存」という名前のボタンを探して失敗し、AI（模型の代わりのサーバー）が位置を答える
    { ...base, id: 'R-01', title: 'ボタン名が変わった画面', flow: [...go('/renamed', '編集'), { aiTap: '「保存」ボタン', timeout: 1500 }, screen('保存完了'), state('R01')],
      verify: [['完了メッセージ', 'R01.status', '保存しました。']] }] }]);
  const before = model.calls.length;
  const r = await runTests(site, ['--engine', 'playwright', '--heal'], { setExitCode: false });
  assert.deepEqual([r.summary.cases[0].verdict, r.summary.healed], ['OK', ['R-01']]);
  assert.deepEqual(model.calls.slice(before).filter(x => x.type === 'locate').map(x => x.prompt), ['「保存」ボタン']);
});

test('Midscene エンジン：同じ flow を YAML にして CLI で実行し、AI の操作結果を DOM の値で判定する', async () => {
  const site = makeSite(fx.url, [{ file: '01-mid', title: 'AI 操作', cases: [
    { ...base, id: 'M-01', title: 'AI が入力して保存', flow: [...go('/fixed', '入力'), { aiInput: '名前の入力欄', value: 'yamada' }, { aiTap: '「保存」ボタン' }, screen('保存完了'), state('M01'),
      { aiAssert: '「保存しました。」と表示されている', name: 'M01_ai' }, shot('M-01 保存完了')],
      verify: [['完了メッセージ', 'M01.status', '保存しました。'], ['AI が入力した値が保存されている', 'M01.dl.名前', 'yamada'], ['AI：完了表示', 'M01_ai', AI]] },
    { ...base, id: 'M-02', title: '前のケースの続き', flow: [state('M02')], verify: [['保存完了のまま', 'M02.title', '保存完了']] },
  ] }], { viewport: { width: 1000, height: 700 } });
  const before = model.calls.length;
  const r = await runTests(site, ['--engine', 'midscene'], { setExitCode: false });
  const log = cliErrors(site, '01-mid');
  assert.deepEqual(r.summary.cases.map(c => c.verdict), ['OK', 'OK'], log);
  assert.equal(r.results[0].engine, 'midscene');
  assert.deepEqual(r.results[0].items.filter(i => i.ai).map(i => i.pass), [true]);
  const mine = model.calls.slice(before);
  assert.deepEqual(mine.filter(x => x.type === 'locate').map(x => x.prompt), ['名前の入力欄', '「保存」ボタン']);
  assert.ok(mine.some(x => x.type === 'assert' && x.statement.includes('保存完了')));
  assert.ok(fs.existsSync(site.dir + 'evidence/M-01_1_保存完了.jpg'), 'Midscene レポートから証跡の画面を取り出す');
  assert.match(fs.readFileSync(site.dir + '結果一覧.md', 'utf8'), /Midscene [\d.]+ ＋ mock-model/);
});

test('Midscene エンジン：確認ダイアログの文言を記録し、キャンセル・OK を指定できる', async () => {
  const site = makeSite(fx.url, [{ file: '01-dialog', title: 'ダイアログ', cases: [
    { ...base, id: 'G-01', title: '確認でキャンセル', flow: [...go('/fixed-dialog', '削除'), answerDialog('cancel'), { aiTap: '「削除」ボタン' }, state('G01')],
      verify: [['確認ダイアログ', 'G01.dialogs', ['削除します。よろしいですか？']], ['画面はそのまま', 'G01.title', '削除']] },
    { ...base, id: 'G-02', title: '確認で OK', flow: [{ aiTap: '「削除」ボタン' }, screen('保存完了'), state('G02')],
      verify: [['確認ダイアログ', 'G02.dialogs', ['削除します。よろしいですか？']], ['OK で処理が進む', 'G02.dl.名前', 'deleted']] },
  ] }], { dialogs: true });
  const r = await runTests(site, ['--engine', 'midscene'], { setExitCode: false });
  const log = cliErrors(site, '01-dialog');
  assert.deepEqual(r.summary.cases.map(c => c.verdict), ['OK', 'OK'], log);
});

test('--engine ai：同じブラウザ上で AI が操作する。別ウィンドウ・アップロード・ダウンロードも AI 操作で通る', async () => {
  const sample = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture', 'upload-sample.txt');
  let context;
  const site = makeSite(fx.url, [{ file: '01-ai-engine', title: 'AI 操作', cases: [
    { ...base, id: 'P-01', title: '別ウィンドウで顧客を選ぶ', flow: [...go('/popup', '注文'), { aiTap: '「顧客選択」ボタン' }, screen('顧客選択'), state('P01_sub'), { aiTap: '「北山電機」の行の「選択」ボタン' }, screen('注文'), state('P01')],
      verify: [['別ウィンドウの見出し', 'P01_sub.title', '顧客選択'], ['選んだ顧客が元の画面に反映される', 'P01.fields.cust.value', '北山電機']] },
    { ...base, id: 'U-01', title: 'アップロード', flow: [...go('/files', 'ファイル'), upload('添付ファイルの入力欄', sample), { aiTap: '「アップロード」ボタン' }, screen('アップロード完了'), state('U01')],
      verify: [['ファイル名', 'U01.dl.ファイル名', 'upload-sample.txt']] },
    { ...base, id: 'U-02', title: 'ダウンロード', flow: [...go('/files', 'ファイル'), download('「CSV ダウンロード」リンク', 'U02')],
      verify: [['ファイル名', 'U02.filename', 'orders.csv'], ['行', 'U02.lines', ['受注番号,顧客名', 'J-0001,青葉商事', 'J-0002,北山電機']]] },
  ] }], { viewport: { width: 1000, height: 700 } });
  const login = site.login;
  site.login = async (...a) => { const r = await login(...a); context = r.context; return r; };
  // 模型の代わり：指示文に対応する要素の位置を、いま前面にあるウィンドウから答える
  const selectors = { '「顧客選択」ボタン': 'button:has-text("顧客選択")', '「北山電機」の行の「選択」ボタン': 'tr:has-text("北山電機") button', '添付ファイルの入力欄': '#f',
    '「アップロード」ボタン': 'button:has-text("アップロード")', '「CSV ダウンロード」リンク': 'a[href="/export.csv"]' };
  model.live.locate = async prompt => {
    const page = context.pages().findLast(p => !p.isClosed());
    const b = selectors[prompt] && await page.locator(selectors[prompt]).boundingBox();
    return b ? { box: [b.x, b.y, b.width, b.height], viewport: page.viewportSize() } : null;
  };
  const before = model.calls.length;
  try {
    const r = await runTests(site, ['--engine', 'ai'], { setExitCode: false });
    assert.deepEqual(r.summary.cases.map(c => [c.id, c.verdict, c.ng]), [['P-01', 'OK', []], ['U-01', 'OK', []], ['U-02', 'OK', []]]);
    assert.equal(r.results[0].engine, 'ai');
    // 辞書は使わず、すべての操作で AI（模型の代わりのサーバー）に位置を尋ねている
    assert.deepEqual(model.calls.slice(before).filter(x => x.type === 'locate').map(x => x.prompt), Object.keys(selectors));
    assert.match(fs.readFileSync(site.dir + '結果一覧.md', 'utf8'), /AI 操作（Midscene ＋ Playwright）/);
  } finally { model.live.locate = null; }
});

test('モデル評価：指示文ごとにモデルの回答を辞書の正解と比べ、命中率と外れた指示文を出す', async () => {
  const site = makeSite(fx.url, [], { viewport: { width: 1000, height: 700 } });
  const inventory = [
    { url: '/fixed', h1: '入力', prompts: [{ kind: 'aiInput', prompt: '名前の入力欄', ok: true }, { kind: 'aiTap', prompt: '「保存」ボタン', ok: true }, { kind: 'aiWaitFor', prompt: '「入力」画面が表示されている', ok: true }, { kind: 'aiTap', prompt: '解決できない指示文', ok: false }] },
    { url: '/', h1: 'ホーム', prompts: [{ kind: 'aiTap', prompt: '「保存」ボタン', ok: true }, { kind: 'aiInput', prompt: '区分の選択欄', ok: true }] },
  ];
  // 模型の代わり：「名前の入力欄」は正しい位置、「保存」ボタンは表の位置（/fixed では正解）、「区分の選択欄」は見当違いの位置を答える
  model.live.locate = async prompt => prompt === '区分の選択欄' ? { box: [800, 600, 20, 20], viewport: { width: 1000, height: 700 } } : null;
  try {
    const r = await evaluateModel(site, { inventory, log: () => {} });
    // 問題になるのは、辞書で解決できた aiTap / aiInput だけ。同じ指示文は最初の画面でだけ問う
    assert.deepEqual(r.rows.map(x => [x.screen, x.prompt, x.hit]), [['入力', '名前の入力欄', true], ['入力', '「保存」ボタン', true], ['ホーム', '区分の選択欄', false]]);
    assert.deepEqual([r.total, r.hits, r.rate], [3, 2, 66.7]);
    assert.ok(r.rows[2].off > 100, '外れたときは正解の中心からの距離を出す');
    const md = toMarkdown(site, r);
    assert.match(md, /命中率：\*\*66\.7%\*\*（2\/3）/);
    assert.match(md, /## 外れた指示文[\s\S]*\| ホーム \| 区分の選択欄 \|/);
    // --dry-run：モデルを呼ばずに問題の一覧だけ出す
    const before = model.calls.length;
    const dry = await evaluateModel(site, { inventory, dryRun: true });
    assert.deepEqual([dry.total, dry.rate, model.calls.length - before], [3, null, 0]);
  } finally { model.live.locate = null; }
});
