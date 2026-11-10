// デモサイト（coupon-demo）を端から端まで実行する：不具合版は基準どおり（B-03 NG・B-04 ブロック）、修正版は全件 OK
import test from 'node:test'; import assert from 'node:assert/strict';
import { spawnSync } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path';
import { ROOT } from '../core/paths.mjs';

function demo(env, ...args) {
  const out = env.RESULTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'coupon-demo-'));
  const r = spawnSync(process.execPath, ['sites/coupon-demo/tests/run.mjs', '--engine', 'playwright', '--results', out, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  const file = path.join(out, 'out', 'summary.json');
  return { code: r.status, log: r.stdout + r.stderr, out, summary: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null };
}

test('不具合版：仕込んだ不具合だけを検出し、基準どおりなので終了コード 0', () => {
  const r = demo({ COUPON_DEMO_PORT: '8091', COUPON_DEMO_FIXED: '' });
  assert.equal(r.code, 0, r.log);
  const s = r.summary;
  assert.deepEqual([s.total, s.ok, s.ng, s.blocked], [23, 21, 1, 1]);
  assert.deepEqual([s.known, s.fresh, s.changed, s.resolved], [['B-03', 'B-04'], [], [], []]);
  assert.deepEqual(s.cases.find(c => c.id === 'B-03'), { id: 'B-03', verdict: 'NG', cause: '不一致', diff: '既知NG', ng: ['確認画面へ進む', 'エラーメッセージなし', '必要ポイント合計', '交換後の保有ポイント 0 pt'] });
  assert.match(fs.readFileSync(path.join(r.out, '不具合票ドラフト.md'), 'utf8'), /## B-03 .+（既知）[\s\S]+\| 確認画面へ進む \| 交換内容の確認 \| クーポン交換 \|/);
});

test('修正版：全件 OK。基準の NG は「解消」として知らせ、--strict では終了コード 1', () => {
  const r = demo({ COUPON_DEMO_PORT: '8092', COUPON_DEMO_FIXED: '1' });
  assert.equal(r.code, 0, r.log);
  assert.deepEqual([r.summary.ok, r.summary.total, r.summary.resolved], [23, 23, ['B-03', 'B-04']]);
  const strict = demo({ COUPON_DEMO_PORT: '8092', COUPON_DEMO_FIXED: '1', RESULTS: r.out }, '--eval-only', '--strict');
  assert.equal(strict.code, 1);
});

test('--build-only：ブラウザなしで YAML・試験仕様書・観点カバレッジを生成する', () => {
  const r = demo({ TEST_BROWSER_PATH: path.join(os.tmpdir(), 'no-such-browser') }, '--build-only');
  assert.equal(r.code, 0, r.log);
  assert.match(r.log, /全指示文を解決可（5 スイート・23 ケース）[\s\S]+設計書の 20 項目中 20 項目にケースあり/);
  for (const f of ['01-login.yaml', '05-boundary.yaml', '試験仕様書.xlsx', '観点カバレッジ.md']) assert.ok(fs.existsSync(path.join(r.out, f)), f);
});

test('画面採取：ログイン後にリンクと指定した操作をたどり、標準辞書で解決できる指示文候補を書き出す', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-'));
  const r = spawnSync(process.execPath, ['core/explore.mjs', 'sites/coupon-demo/tests/site.mjs', '--out', out], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, COUPON_DEMO_PORT: '8094' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const pages = JSON.parse(fs.readFileSync(path.join(out, 'inventory.json'), 'utf8'));
  assert.deepEqual(pages.map(p => p.h1), ['マイページ', 'クーポン一覧', '交換履歴', 'クーポン交換', 'クーポン交換', '交換内容の確認']);
  const exchange = pages[3];
  assert.deepEqual(exchange.fields.map(f => f.label), ['枚数', 'メールアドレス']);
  assert.ok(exchange.prompts.some(p => p.ok && p.kind === 'aiTap' && p.prompt === '受取方法の「メール」ラジオボタン'));
  assert.match(fs.readFileSync(path.join(out, 'inventory.md'), 'utf8'), /メッセージ（field・`#qty-error`）：枚数を入力してください。/);
});

// ---------- レガシー画面のデモ（label・h1 なし、ダイアログ、非同期の検索結果） ----------
function legacy(env, ...args) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-demo-'));
  const r = spawnSync(process.execPath, ['sites/legacy-demo/tests/run.mjs', '--engine', 'playwright', '--results', out, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  const file = path.join(out, 'out', 'summary.json');
  return { code: r.status, log: r.stdout + r.stderr, out, summary: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null };
}

test('レガシー画面・不具合版：仕込んだ 2 件（ダイアログの出方・金額の表示形式）だけを不一致として検出する', () => {
  const r = legacy({ LEGACY_DEMO_PORT: '8097', LEGACY_DEMO_FIXED: '' });
  assert.equal(r.code, 0, r.log);
  const s = r.summary;
  assert.deepEqual([s.total, s.ok, s.ng, s.blocked, s.known, s.fresh], [20, 18, 2, 0, ['T-05', 'D-02'], []]);
  assert.deepEqual(s.cases.filter(c => c.verdict === 'NG').map(c => c.cause), ['不一致', '不一致']);
  const draft = fs.readFileSync(path.join(r.out, '不具合票ドラフト.md'), 'utf8');
  assert.match(draft, /\| 範囲外のエラー（確認ダイアログは出ない） \| \["数量は1〜99の範囲で入力してください。"\] \| \["登録します。よろしいですか？"\] \|/);
  assert.match(draft, /\| 金額 \| 240,000 円 \| 240000 円 \|/);
});

test('レガシー画面・修正版：全件 OK', () => {
  const r = legacy({ LEGACY_DEMO_PORT: '8098', LEGACY_DEMO_FIXED: '1' });
  assert.equal(r.code, 0, r.log);
  assert.deepEqual([r.summary.ok, r.summary.total, r.summary.resolved], [20, 20, ['T-05', 'D-02']]);
});

test('レガシー画面の画面採取：label のない入力欄を項目名のセルから読み、表形式フォームの辞書で解決できる指示文候補を出す', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-'));
  const r = spawnSync(process.execPath, ['core/explore.mjs', 'sites/legacy-demo/tests/site.mjs', '--out', out], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LEGACY_DEMO_PORT: '8099' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const pages = JSON.parse(fs.readFileSync(path.join(out, 'inventory.json'), 'utf8'));
  const form = pages.find(p => p.h1 === '受注登録');
  assert.deepEqual(form.fields.map(f => f.label), ['顧客名', '商品', '数量', '備考']);
  for (const prompt of ['顧客名の入力欄', '商品の選択欄', '至急のチェックボックス', '「登録」ボタン']) assert.ok(form.prompts.some(p => p.ok && p.prompt === prompt), prompt);
});
