// 判定（全サイト共通）
// ケースの判定は 2 通りで書ける（併用可）：
//   verify: [[観点, 'パス', 期待値], ...]   宣言形式。パスは出力 JSON 上の位置（例 'L02.errors.memberId'）。
//                                          'journal.' で始めると afterSuite の戻り値（送信電文など）を指す
//   check:  (o, ctx) => [[観点, 合否, 実測値], ...]   関数形式（表の行検索など、宣言で書きにくいもの）
// 期待値にはリテラル（文字列・数値・配列・オブジェクト＝完全一致）か、下のマッチャーを置く。

export function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// b のキーと値が a と完全一致（余分なキーもなし）
export function eqObj(a, b) { return !!a && eq(Object.keys(a).sort(), Object.keys(b).sort()) && Object.keys(b).every(k => a[k] === b[k]); }
// aiAssert の結果を観点にする。Playwright モードでは未実施（skipped）で、AI 判定の NG 件数に含めない
export function ai(r) { if (r?.skipped) return { ai: true, skipped: true, pass: false, actual: '未実施（Playwright モード）' };
  return { ai: true, pass: r?.pass === true, actual: r ? (r.pass ? 'OK：' : 'NG：') + (r.thought || '').replace(/\s+/g, ' ').slice(0, 200) : '未実行（手前のステップで中断）' }; }

// ---------- マッチャー（verify の期待値に置く） ----------
const M = Symbol('matcher');
const matcher = (label, test) => ({ [M]: true, label, test });
export const isMatcher = v => !!v?.[M];
// aiAssert の結果（参考判定）。例：['AI：保有ポイント', 'L04_ai', AI]
export const AI = { [M]: true, ai: true, label: 'AI 判定が OK' };
export const matches = re => matcher(`${re} に一致`, v => typeof v === 'string' && re.test(v));
export const includes = part => matcher(`「${fmt(part)}」を含む`, v => (typeof v === 'string' || Array.isArray(v)) && v.includes(part));
export const absent = matcher('なし（未設定・空）', v => v === undefined || v === null || v === '' || v === false);
export const present = matcher('あり（空でない）', v => v !== undefined && v !== null && v !== '' && v !== false);
export const count = n => matcher(`${n} 件`, v => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : -1) === n);
// オブジェクトの一部だけを見る（指定したキーが一致すればよい。余分なキーは許す）
export const partial = part => matcher(`${fmt(part)} を含む`, v => !!v && Object.entries(part).every(([k, x]) => test(x, v[k])));
// 配列の各要素が条件を満たす
export const every = expected => matcher(`すべて ${label(expected)}`, v => Array.isArray(v) && v.every(x => test(expected, x)));
export const not = expected => matcher(`${label(expected)} ではない`, v => !test(expected, v));
export const oneOf = (...list) => matcher(`${list.map(fmt).join(' / ')} のいずれか`, v => list.some(x => test(x, v)));
export const where = (text, fn) => matcher(text, fn);

function test(expected, actual) { return isMatcher(expected) ? expected.test(actual) : eq(actual, expected); }
function label(expected) { return isMatcher(expected) ? expected.label : fmt(expected); }
export function fmt(v) { return v === undefined ? '(未取得)' : typeof v === 'string' ? v : JSON.stringify(v); }

// 'A.b.c' を o からたどる。配列の添字は数字、キーに「.」を含む場合は配列でパスを渡す（['X01', 'dl', '合計（税込.）']）
export function pick(o, path) {
  let v = o;
  for (const k of Array.isArray(path) ? path : String(path).split('.')) { if (v === undefined || v === null) return undefined; v = k === 'length' && Array.isArray(v) ? v.length : v[k]; }
  return v;
}

// ケース 1 件を判定し、観点の配列を返す：{ desc, pass, actual, expected?, ai?, skipped? }
export function evaluate(c, o, ctx) {
  const items = [];
  const root = { ...o, journal: ctx.journal };
  for (const [desc, path, expected] of c.verify ?? []) {
    const actual = pick(root, path);
    if (expected?.ai) { items.push({ desc, ...ai(actual), expected: expected.label }); continue; }
    items.push({ desc, pass: test(expected, actual), actual: fmt(actual), expected: label(expected), missing: actual === undefined });
  }
  if (c.check) {
    for (const [desc, p, actual] of c.check(o, ctx)) {
      items.push(typeof p === 'object' && p?.ai ? { desc, pass: p.pass, actual: p.actual, ai: true, skipped: !!p.skipped }
        : { desc, pass: !!p, actual: fmt(actual), missing: actual === undefined || (Array.isArray(actual) && actual.length > 0 && actual.every(x => x === undefined)) });
    }
  }
  return items;
}
