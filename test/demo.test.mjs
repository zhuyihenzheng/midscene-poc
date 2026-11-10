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
