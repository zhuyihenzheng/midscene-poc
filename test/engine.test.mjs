// ブラウザを使う試験：Playwright エンジン・判定・基準比較・出力を、試験用の小さなサイトで確かめる
import test, { before, after } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'fs';
import { runTests } from '../core/runner.mjs';
import { makeState, go, shot } from '../core/steps.mjs';
import { includes, not } from '../core/check.mjs';
import { startFixture, makeSite, base } from './fixture/site.mjs';

const state = makeState();
const screen = (t, timeout = 5000) => ({ aiWaitFor: `「${t}」画面が表示されている`, timeout });
const run = (site, ...args) => runTests(site, ['--engine', 'playwright', ...args], { setExitCode: false });
const byId = r => Object.fromEntries(r.summary.cases.map(c => [c.id, c]));
let fx;
before(async () => { fx = await startFixture(); });
after(async () => { await fx.close(); });

test('入力・選択・クリック・遷移・判定が通り、結果一式が出力される', async () => {
  const site = makeSite(fx.url, [{ file: '01-save', title: '保存', cases: [
    { ...base, id: 'F-01', title: '入力して保存', flow: [...go('/', 'ホーム'), { aiInput: '名前の入力欄', value: '山田' }, { aiInput: '区分の選択欄', value: '法人' }, state('F01_in'),
      { aiTap: '「保存」ボタン' }, screen('保存完了'), state('F01'), shot('F-01 保存完了')],
      verify: [['入力値', 'F01_in.fields.name.value', '山田'], ['選択肢の表示名', 'F01_in.fields.kind.text', '法人'], ['完了メッセージ', 'F01.status', '保存しました。'], ['保存内容', 'F01.dl', { 名前: '山田', 区分: 'b' }]] },
    { ...base, id: 'F-02', title: '消えるまで待つ', flow: [...go('/loading', '読込'), { aiWaitFor: '「読み込み中」が表示されていない', timeout: 5000 }, state('F02')],
      verify: [['読み込み表示が消えている', 'F02.text', not(includes('読み込み中'))]] },
  ] }]);
  const r = await run(site);
  assert.deepEqual(r.summary.cases.map(c => c.verdict), ['OK', 'OK']);
  assert.equal(r.exitCode, 0);
  for (const f of ['01-save.yaml', '試験仕様書.xlsx', '試験結果.xlsx', '結果一覧.md', '不具合票ドラフト.md', 'report.html', 'out/junit.xml', 'out/summary.json', 'out/01-save-trace.zip', 'evidence/F-01_1_保存完了.jpg'])
    assert.ok(fs.existsSync(site.dir + f), f);
  assert.match(fs.readFileSync(site.dir + 'report.html', 'utf8'), /data:image\/jpeg;base64,/);
});

test('自動検査：JS の例外・HTTP 5xx・undefined の表示は NG、横スクロール・ラベルなしは注意', async () => {
  const site = makeSite(fx.url, [{ file: '01-health', title: '自動検査', cases: [
    { ...base, id: 'H-01', title: '壊れた画面', flow: [...go('/broken', '集計'), { sleep: 300 }, state('H01'), shot('H-01 集計')], verify: [['見出し', 'H01.title', '集計']] },
    { ...base, id: 'H-02', title: '横に長い画面', flow: [...go('/wide', '横長'), state('H02')], verify: [['見出し', 'H02.title', '横長']] },
  ] }]);
  const r = await run(site);
  const [h1, h2] = r.results;
  assert.equal(h1.verdict, 'NG'); assert.equal(h1.cause, '不一致');
  const auto = h1.items.find(i => i.auto && !i.warn);
  for (const kind of ['JS の例外：boom', 'HTTP 5xx：500', '不正な表示値：合計：undefined 円']) assert.ok(auto.actual.includes(kind), `${kind} ← ${auto.actual}`);
  assert.equal(h2.verdict, 'OK');
  assert.deepEqual(h2.items.filter(i => i.warn).map(i => i.desc).sort(), ['自動検査（注意）：ラベルのない入力欄', '自動検査（注意）：横スクロールの発生']);
  assert.equal(r.summary.warnings, 2);

  // health:false で無効化、ignore で個別に除外できる
  const off = await run({ ...site, health: false });
  assert.deepEqual(off.summary.cases.map(c => c.verdict), ['OK', 'OK']);
  const ignored = await run({ ...site, health: { ignore: [/boom/, /HTTP 5xx/, /undefined/] } });
  assert.equal(ignored.summary.cases[0].verdict, 'OK');
});

const renamed = () => [{ file: '01-edit', title: '編集', cases: [
  { ...base, id: 'R-01', title: 'ボタン名が変わった画面', flow: [...go('/renamed', '編集'), { aiTap: '「保存」ボタン', timeout: 1500 }, screen('保存完了'), state('R01')], verify: [['完了メッセージ', 'R01.status', '保存しました。']] },
  { ...base, id: 'R-02', title: '前のケースの続き', flow: [state('R02')], verify: [['見出し', 'R02.title', '保存完了']] },
  { ...base, id: 'R-03', title: '独立したケース', flow: [...go('/', 'ホーム'), state('R03')], verify: [['見出し', 'R03.title', 'ホーム']] },
] }];

test('操作できないケースは NG（実行不能）、その続きはブロック、独立したケースは実行される', async () => {
  const site = makeSite(fx.url, renamed());
  const r = await run(site);
  const c = byId(r);
  assert.deepEqual([c['R-01'].verdict, c['R-01'].cause, c['R-02'].verdict, c['R-03'].verdict], ['NG', '実行不能', 'ブロック', 'OK']);
  assert.deepEqual([r.summary.fresh, r.exitCode], [['R-01', 'R-02'], 1]);
  assert.match(fs.readFileSync(site.dir + 'out/junit.xml', 'utf8'), /<failure message="NG（実行不能） 新規NG">/);
  assert.match(fs.readFileSync(site.dir + '不具合票ドラフト.md', 'utf8'), /該当なし/, '実行不能は不具合票にしない');

  // 基準に登録すると「既知の NG」になり終了コード 0。内容が変われば想定外に戻る
  const known = await run(site, '--eval-only', '--update-baseline');
  assert.deepEqual([known.summary.known, known.exitCode], [['R-01', 'R-02'], 0]);
  const b = JSON.parse(fs.readFileSync(site.dir + 'baseline.json', 'utf8'));
  b.cases['R-01'].ng = ['別の観点'];
  fs.writeFileSync(site.dir + 'baseline.json', JSON.stringify(b));
  const changed = await run(site, '--eval-only');
  assert.deepEqual([changed.summary.changed, changed.exitCode], [['R-01'], 1]);
});

test('--heal：辞書で操作できないステップを AI で代替し、辞書の修正候補として残す', async () => {
  const calls = [];
  // モデルの代わりに、指示文を受けて画面を操作するスタブを渡す
  const agentFactory = async page => ({ aiTap: async prompt => { calls.push(prompt); await page.getByRole('button', { name: '登録' }).click(); } });
  const r = await run(makeSite(fx.url, renamed(), { agentFactory }), '--heal');
  assert.deepEqual(calls, ['「保存」ボタン']);
  assert.deepEqual(r.summary.cases.map(c => c.verdict), ['OK', 'OK', 'OK']);
  assert.deepEqual(r.summary.healed, ['R-01']);
  assert.match(r.results[0].items.find(i => i.warn).desc, /AI で代替操作：aiTap「「保存」ボタン」/);
});

test('--retries：実行不能のスイートをやり直し、通ったケースを不安定として残す', async () => {
  const suites = [{ file: '01-flaky', title: '不安定', cases: [
    { ...base, id: 'K-01', title: '1 回目は準備中', flow: [{ goto: '/flaky' }, screen('安定', 1500), state('K01')], verify: [['見出し', 'K01.title', '安定']] }] }];
  const r = await run(makeSite(fx.url, suites), '--retries', '1');
  assert.deepEqual([r.summary.cases[0].verdict, r.summary.flaky, r.exitCode], ['OK', ['K-01'], 0]);
});

test('ログインできないスイートは全ケース実行不能として記録し、落ちずに結果を出す', async () => {
  const suites = [{ file: '01-a', title: 'a', cases: [{ ...base, id: 'Z-01', title: 't', flow: [...go('/', 'ホーム'), state('Z01')], verify: [['見出し', 'Z01.title', 'ホーム']] }] }];
  const site = makeSite(fx.url, suites, { login: async () => { throw new Error('ログイン画面が開けません'); } });
  const r = await run(site);
  assert.deepEqual([r.summary.cases[0].verdict, r.summary.cases[0].cause, r.exitCode], ['NG', '実行不能', 1]);
  assert.equal(r.results[0].error, 'ログイン画面が開けません');
});

test('辞書に未登録の指示文・ケース定義の誤りは、ブラウザを開く前に止める', async () => {
  const one = flow => [{ file: '01-a', title: 'a', cases: [{ ...base, id: 'Z-01', title: 't', flow, verify: [['見出し', 'Z01.title', 'ホーム']] }] }];
  await assert.rejects(run(makeSite(fx.url, one([{ aiTap: '右上のあれ' }, state('Z01')]))), /未登録の指示文が 1 件/);
  await assert.rejects(run(makeSite(fx.url, one([{ goto: '/' }, state('Z99')]))), /ケース定義に 1 件の誤り/);
  await assert.rejects(run(makeSite(fx.url, one([{ goto: '/' }, state('Z01')])), '--only', '99-none'), /存在しないスイート/);
});
