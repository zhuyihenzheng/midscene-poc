// ケース定義の静的検査（--build-only で実行。ブラウザ不要）。書き間違いを実行前に見つける。
import { KINDS } from './locators.mjs';

const STEP_KEYS = ['goto', 'javascript', 'sleep', 'aiKeyboardPress', 'aiAssert', 'recordToReport', 'upload', 'download', ...KINDS];

export function validateCases(SUITES) {
  const out = []; const ids = new Set(); const files = new Set();
  for (const s of SUITES) {
    if (!s.file || !s.title || !Array.isArray(s.cases)) { out.push(`スイート ${s.file ?? '(file なし)'}：file・title・cases が必要`); continue; }
    if (files.has(s.file)) out.push(`スイート ${s.file}：file が重複`); files.add(s.file);
    const names = new Set(); // このスイートでここまでに記録された名前（verify のパスの先頭に使える）
    for (const c of s.cases) {
      const at = `${s.file} ${c.id ?? '(id なし)'}`;
      // ケース ID は「英大文字-数字」。Midscene のログ・証跡ファイル名・基準（baseline.json）がこの形を前提にしている
      if (!/^[A-Z]+-\d+$/.test(c.id ?? '')) out.push(`${at}：id は「英大文字-数字」（例 L-01）`);
      if (ids.has(c.id)) out.push(`${at}：id が重複`); ids.add(c.id);
      for (const k of ['screen', 'kind', 'title', 'steps', 'expect']) if (typeof c[k] !== 'string' || !c[k]) out.push(`${at}：${k} が未記入（試験仕様書の列）`);
      if (!Array.isArray(c.flow) || !c.flow.length) { out.push(`${at}：flow が空`); continue; }
      for (const [i, st] of c.flow.entries()) {
        const key = STEP_KEYS.find(k => k in st);
        if (!key) { out.push(`${at}：flow[${i}] は未対応のステップ ${JSON.stringify(st).slice(0, 60)}`); continue; }
        if (key === 'aiInput' && st.value === undefined) out.push(`${at}：flow[${i}] aiInput に value がない`);
        if (key === 'recordToReport' && st.recordToReport.split(' ')[0] !== c.id) out.push(`${at}：証跡ラベル「${st.recordToReport}」はケース ID で始める（例「${c.id} 説明」）`);
        if (key === 'upload' && !st.file) out.push(`${at}：flow[${i}] upload に file がない`);
        if ((key === 'javascript' || key === 'aiAssert' || key === 'download') && st.name) {
          if (names.has(st.name)) out.push(`${at}：記録名 ${st.name} がスイート内で重複（前の値を上書きする）`);
          names.add(st.name);
        }
      }
      if (!c.verify?.length && typeof c.check !== 'function') out.push(`${at}：verify か check が必要（判定のないケースは OK にできない）`);
      else if (typeof c.check !== 'function' && c.verify.every(v => v?.[2]?.ai)) out.push(`${at}：判定が AI（aiAssert）だけ。AI 判定は参考扱いで、記録値の判定が 1 つもないケースは OK にならない（state() の値を verify に加える）`);
      for (const [i, v] of (c.verify ?? []).entries()) {
        if (!Array.isArray(v) || v.length !== 3 || typeof v[0] !== 'string') { out.push(`${at}：verify[${i}] は [観点, パス, 期待値] の 3 要素`); continue; }
        if (v[2] === undefined) out.push(`${at}：verify[${i}]「${v[0]}」の期待値が undefined（値がないことは absent で書く）`);
        const root = Array.isArray(v[1]) ? v[1][0] : String(v[1]).split('.')[0];
        if (root !== 'journal' && !names.has(root)) out.push(`${at}：verify[${i}]「${v[0]}」のパス先頭 ${root} は、このスイートの flow で記録されていない（記録名：${[...names].join(', ') || 'なし'}）`);
      }
    }
  }
  return out;
}
