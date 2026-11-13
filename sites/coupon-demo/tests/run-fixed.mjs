// 修正版のデモアプリで実行する（環境変数の書き方が OS で違うため、スクリプトにしてある）：npm run demo:fixed
// 結果は .test-results/fixed/ に出す（リポジトリに入っている不具合版の結果を上書きしない）
process.env.COUPON_DEMO_FIXED = '1';
process.env.COUPON_DEMO_PORT ||= '8093';
process.argv.push('--engine', 'playwright', '--results', '.test-results/fixed');
await import('./run.mjs');
