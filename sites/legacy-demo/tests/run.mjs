// 実行：node sites/legacy-demo/tests/run.mjs --engine playwright [--only 01-search] [--build-only] [--eval-only]（--help で一覧）
// アプリ（localhost:8095）が起動していなければ自動で起動・停止する
import { runTests } from '../../../core/runner.mjs';
import site from './site.mjs';
import { SUITES } from './cases.mjs';

await runTests({ ...site, suites: SUITES });
