// アプリのリポジトリに依存パッケージとして組み込む使い方の試験（ブラウザ不要）：node --test test/embedded.test.mjs
// 一時ディレクトリに「アプリのリポジトリ」を作り、node_modules/midscene-poc に core をコピーして実行する。
// 実物の npm install と同じく core は実ディレクトリに置く（シンボリックリンクだと Node が実体のパスへ解決し、組み込みと判定できない）。
import './fixture/quiet.mjs';
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { spawnSync } from 'child_process';
import { FRAMEWORK } from '../core/paths.mjs';

function makeProject() {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'embedded app ')));
  const pkg = path.join(project, 'node_modules', 'midscene-poc');
  fs.mkdirSync(pkg, { recursive: true });
  fs.cpSync(path.join(FRAMEWORK, 'core'), path.join(pkg, 'core'), { recursive: true });
  fs.copyFileSync(path.join(FRAMEWORK, 'package.json'), path.join(pkg, 'package.json'));
  // フレームワークの依存（playwright・exceljs など）は、このリポジトリの node_modules をそのまま使う
  fs.symlinkSync(path.join(FRAMEWORK, 'node_modules'), path.join(pkg, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(project, 'package.json'), '{"private":true}\n');
  return { project, core: path.join(pkg, 'core') };
}
const node = (cwd, ...args) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, SCREEN_TEST_ROOT: '' } });

test('組み込み：ひな形はパッケージ名で core を参照し、プロジェクト直下からの相対パスで出力する', t => {
  const { project, core } = makeProject();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const made = node(project, path.join(core, 'new-site.mjs'), 'order-app', '--dir', 'screen-tests', '--url', 'http://localhost:8080');
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /作成：screen-tests\/\{site\.mjs, run\.mjs, cases\.mjs\}/);
  assert.match(made.stdout, /node screen-tests\/run\.mjs --engine playwright --build-only/);
  const dir = path.join(project, 'screen-tests');
  for (const f of ['site.mjs', 'run.mjs', 'cases.mjs']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(src, /from 'midscene-poc\/core\//, f);
    assert.doesNotMatch(src, /\.\.\/core\//, f);
  }
  // .env.example はアプリのリポジトリ側に作られる（フレームワーク側には書かない）
  assert.match(fs.readFileSync(path.join(project, '.env.example'), 'utf8'), /ORDER_APP_USER=/);

  // 別のディレクトリから実行しても、プロジェクト直下は node_modules の位置で決まる
  const elsewhere = fs.realpathSync(os.tmpdir());
  const built = node(elsewhere, path.join(dir, 'run.mjs'), '--engine', 'playwright', '--build-only');
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.ok(fs.existsSync(path.join(dir, '試験仕様書.xlsx')));
  const yaml = fs.readFileSync(path.join(dir, '01-top.yaml'), 'utf8');
  assert.match(yaml, /cookie: \.\/screen-tests\/out\/session-cookie\.json/);
  assert.ok(!yaml.includes(project), 'コミットされる YAML に絶対パスを書かない');

  // 既存の試験を上書きしない。プロジェクトの外は指定できない
  assert.equal(node(project, path.join(core, 'new-site.mjs'), 'order-app', '--dir', 'screen-tests').status, 1);
  assert.equal(node(project, path.join(core, 'new-site.mjs'), 'other', '--dir', '../outside').status, 1);
  assert.ok(!fs.existsSync(path.join(project, '..', 'outside')));
});

test('組み込み：--dir . でプロジェクト直下に置ける（試験専用のディレクトリを Node プロジェクトにする場合）', t => {
  const { project, core } = makeProject();
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const made = node(project, path.join(core, 'new-site.mjs'), 'order-app', '--dir', '.');
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /node run\.mjs --engine playwright --build-only/);
  assert.match(made.stdout, /npx screen-test-explore site\.mjs/);
  const built = node(project, 'run.mjs', '--engine', 'playwright', '--build-only');
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(fs.readFileSync(path.join(project, '01-top.yaml'), 'utf8'), /cookie: \.\/out\/session-cookie\.json/);
});
