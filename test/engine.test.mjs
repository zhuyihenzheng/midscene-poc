// ブラウザを使う試験：Playwright エンジン・判定・基準比較・出力を、試験用の小さなサイトで確かめる
import './fixture/quiet.mjs';
import test, { before, after } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'fs';
import { runTests } from '../core/runner.mjs';
import { makeState, go, shot, upload, download } from '../core/steps.mjs';
import { createLocators, DEFAULTS, inFrame } from '../core/locators.mjs';
import path from 'path'; import { fileURLToPath } from 'url';
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

test('--visual：初回は基準を登録し、見た目が変わると注意と差分の画像を出す。--update-visual で取り込む', async () => {
  const suites = [{ file: '01-look', title: '見た目', cases: [
    { ...base, id: 'V-01', title: 'お知らせの表示', flow: [...go('/styled', '見た目'), state('V01'), shot('V-01 お知らせ')], verify: [['見出し', 'V01.title', '見た目']] }] }];
  // 時刻のように毎回変わる要素は mask で比較から外す
  const site = makeSite(fx.url, suites, { visual: { mask: ['#clock'] } });
  const first = await run(site, '--visual');
  assert.ok(fs.existsSync(site.dir + 'visual-baseline/V-01_1_お知らせ.png'));
  assert.deepEqual([first.summary.visualDiff, first.summary.warnings], [[], 0]);
  const same = await run(site, '--visual');
  assert.deepEqual(same.summary.visualDiff, []);

  fx.look.color = '#b91c1c'; // DOM の値は同じまま、色だけが変わる
  const changed = await run(site, '--visual');
  assert.deepEqual([changed.summary.cases[0].verdict, changed.summary.visualDiff, changed.exitCode], ['OK', ['V-01'], 0]);
  assert.match(changed.results[0].items.find(i => i.visual).actual, /違う画素 \d+\.\d+%/);
  assert.ok(fs.existsSync(site.dir + 'evidence/V-01_1_お知らせ-diff.png'));
  assert.match(fs.readFileSync(site.dir + 'report.html', 'utf8'), /data:image\/png;base64,/);

  const updated = await run(site, '--update-visual');
  assert.deepEqual(updated.summary.visualDiff, []);
  assert.deepEqual((await run(site, '--visual')).summary.visualDiff, []);
  fx.look.color = '#1d4ed8';
});

test('iframe の中の画面：枠の中の入力欄・ボタンを操作し、枠の中の表示を記録する', async () => {
  const frameState = makeState({ frame: 'iframe[name=main]' });
  const site = makeSite(fx.url, [{ file: '01-frame', title: '枠', cases: [
    { ...base, id: 'I-01', title: '枠の中で検索', flow: [{ goto: '/frame' }, { aiWaitFor: '「検索」画面が表示されている', timeout: 5000 }, { aiInput: '検索語の入力欄', value: 'モニター' }, { aiTap: '「検索」ボタン' },
      { aiWaitFor: '「「モニター」の検索結果：3 件」と表示されている', timeout: 5000 }, frameState('I01'), state('I01_outer'), shot('I-01 枠の中の検索結果')],
      verify: [['枠の中の見出し', 'I01.title', '検索'], ['枠の中の結果', 'I01.status', '「モニター」の検索結果：3 件'], ['枠の中の入力値', 'I01.fields.q.value', 'モニター'], ['枠の外の見出し', 'I01_outer.title', '枠つき']] }] }],
    { locators: createLocators(inFrame('iframe[name=main]', DEFAULTS)) });
  const r = await run(site);
  assert.deepEqual(r.summary.cases.map(c => [c.verdict, c.ng]), [['OK', []]]);
});

test('別ウィンドウ：開いたウィンドウで操作し、閉じたら元のウィンドウに戻って続ける', async () => {
  const site = makeSite(fx.url, [{ file: '01-popup', title: '別ウィンドウ', cases: [
    { ...base, id: 'P-01', title: '別ウィンドウで顧客を選ぶ', flow: [...go('/popup', '注文'), { aiTap: '「顧客選択」ボタン' }, screen('顧客選択'), state('P01_sub'), shot('P-01 顧客選択'),
      { aiTap: '「北山電機」の行の「選択」ボタン' }, screen('注文'), state('P01'), shot('P-01 選択後')],
      verify: [['別ウィンドウの見出し', 'P01_sub.title', '顧客選択'], ['別ウィンドウの一覧', 'P01_sub.table', [['青葉商事', '選択'], ['北山電機', '選択']]], ['元の画面に戻る', 'P01.title', '注文'], ['選んだ顧客が反映される', 'P01.fields.cust.value', '北山電機']] },
    // 別ウィンドウを開いたまま終わっても、次の独立したケースは元のウィンドウから始まる
    { ...base, id: 'P-02', title: '開いたままにする', flow: [...go('/popup', '注文'), { aiTap: '「顧客選択」ボタン' }, screen('顧客選択'), state('P02')], verify: [['見出し', 'P02.title', '顧客選択']] },
    { ...base, id: 'P-03', title: '次のケースは元のウィンドウ', flow: [...go('/', 'ホーム'), state('P03')], verify: [['見出し', 'P03.title', 'ホーム']] },
  ] }]);
  const r = await run(site);
  assert.deepEqual(r.summary.cases.map(c => [c.verdict, c.ng]), [['OK', []], ['OK', []], ['OK', []]]);
});

test('ファイル：アップロードした内容がサーバーに届き、ダウンロードしたファイルの名前と中身を判定できる', async () => {
  const sample = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture', 'upload-sample.txt');
  const site = makeSite(fx.url, [{ file: '01-files', title: 'ファイル', cases: [
    { ...base, id: 'U-01', title: 'アップロード', flow: [...go('/files', 'ファイル'), upload('添付ファイルの入力欄', sample), { aiTap: '「アップロード」ボタン' }, screen('アップロード完了'), state('U01')],
      verify: [['ファイル名', 'U01.dl.ファイル名', 'upload-sample.txt'], ['バイト数', 'U01.dl.バイト数', '14']] },
    { ...base, id: 'U-02', title: 'ダウンロード', flow: [...go('/files', 'ファイル'), download('「CSV ダウンロード」リンク', 'U02')],
      verify: [['ファイル名', 'U02.filename', 'orders.csv'], ['行（BOM・改行を除く）', 'U02.lines', ['受注番号,顧客名', 'J-0001,青葉商事', 'J-0002,北山電機']]] },
  ] }]);
  const r = await run(site);
  assert.deepEqual(r.summary.cases.map(c => [c.verdict, c.ng]), [['OK', []], ['OK', []]]);
  assert.ok(fs.existsSync(site.dir + 'out/downloads/01-files/U-02_orders.csv'));
  // Midscene の YAML では、ダウンロードはクリックだけになり、アップロードは出力しない
  const yaml = fs.readFileSync(site.dir + '01-files.yaml', 'utf8');
  assert.ok(yaml.includes('aiTap: 「CSV ダウンロード」リンク') && !yaml.includes('upload'));
});

test('--workers：データを共有しないサイトはスイートを並列に実行でき、結果は順に実行したときと同じ', async () => {
  const suite = n => ({ file: `0${n}-slow`, title: `遅い画面 ${n}`, cases: [
    { ...base, id: `W-0${n}`, title: '遅い画面', flow: [{ goto: '/slow' }, screen('遅い画面'), state(`W0${n}`), { goto: '/slow' }, screen('遅い画面')], verify: [['見出し', `W0${n}.title`, '遅い画面']] }] });
  const suites = [1, 2, 3, 4].map(suite);
  // 並列かどうかは時間ではなく、サーバーが同時に処理した要求の数で確かめる（時間は実行環境の負荷で変わるため）
  fx.slow.max = 0;
  const seq = await run(makeSite(fx.url, suites, { parallel: true }));
  assert.equal(fx.slow.max, 1, '順に実行したときは同時に 1 件');
  fx.slow.max = 0;
  const par = await run(makeSite(fx.url, suites, { parallel: true }), '--workers', '4');
  assert.ok(fx.slow.max >= 2, `並列のときは同時に複数（実際 ${fx.slow.max} 件）`);
  assert.deepEqual(par.summary.cases.map(c => [c.id, c.verdict]), seq.summary.cases.map(c => [c.id, c.verdict]));
  assert.deepEqual(par.summary.cases.map(c => c.verdict), ['OK', 'OK', 'OK', 'OK']);
  // site.parallel のないサイトでは、指定しても順に実行する
  fx.slow.max = 0;
  const refused = await run(makeSite(fx.url, suites.slice(0, 2)), '--workers', '4');
  assert.deepEqual([refused.summary.cases.map(c => c.verdict), fx.slow.max], [['OK', 'OK'], 1]);
});

test('オリジンの違う iframe：枠の中で直接実行して画面状態を記録する', async () => {
  const other = await startFixture(); // 別ポート＝別オリジン
  try {
    const frameState = makeState({ frame: 'iframe[name=main]' });
    const site = makeSite(fx.url, [{ file: '01-xframe', title: '別オリジンの枠', cases: [
      { ...base, id: 'X-01', title: '別オリジンの枠の中で検索', flow: [{ goto: '/xframe?src=' + encodeURIComponent(other.url + 'frame-inner') }, { aiWaitFor: '「検索」画面が表示されている', timeout: 5000 },
        { aiInput: '検索語の入力欄', value: 'マウス' }, { aiTap: '「検索」ボタン' }, { aiWaitFor: '「「マウス」の検索結果：3 件」と表示されている', timeout: 5000 }, frameState('X01')],
        verify: [['枠の中の見出し', 'X01.title', '検索'], ['枠の中の結果', 'X01.status', '「マウス」の検索結果：3 件'], ['枠の中の URL', 'X01.path', '/frame-inner']] }] }],
      { locators: createLocators(inFrame('iframe[name=main]', DEFAULTS)) });
    const r = await run(site);
    assert.deepEqual(r.summary.cases.map(c => [c.verdict, c.ng]), [['OK', []]]);
  } finally { await other.close(); }
});

test('待ち（aiWaitFor）で止まったケースは、その時点の画面を記録して「不一致」として実測値を残す。操作で止まったケースは「実行不能」', async () => {
  const site = makeSite(fx.url, [{ file: '01-wait', title: '待ちの失敗', cases: [
    // 期待したメッセージが出ない（アプリの振る舞いが違う）：残りの state() で実際の画面を記録する
    { ...base, id: 'W-01', title: '期待した画面にならない', flow: [...go('/', 'ホーム'), { aiInput: '名前の入力欄', value: '山田' }, { aiTap: '「保存」ボタン' },
      { aiWaitFor: '「登録しました。」と表示されている', timeout: 1500 }, state('W01')],
      verify: [['完了メッセージ', 'W01.status', '登録しました。'], ['画面', 'W01.title', '保存完了']] },
    // ボタンが見つからない（画面の変更か試験側の問題）：記録しない
    { ...base, id: 'W-02', title: '操作できない', flow: [...go('/renamed', '編集'), { aiTap: '「保存」ボタン', timeout: 1500 }, state('W02')],
      verify: [['見出し', 'W02.title', '保存完了']] },
  ] }]);
  const r = await run(site);
  const [w1, w2] = r.results;
  assert.deepEqual([w1.verdict, w1.cause, w2.verdict, w2.cause], ['NG', '不一致', 'NG', '実行不能']);
  assert.equal(w1.items.find(i => i.desc === '完了メッセージ').actual, '保存しました。', '実際に表示された文言が残る');
  assert.equal(w1.items.find(i => i.desc === '画面').pass, true);
});
