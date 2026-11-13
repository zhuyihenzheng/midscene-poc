// 基準（baseline.json）：既知の NG を記録し、結果を「前回から変わったか」で見られるようにする。
// 基準どおりなら既知の NG があっても終了コード 0。人が見るのは「新規 NG」「NG 内容の変化」「解消」だけでよい。
//   { "cases": { "B-03": { "verdict": "NG", "ng": ["確認画面へ進む", ...], "note": "既知の不具合：チケット番号など" } } }
// 基準にないケースは OK が期待値。node sites/<name>/tests/run.mjs --update-baseline で今回の結果を保存する（note は引き継ぐ）。
import fs from 'fs';

export function loadBaseline(file) {
  if (!fs.existsSync(file)) return { cases: {} };
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { cases: b.cases ?? {} };
}

// 各 result に diff（一致 / 既知NG / 新規NG / NG内容の変化 / 解消）と note を付け、ID の一覧を返す
export function compareBaseline(results, baseline) {
  const sum = { known: [], fresh: [], changed: [], resolved: [] };
  for (const r of results) {
    const b = baseline.cases[r.c.id];
    r.note = b?.note ?? null;
    if (r.verdict === 'OK') { r.diff = b ? '解消' : '一致'; if (b) sum.resolved.push(r.c.id); continue; }
    if (!b) { r.diff = '新規NG'; sum.fresh.push(r.c.id); continue; }
    const same = b.verdict === r.verdict && JSON.stringify([...(b.ng ?? [])].sort()) === JSON.stringify([...r.ng].sort());
    r.diff = same ? '既知NG' : 'NG内容の変化';
    (same ? sum.known : sum.changed).push(r.c.id);
  }
  return sum;
}

export function saveBaseline(file, results, previous = { cases: {} }) {
  const cases = {};
  for (const r of results) if (r.verdict !== 'OK') cases[r.c.id] = { verdict: r.verdict, ng: r.ng, note: previous.cases[r.c.id]?.note ?? '' };
  fs.writeFileSync(file, JSON.stringify({ cases }, null, 2) + '\n');
}
