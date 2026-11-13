// 試験プロセスでは、実行ログを標準エラーへ出す。
// node:test は子プロセスの標準出力を自分の通信路としても使うため、大量のログが混ざると、負荷が高いときに
// 「Unable to deserialize cloned data」で試験ファイルごと失敗することがある。
console.log = (...a) => { process.stderr.write(a.join(' ') + '\n'); };
