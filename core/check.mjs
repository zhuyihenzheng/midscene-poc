// 判定用の小道具（cases.mjs の check から使う）
export function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// b のキーと値が a と完全一致（余分なキーもなし）
export function eqObj(a, b) { return !!a && eq(Object.keys(a).sort(), Object.keys(b).sort()) && Object.keys(b).every(k => a[k] === b[k]); }
// aiAssert の結果を観点にする。Playwright モードでは未実施（skipped）で、AI 判定の NG 件数に含めない
export function ai(r) { if (r?.skipped) return { ai: true, skipped: true, pass: false, actual: '未実施（Playwright モード）' };
  return { ai: true, pass: r?.pass === true, actual: r ? (r.pass ? 'OK：' : 'NG：') + (r.thought || '').replace(/\s+/g, ' ').slice(0, 200) : '未実行（手前のステップで中断）' }; }
