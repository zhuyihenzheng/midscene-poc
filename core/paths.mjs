// パスの共通処理（Windows / macOS / Linux 共通）。URL の pathname は Windows で「/C:/…」になり、空白や日本語も
// %エンコードされるため使わない。import.meta.url からの変換は必ずここを通す。
import path from 'path';
import { fileURLToPath } from 'url';

// このフレームワークの置き場所（末尾に区切りつき）
export const FRAMEWORK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') + path.sep;
// 試験を置くプロジェクトの直下（末尾に区切りつき）。.env の場所、レポートに書く相対パスの基点になる。
//   1. 環境変数 SCREEN_TEST_ROOT があればそこ
//   2. このフレームワークがアプリのリポジトリに依存パッケージとして入っている（…/node_modules/<名前>/）ときは、
//      その node_modules を持つディレクトリ。実行時のカレントディレクトリには左右されない
//   3. それ以外（このリポジトリを clone して sites/ に試験を置く使い方）はフレームワーク直下
export function projectRoot(framework = FRAMEWORK, env = process.env) {
  if (env.SCREEN_TEST_ROOT) return path.resolve(env.SCREEN_TEST_ROOT) + path.sep;
  const parts = framework.split(path.sep).filter(Boolean);
  const at = parts.lastIndexOf('node_modules');
  if (at < 0) return framework;
  const prefix = framework.startsWith(path.sep) ? path.sep : '';
  return prefix + parts.slice(0, at).join(path.sep) + path.sep;
}
export const ROOT = projectRoot();
// アプリのリポジトリ側に試験を置いているか（import の書き方と new-site の出力先が変わる）
export const EMBEDDED = ROOT !== FRAMEWORK;
// 呼び出し元ファイルのディレクトリ（末尾に区切りつき）。site.mjs では const DIR = here(import.meta.url)
export const here = metaUrl => path.dirname(fileURLToPath(metaUrl)) + path.sep;
// プロジェクト直下（ROOT）からの相対パス（区切りは常に /。YAML・レポートに書く用）
// プロジェクトのすぐ外（2 階層上まで。アプリのリポジトリに組み込んだときの ../docs/設計書.md など）は「../」で始まる相対パス、
// それより遠い場所（--results で指定した一時ディレクトリなど）は絶対パスのまま返す。
// コミットされる出力（観点カバレッジ.md など）に、実行した端末の絶対パスを残さないため
export const relTo = (p, root) => {
  const r = path.relative(root, p);
  if (path.isAbsolute(r)) return p;
  const parts = r.split(path.sep);
  const up = parts.findIndex(s => s !== '..');
  if (up === 0) return './' + parts.join('/');
  return up > 0 && up <= 2 ? parts.join('/') : p;
};
// 引数は 1 つだけ受け取る（[...].map(rel) のように使われ、2 つ目に添字が渡されるため）
export const rel = p => relTo(p, ROOT);
