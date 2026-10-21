// 実行：node sites/coupon-demo/tests/run.mjs [--engine midscene|playwright] [--ai-assert] [--only 01-login] [--build-only] [--eval-only]
// アプリ（localhost:8090）が起動していなければ自動で起動・停止する。共通処理は core/runner.mjs
import { runTests } from '../../../core/runner.mjs';
import site from './site.mjs';
import { SUITES } from './cases.mjs';

await runTests({ ...site, suites: SUITES });
