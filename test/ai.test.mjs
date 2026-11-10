// AI を使う経路の試験：模型の代わりをするサーバー（test/fixture/mock-model.mjs）を相手に、本物の Midscene ライブラリを通して
// --ai-assert・--heal・Midscene エンジン（YAML を CLI で実行）を端から端まで確かめる。
import test, { before, after } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'fs';
import { runTests } from '../core/runner.mjs';
import { makeState, go, shot, answerDialog } from '../core/steps.mjs';
import { AI } from '../core/check.mjs';
import { startFixture, makeSite, base } from './fixture/site.mjs';
import { startMockModel } from './fixture/mock-model.mjs';

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
