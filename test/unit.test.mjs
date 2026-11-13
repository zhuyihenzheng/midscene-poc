// ブラウザを使わない単体試験：node --test test/unit.test.mjs
import './fixture/quiet.mjs';
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { ROOT, here, rel } from '../core/paths.mjs';
import { evaluate, pick, AI, absent, present, count, includes, matches, partial, every, not, oneOf } from '../core/check.mjs';
import { createLocators, DEFAULTS } from '../core/locators.mjs';
import { validateCases } from '../core/validate.mjs';
import { designItems, analyze } from '../core/coverage.mjs';
import { compareBaseline, saveBaseline, loadBaseline } from '../core/baseline.mjs';
import { toYamlSteps, continues, go, makeState } from '../core/steps.mjs';
import { TABLE_FORM } from '../core/locators.mjs';
import { SUITES as LEGACY } from '../sites/legacy-demo/tests/cases.mjs';
import legacySite from '../sites/legacy-demo/tests/site.mjs';
import { healthItems } from '../core/health.mjs';
import { parseMidsceneTasks, midsceneStartupFailed } from '../core/runner.mjs';
import { SUITES as DEMO } from '../sites/coupon-demo/tests/cases.mjs';
import demoSite from '../sites/coupon-demo/tests/site.mjs';

const mk = (id, extra = {}) => ({ id, screen: 'S01 画面', kind: '表示', title: 't', steps: 's', expect: 'e', flow: [{ goto: '/' }, { javascript: '1', name: id.replace('-', '') }], verify: [['観点', id.replace('-', ''), 1]], ...extra });

test('paths：OS の区切りによらず、相対パスは / 区切りで、ディレクトリは末尾に区切りが付く', () => {
  assert.equal(rel(path.join(ROOT, 'sites', 'x', 'tests', 'a.yaml')), './sites/x/tests/a.yaml');
  assert.ok(here(import.meta.url).endsWith(path.sep));
  assert.ok(fs.existsSync(path.join(ROOT, 'package.json')));
  assert.ok(!here(import.meta.url).includes('%'), '日本語・空白を含むパスでも % エンコードされない');
});

test('check：パスで値を取り出す', () => {
  const o = { A: { dl: { '必要ポイント（1 枚）': '300 pt' }, table: [['x', 'y']] } };
  assert.equal(pick(o, 'A.dl.必要ポイント（1 枚）'), '300 pt');
  assert.equal(pick(o, 'A.table.0.1'), 'y');
  assert.equal(pick(o, 'A.table.length'), 1);
  assert.equal(pick(o, ['A', 'dl', '必要ポイント（1 枚）']), '300 pt');
  assert.equal(pick(o, 'B.none.deep'), undefined);
});

test('check：verify の判定（リテラル・マッチャー・AI・未取得）', () => {
  const c = { verify: [
    ['一致', 'S.title', 'ログイン'], ['不一致', 'S.title', 'マイページ'], ['未取得', 'S.none.x', 'a'], ['なし', 'S.alert', absent], ['あり', 'S.title', present],
    ['件数', 'S.table', count(2)], ['含む', 'S.text', includes('ありません')], ['正規表現', 'S.no', matches(/^EX-\d{6}$/)], ['部分一致', 'S.field', partial({ visible: true })],
    ['全行', 'S.cats', every('飲食')], ['否定', 'S.title', not('エラー')], ['いずれか', 'S.title', oneOf('ログイン', 'サインイン')],
    ['電文', 'journal.ledger.0', { API: 'POINT_USE' }], ['AI', 'S_ai', AI]],
    check: o => [['関数形式', o.S.title === 'ログイン', o.S.title]] };
  const o = { S: { title: 'ログイン', alert: null, table: [1, 2], text: '履歴はありません。', no: 'EX-000001', field: { visible: true, value: '' }, cats: ['飲食', '飲食'] }, S_ai: { skipped: true } };
  const items = evaluate(c, o, { journal: { ledger: [{ API: 'POINT_USE' }] } });
  const by = Object.fromEntries(items.map(i => [i.desc, i]));
  for (const d of ['一致', 'なし', 'あり', '件数', '含む', '正規表現', '部分一致', '全行', '否定', 'いずれか', '電文', '関数形式']) assert.equal(by[d].pass, true, d);
  assert.equal(by['不一致'].pass, false); assert.equal(by['不一致'].missing, false); assert.equal(by['不一致'].expected, 'マイページ'); assert.equal(by['不一致'].actual, 'ログイン');
  assert.equal(by['未取得'].pass, false); assert.equal(by['未取得'].missing, true);
  assert.deepEqual([by['AI'].ai, by['AI'].skipped], [true, true]);
});

test('locators：標準辞書の書き方を解決でき、未登録の指示文を挙げる', () => {
  const loc = createLocators(DEFAULTS);
  const ok = [['aiTap', '「確認」ボタン'], ['aiTap', '画面下部の「戻る」ボタン'], ['aiTap', '受取方法の「メール」ラジオボタン'], ['aiTap', '「同意する」チェックボックス'], ['aiTap', '「A」の行の「編集」リンク'],
    ['aiTap', '「明細」タブ'], ['aiInput', '枚数の入力欄'], ['aiInput', '都道府県の選択欄'], ['aiInput', '「A」の行の数量の入力欄'],
    ['aiWaitFor', '「ログイン」画面が表示されている'], ['aiWaitFor', '「エラー」と表示されている'], ['aiWaitFor', '「読み込み中」が表示されていない']];
  for (const [k, p] of ok) assert.doesNotThrow(() => loc.resolve(k, p), p);
  assert.throws(() => loc.resolve('aiTap', '右上のあれ'), /未登録/);
  assert.deepEqual(loc.unmapped([{ cases: [{ flow: [{ aiTap: '右上のあれ' }, { aiHover: '「確認」ボタン' }, { aiInput: '枚数の入力欄', value: 1 }] }] }]), ['aiTap「右上のあれ」']);
});

test('locators：サイト固有の辞書が標準辞書より先に使われる', () => {
  const loc = createLocators({ aiTap: [[/^検索アイコン$/, () => 'site']] }, { aiTap: [[/^検索アイコン$/, () => 'default']] });
  assert.equal(loc.resolve('aiTap', '検索アイコン'), 'site');
});

test('validate：正しいケースは指摘なし、書き間違いは実行前に見つかる', () => {
  assert.deepEqual(validateCases([{ file: '01', title: 't', cases: [mk('A-01'), mk('A-02', { flow: [{ aiTap: '「次へ」ボタン' }, { javascript: '1', name: 'A02' }, { recordToReport: 'A-02 画面' }] })] }]), []);
  const bad = validateCases([{ file: '01', title: 't', cases: [
    mk('A-01'), mk('A-01'), mk('a1'), mk('A-03', { verify: [['typo', 'A99.title', 'x']] }), mk('A-04', { verify: undefined }),
    mk('A-05', { flow: [{ goto: '/' }, { javascript: '1', name: 'A05' }, { recordToReport: '画面' }, { aiClick: 'x' }, { aiInput: '枚数の入力欄' }] }),
    mk('A-06', { verify: [['undefined', 'A06', undefined]] }), mk('A-07', { expect: '' })] }]).join('\n');
  for (const word of ['id が重複', '英大文字-数字', 'A99 は、このスイートの flow で記録されていない', 'verify か check が必要', 'ケース ID で始める', '未対応のステップ', 'value がない', 'undefined', 'expect が未記入'])
    assert.match(bad, new RegExp(word), word);
});

test('coverage：設計書から画面・メッセージを拾い、未対応と根拠のない期待値を挙げる', () => {
  const md = ['| ID | 画面名 |', '|---|---|', '| S01 | ログイン |', '| S02 | 一覧 |', '', '| 商品コード | 商品名 |', '|---|---|', '| P01 | ノートPC |', '', '- 未入力：「IDを入力してください。」', '| 在庫不足 | 在庫が不足しています（残り N 枚）。 |', '- 履歴なし：「履歴はありません。」'].join('\n');
  assert.deepEqual(designItems(md).map(i => `${i.type}:${i.key}`), ['画面:S01', '画面:S02', 'メッセージ:IDを入力してください。', 'メッセージ:在庫が不足しています（残り N 枚）。', 'メッセージ:履歴はありません。']);
  const suites = [{ cases: [
    mk('A-01', { screen: 'S01 ログイン', verify: [['必須', 'A01', 'IDを入力してください。'], ['在庫', 'A01', '在庫が不足しています（残り 2 枚）。']] }),
    mk('A-02', { screen: 'S01 ログイン', verify: [['画面から写した文言', 'A02', '入力内容に誤りがあります。']] })] }];
  const { rows, unfounded } = analyze(md, suites);
  assert.deepEqual(rows.filter(r => !r.cases.length).map(r => r.key), ['S02', '履歴はありません。']);
  assert.deepEqual(unfounded, [{ id: 'A-02', text: '入力内容に誤りがあります。' }]);
});

test('coverage：デモサイトは設計書の全項目にケースがあり、期待値はすべて設計書に根拠がある', () => {
  const { rows, unfounded } = analyze(fs.readFileSync(demoSite.design, 'utf8'), DEMO);
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.filter(r => !r.cases.length), []);
  assert.deepEqual(unfounded, []);
});

test('baseline：既知 NG・新規 NG・NG 内容の変化・解消を区別する', () => {
  const r = (id, verdict, ng = []) => ({ c: { id }, verdict, ng });
  const results = [r('A-01', 'OK'), r('A-02', 'NG', ['x']), r('A-03', 'NG', ['x']), r('A-04', 'NG', ['y']), r('A-05', 'OK'), r('A-06', 'ブロック')];
  const sum = compareBaseline(results, { cases: { 'A-03': { verdict: 'NG', ng: ['x'], note: '既知' }, 'A-04': { verdict: 'NG', ng: ['x'] }, 'A-05': { verdict: 'NG', ng: ['x'] }, 'A-06': { verdict: 'ブロック', ng: [] } } });
  assert.deepEqual(results.map(x => x.diff), ['一致', '新規NG', '既知NG', 'NG内容の変化', '解消', '既知NG']);
  assert.deepEqual(sum, { known: ['A-03', 'A-06'], fresh: ['A-02'], changed: ['A-04'], resolved: ['A-05'] });
  assert.equal(results[2].note, '既知');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-')), 'baseline.json');
  saveBaseline(file, results, { cases: { 'A-03': { note: '既知' } } });
  assert.deepEqual(Object.keys(loadBaseline(file).cases), ['A-02', 'A-03', 'A-04', 'A-06']);
  assert.equal(loadBaseline(file).cases['A-03'].note, '既知');
  assert.deepEqual(loadBaseline(path.join(os.tmpdir(), 'no-such-baseline.json')), { cases: {} });
});

test('steps：goto は Midscene の YAML では javascript＋sleep になり、goto で始まらないケースは前のケースの続き', () => {
  assert.deepEqual(toYamlSteps({ goto: '/a' }).map(s => Object.keys(s)[0]), ['javascript', 'sleep']);
  assert.deepEqual(toYamlSteps({ aiTap: 'x' }), [{ aiTap: 'x' }]);
  // site.dialogs = true のときは、クリックの直前にダイアログの差し替えを入れる
  assert.deepEqual(toYamlSteps({ aiTap: 'x' }, { dialogs: true }).map(s => Object.keys(s)[0]), ['javascript', 'aiTap']);
  assert.deepEqual(toYamlSteps({ aiInput: 'x', value: 1 }, { dialogs: true }).length, 1);
  assert.equal(continues({ flow: go('/a', '画面') }), false);
  assert.equal(continues({ flow: [{ aiTap: 'x' }] }), true);
  assert.equal(continues({ continues: false, flow: [{ aiTap: 'x' }] }), false);
  assert.match(makeState({ extra: { balance: '#balance' } })('N').javascript, /^\(function pageState[\s\S]+\)\(\{"extra":\{"balance":"#balance"\}\}\)\n$/);
});

test('health：error は NG の観点、warn は合否を変えない注意になる', () => {
  const items = healthItems([{ level: 'error', kind: 'JS の例外', detail: 'boom' }, { level: 'warn', kind: '横スクロールの発生', detail: 'w' }]);
  assert.deepEqual(items.map(i => [i.pass, !!i.warn]), [[false, false], [true, true]]);
  assert.equal(healthItems([])[0].pass, true);
  assert.deepEqual(healthItems(undefined), []);
});

test('デモサイトのケース定義：検査で指摘なし・標準辞書だけで全指示文を解決できる', () => {
  assert.deepEqual(validateCases(DEMO), []);
  assert.deepEqual(demoSite.locators.unmapped(DEMO), []);
  assert.equal(DEMO.flatMap(s => s.cases).length, 23);
});

test('レガシー画面のデモ：表形式フォームの辞書で全指示文を解決でき、設計書の画面・メッセージにすべてケースがある', () => {
  assert.deepEqual(validateCases(LEGACY), []);
  assert.deepEqual(legacySite.locators.unmapped(LEGACY), []);
  const { rows, unfounded } = analyze(fs.readFileSync(legacySite.design, 'utf8'), LEGACY);
  assert.deepEqual(rows.filter(r => r.type === '画面').map(r => r.key), ['G00', 'G01', 'G02', 'G03'], '商品コードの表を画面一覧と取り違えない');
  assert.deepEqual([rows.filter(r => !r.cells?.length && !r.cases.length), unfounded], [[], []]);
  const loc = createLocators(TABLE_FORM, DEFAULTS);
  for (const [k, p] of [['aiInput', '顧客名の入力欄'], ['aiTap', '至急のチェックボックス'], ['aiTap', '区分の「法人」ラジオボタン'], ['aiTap', '「登録」ボタン']]) assert.doesNotThrow(() => loc.resolve(k, p), p);
});

test('Midscene CLI のログ：行の順序によらず、タスクごとの成功・失敗を拾う', () => {
  // 標準出力と標準エラーが入れ替わって「実行中」の行が後に来ても、成功を失敗と取り違えない
  const log = ['  ✔︎ A-01_成功 ', '  ✘ A-02_失敗 (task 1/4)', '  ◌ A-01_成功 ', '  ◌ A-02_失敗 ', '  ◌ A-03_未実行 '].join('\n');
  assert.deepEqual(parseMidsceneTasks(log), { 'A-01': 'ok', 'A-02': 'failed' });
  assert.deepEqual(parseMidsceneTasks('  ◌ A-01_x \n  ✔︎ A-01_x \n  ✘ A-01_x (task 2/3)'), { 'A-01': 'failed' });
  assert.deepEqual(parseMidsceneTasks(''), {});
  // どのケースも始まらないまま失敗した場合だけ「起動時の失敗」（やり直しの対象）とする
  assert.equal(midsceneStartupFailed('  ◌ A-01_x \nError: net::ERR_ABORTED at http://127.0.0.1:1/\nYAML execution failed:\n   Failed: 1'), true);
  assert.equal(midsceneStartupFailed('  ✘ A-01_x (task 1/4)\nYAML execution failed:\n   Failed: 1'), false);
  assert.equal(midsceneStartupFailed('  ✔︎ A-01_x \n   Failed: 0'), false);
});

test('coverage：「メッセージ」列のある表からは、句点で終わらない英語のメッセージも拾う', () => {
  const md = ['| 画面 | 条件 | メッセージ | 出典 |', '|---|---|---|---|', '| S03 | パスワード誤り | Incorrect password. | auth.py:99 |', '| S02 | 重複 | User {username} is already registered. | auth.py:74 |'].join('\n');
  assert.deepEqual(designItems(md).filter(i => i.type === 'メッセージ').map(i => i.key), ['Incorrect password.', 'User {username} is already registered.']);
  const { rows } = analyze(md, [{ cases: [mk('A-01', { verify: [['重複', 'A01', 'User alice is already registered.']] })] }]);
  assert.deepEqual(rows.filter(r => r.type === 'メッセージ').map(r => [r.key, r.cases]), [['Incorrect password.', []], ['User {username} is already registered.', ['A-01']]]);
});
