// 実行：node sites/flaskr/tests/run.mjs --engine playwright（--help で一覧）。アプリが起動していなければ起動・停止する
import { runTests } from '../../../core/runner.mjs';
import site from './site.mjs';
import { SUITES } from './cases.mjs';

await runTests({ ...site, suites: SUITES });
