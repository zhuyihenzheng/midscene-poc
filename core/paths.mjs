// パスの共通処理（Windows / macOS / Linux 共通）。URL の pathname は Windows で「/C:/…」になり、空白や日本語も
// %エンコードされるため使わない。import.meta.url からの変換は必ずここを通す。
import path from 'path';
import { fileURLToPath } from 'url';

// リポジトリ直下（末尾に区切りつき）
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') + path.sep;
// 呼び出し元ファイルのディレクトリ（末尾に区切りつき）。site.mjs では const DIR = here(import.meta.url)
export const here = metaUrl => path.dirname(fileURLToPath(metaUrl)) + path.sep;
// リポジトリ直下からの相対パス（区切りは常に /。YAML・レポートに書く用）
// リポジトリの外（--results で指定した別の場所など）は絶対パスのまま返す
export const rel = p => { const r = path.relative(ROOT, p); return r.startsWith('..') || path.isAbsolute(r) ? p : './' + r.split(path.sep).join('/'); };
