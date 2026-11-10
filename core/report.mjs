// 出力（全サイト共通）：試験仕様書.xlsx／試験結果.xlsx／結果一覧.md／report.html／不具合票ドラフト.md／out/junit.xml
import fs from 'fs'; import path from 'path';
import ExcelJS from 'exceljs';
import { rel } from './paths.mjs';

const wrap = { wrapText: true, vertical: 'top' };
const hardOf = r => r.items.filter(i => !i.ai && !i.warn);
const itemType = i => i.ai ? 'AI 判定' : i.auto ? '自動検査' : 'DOM／電文';
const itemRes = i => i.skipped ? '未実施' : i.warn ? '注意' : i.pass ? 'OK' : 'NG';
// AI 判定欄：AI 観点なし '-'／全件未実施（Playwright モード）'未実施'／それ以外は NG 件数
const aiLabel = r => !r.items.some(i => i.ai) ? '-' : !r.aiRun ? '未実施' : r.aiNg ? `NG ${r.aiNg} 件` : 'OK';
const verdictLabel = r => r.verdict + (r.cause ? `（${r.cause}）` : '');
const engineVersion = name => { try { return JSON.parse(fs.readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version; } catch { return ''; } };

function sheetHeader(ws, cols) {
  ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function writeSpec(file, SUITES) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('試験仕様書');
  sheetHeader(ws, [['ケースID', 'id', 12], ['画面', 'screen', 22], ['区分', 'kind', 14], ['テスト内容', 'title', 36], ['操作手順', 'steps', 60], ['期待結果', 'expect', 70]]);
  for (const s of SUITES) for (const c of s.cases) ws.addRow(c).alignment = wrap;
  await wb.xlsx.writeFile(file);
}

const FILL = { OK: 'FFD1FAE5', NG: 'FFFEE2E2', ブロック: 'FFE2E8F0' };

export async function writeResult(file, OUT, rs, evidence = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('試験結果');
  sheetHeader(ws, [['ケースID', 'id', 10], ['画面', 'screen', 20], ['区分', 'kind', 14], ['テスト内容', 'title', 34], ['操作手順', 'steps', 48], ['期待結果', 'expect', 56],
    ['判定', 'verdict', 10], ['NG の分類', 'cause', 12], ['基準比', 'diff', 14], ['確認観点（OK 数/全数）', 'score', 14], ['NG 観点', 'ng', 40], ['AI 判定', 'ai', 14], ['実行エンジン', 'engine', 12],
    ['備考', 'note', 30], ['証跡（Midscene レポート／Playwright Trace）', 'report', 40]]);
  for (const r of rs) {
    const hard = hardOf(r);
    const row = ws.addRow({ ...r.c, verdict: r.verdict, cause: r.cause ?? '', diff: r.diff ?? '', score: `${hard.filter(i => i.pass).length}/${hard.length}`,
      ng: r.verdict === 'ブロック' ? r.error ?? '' : hard.filter(i => !i.pass).map(i => `${i.desc}：${i.actual}`).join('\n'), ai: aiLabel(r), engine: r.engine,
      note: [r.note, r.flaky && 'やり直しで成功（不安定）', r.healed.length && `AI で代替 ${r.healed.length} 件`, r.verdict === 'NG' && r.error].filter(Boolean).join('\n'),
      report: r.report ? path.basename(r.report) : '' });
    row.alignment = wrap;
    row.getCell('verdict').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[r.verdict] } };
  }
  const wd = wb.addWorksheet('観点別明細');
  sheetHeader(wd, [['ケースID', 'id', 10], ['確認観点', 'desc', 48], ['種別', 'type', 10], ['結果', 'res', 8], ['期待値', 'expected', 50], ['実測値', 'actual', 80]]);
  for (const r of rs) for (const i of r.items) {
    const res = itemRes(i);
    const row = wd.addRow({ id: r.c.id, desc: i.desc, type: itemType(i), res, expected: i.expected ?? '', actual: i.actual });
    row.alignment = wrap; row.getCell('res').font = { bold: true, color: { argb: res === 'OK' ? 'FF047857' : res === 'NG' ? 'FFB91C1C' : res === '注意' ? 'FFB45309' : 'FF64748B' } };
  }
  // エビデンス：ケースごとに見出し＋画面（縮小表示・原寸は evidence/ の jpg）
  const we = wb.addWorksheet('エビデンス'); we.getColumn(1).width = 110; let row = 1;
  for (const r of rs) for (const e of (evidence[r.c.id] ?? []).filter(e => e.file.endsWith('.jpg'))) {
    const h = we.getCell(row, 1); h.value = `${r.c.id}　${r.c.title}　―　${e.label}（${r.verdict}）`; h.font = { bold: true };
    const buf = fs.readFileSync(OUT + e.file); const w = jpegSize(buf);
    const width = 760, height = Math.round(width * w.h / w.w);
    we.addImage(wb.addImage({ buffer: buf, extension: 'jpeg' }), { tl: { col: 0, row }, ext: { width, height } });
    row += 1 + Math.ceil(height / 20) + 1;
  }
  await wb.xlsx.writeFile(file);
}

function jpegSize(b) { for (let i = 2; i < b.length;) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; } return { w: 1280, h: 1800 }; }

// サイトの report 設定に既定値を補う
function reportConfig(site) { return { title: `${site.name} 画面試験 結果一覧`, target: () => site.url, basis: 'DOM 記録値', sections: () => [], ...site.report }; }

function engineLine(site, rs, runs) {
  const aiUsed = site.suites.some(s => runs[s.file]?.engine === 'playwright' && runs[s.file].aiAssert);
  const engines = [...new Set(rs.map(r => r.engine))];
  return { aiUsed, engines, pw: engines.includes('playwright'), text: engines.map(e => e === 'playwright'
    ? `Playwright ${engineVersion('playwright')}（固定ロケーター・モデル不要）${aiUsed ? '＋ aiAssert のみ AI（' + process.env.MIDSCENE_MODEL_NAME + '）' : '、aiAssert は未実施'}`
    : `Midscene ${engineVersion('@midscene/web')} ＋ ${process.env.MIDSCENE_MODEL_NAME}、ブラウザ操作は AI（aiTap/aiInput）`).join('／') };
}

function summaryLine(sum) {
  return `**${sum.ok}/${sum.total} ケース OK**` + (sum.ng ? `、NG ${sum.ng}` : '') + (sum.blocked ? `、ブロック ${sum.blocked}` : '');
}
function diffLines(sum) {
  const L = [];
  if (sum.fresh.length) L.push(`新規 NG：${sum.fresh.join(', ')}`);
  if (sum.changed.length) L.push(`NG 内容の変化：${sum.changed.join(', ')}`);
  if (sum.resolved.length) L.push(`解消（基準では NG）：${sum.resolved.join(', ')}`);
  if (sum.known.length) L.push(`既知の NG：${sum.known.join(', ')}`);
  if (sum.flaky.length) L.push(`やり直しで成功（不安定）：${sum.flaky.join(', ')}`);
  if (sum.healed.length) L.push(`AI で代替操作（辞書の修正が必要）：${sum.healed.join(', ')}`);
  if (sum.visualDiff?.length) L.push(`見た目が基準と違う（意図した変更なら --update-visual）：${sum.visualDiff.join(', ')}`);
  return L;
}

export function writeMd(file, site, rs, runs, sum) {
  const report = reportConfig(site); const eng = engineLine(site, rs, runs);
  const lines = [`# ${report.title}（${eng.engines.map(e => e === 'playwright' ? 'Playwright' : 'Midscene').join('＋')}）`, '',
    `- 実施日：${new Date().toLocaleDateString('sv-SE')}　対象：${report.target()}`,
    `- 実行：${eng.text}、合否は ${report.basis}で判定`,
    `- 結果：${summaryLine(sum)}`,
    `- 基準（baseline.json）との比較：${sum.fresh.length + sum.changed.length ? '**想定外あり**' : '想定どおり'}`, ...diffLines(sum).map(l => `  - ${l}`), '',
    '| ID | 画面 | テスト内容 | 判定 | 基準比 | 観点 OK/全数 | AI 判定 | NG 観点 |', '|---|---|---|---|---|---|---|---|'];
  for (const r of rs) {
    const hard = hardOf(r);
    const mark = r.verdict === 'OK' ? '✅ OK' : r.verdict === 'NG' ? `❌ NG（${r.cause}）` : '⏸ ブロック';
    const ng = r.verdict === 'ブロック' ? r.error ?? '' : hard.filter(i => !i.pass).map(i => `${i.desc}（${i.actual}）`).join('<br>');
    lines.push(`| ${r.c.id} | ${r.c.screen} | ${r.c.title} | ${mark} | ${r.diff === '一致' ? '' : r.diff} | ${hard.filter(i => i.pass).length}/${hard.length} | ${aiLabel(r)} | ${ng.replace(/\|/g, '｜')} |`);
  }
  const warns = rs.flatMap(r => r.items.filter(i => i.warn).map(i => `- ${r.c.id}：${i.desc.replace(/^自動検査（注意）：/, '')}（${i.actual}）`));
  if (warns.length) lines.push('', '## 注意（合否には含めない自動検査の検出）', '', ...warns);
  lines.push('', '## 判定の読み方', '',
    '- **NG（不一致）**：値は取得できたが期待値と違う。不具合の候補（`不具合票ドラフト.md` に下書きあり）。',
    '- **NG（実行不能）**：操作できず値を取得できなかった。画面の変更か試験側（ロケーター辞書・待ち）の問題。',
    '- **ブロック**：前のケースが中断したため実行していない。前のケースの解決後に再実行する。',
    '- **基準比**：`baseline.json`（既知の NG）と違う結果だけが終了コード 1 になる。', '',
    ...report.sections({ pw: eng.pw, aiUsed: eng.aiUsed }));
  const reportLines = site.suites.filter(s => runs[s.file]).map(s => `- ${runs[s.file].engine === 'playwright' ? 'Playwright Trace' : 'Midscene レポート'} ${s.file}（${s.title}・${runs[s.file].sec}s）：${runs[s.file].report ? rel(runs[s.file].report) : '-'}`);
  const at = lines.indexOf('## 再実行');
  if (at > 0) lines.splice(at - 1, 0, ...reportLines); else lines.push('', ...reportLines);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

// 不具合票の下書き：NG（不一致）のケースごとに、手順・期待・実際・証跡をまとめる。人は内容を確認して起票するだけでよい
export function writeBugDrafts(file, site, rs, evidence, runs) {
  const report = reportConfig(site);
  const ng = rs.filter(r => r.verdict === 'NG' && r.cause === '不一致');
  const L = ['# 不具合票ドラフト（自動生成）', '', `対象：${report.target()}　実施日：${new Date().toLocaleDateString('sv-SE')}`, '',
    '> NG（不一致）のケースから作った下書き。期待値は設計書によるもの。起票の前に、設計書の記述と証跡の画面を確認すること。', ''];
  if (!ng.length) L.push('該当なし（NG（不一致）のケースはありません）。', '');
  for (const r of ng) {
    const fails = hardOf(r).filter(i => !i.pass);
    L.push(`## ${r.c.id} ${r.c.title}${r.diff === '既知NG' ? '（既知）' : r.diff === '新規NG' ? '（新規）' : ''}`, '',
      `- 画面：${r.c.screen}　区分：${r.c.kind}`, ...(r.note ? [`- 備考：${r.note}`] : []), '', '### 手順', '', ...r.c.steps.split('\n'), '',
      '### 期待結果（設計書）', '', ...r.c.expect.split('\n'), '', '### 実際の結果', '',
      '| 確認観点 | 期待値 | 実測値 |', '|---|---|---|', ...fails.map(i => `| ${i.desc} | ${(i.expected ?? '（期待結果のとおり）').replace(/\|/g, '｜')} | ${String(i.actual).replace(/\|/g, '｜')} |`), '',
      ...(r.error ? [`実行時のエラー：${r.error}`, ''] : []),
      '### 証跡', '', ...(evidence[r.c.id] ?? []).map(e => `- ${e.label}：${e.file}`), ...(runs[r.suite.file]?.report ? [`- ${r.engine === 'playwright' ? 'Playwright Trace' : 'Midscene レポート'}：${rel(runs[r.suite.file].report)}`] : []), '',
      '### 再現', '', '```bash', `node ${rel(site.dir + 'run.mjs').slice(2)} --engine ${r.engine} --only ${r.suite.file}`, '```', '');
  }
  fs.writeFileSync(file, L.join('\n'));
}

const xml = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

// JUnit 形式（CI の結果表示用）。基準どおりの既知 NG とブロックは skipped、想定外の NG だけ failure にする
export function writeJunit(file, site, rs) {
  const L = ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuites name="${xml(site.name)}">`];
  for (const s of site.suites) {
    const list = rs.filter(r => r.suite === s); if (!list.length) continue;
    const failed = list.filter(r => r.verdict === 'NG' && r.diff !== '既知NG');
    L.push(`  <testsuite name="${xml(s.file + ' ' + s.title)}" tests="${list.length}" failures="${failed.length}" skipped="${list.length - failed.length - list.filter(r => r.verdict === 'OK').length}">`);
    for (const r of list) {
      const detail = hardOf(r).filter(i => !i.pass).map(i => `${i.desc}：期待 ${i.expected ?? '-'}／実測 ${i.actual}`).concat(r.error ?? []).join('\n');
      L.push(`    <testcase classname="${xml(site.name + '.' + s.file)}" name="${xml(r.c.id + ' ' + r.c.title)}" time="${r.sec ?? 0}">` +
        (r.verdict === 'OK' ? '' : failed.includes(r) ? `<failure message="${xml(`${verdictLabel(r)} ${r.diff}`)}">${xml(detail)}</failure>`
          : `<skipped message="${xml(`${verdictLabel(r)} ${r.diff}${r.note ? '：' + r.note : ''}`)}"/>`) + '</testcase>');
    }
    L.push('  </testsuite>');
  }
  L.push('</testsuites>');
  fs.writeFileSync(file, L.join('\n') + '\n');
}

const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 1 ファイルで開ける HTML レポート（証跡の画面を埋め込む）。想定外 → NG → ブロック → OK の順に並べ、想定外と NG は開いた状態で表示する
export function writeHtml(file, site, rs, evidence, runs, sum) {
  const report = reportConfig(site); const eng = engineLine(site, rs, runs);
  const unexpected = r => ['新規NG', 'NG内容の変化'].includes(r.diff);
  const rank = r => unexpected(r) ? 0 : r.verdict === 'NG' ? 1 : r.verdict === 'ブロック' ? 2 : r.diff === '解消' ? 3 : 4;
  const sorted = rs.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
  const cls = r => r.verdict === 'OK' ? 'ok' : r.verdict === 'NG' ? 'ng' : 'bl';
  const img = e => { try { return `data:image/${e.file.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(site.out + e.file).toString('base64')}`; } catch { return ''; } };
  const caseHtml = r => {
    const hard = hardOf(r);
    return `<details class="case ${cls(r)}" data-v="${cls(r)}" data-u="${unexpected(r) ? 1 : 0}"${rank(r) <= 1 ? ' open' : ''}>
<summary><span class="badge ${cls(r)}">${h(verdictLabel(r))}</span><span class="id">${h(r.c.id)}</span><span class="title">${h(r.c.title)}</span>
<span class="meta">${r.diff && r.diff !== '一致' ? `<span class="diff${unexpected(r) ? ' alert' : ''}">${h(r.diff)}</span>` : ''}${r.flaky ? '<span class="diff">不安定</span>' : ''}${r.healed.length ? '<span class="diff">AI で代替</span>' : ''}
<span class="score">${hard.filter(i => i.pass).length}/${hard.length}</span></span></summary>
<div class="body"><dl class="info"><dt>画面</dt><dd>${h(r.c.screen)}</dd><dt>区分</dt><dd>${h(r.c.kind)}</dd><dt>手順</dt><dd>${h(r.c.steps)}</dd><dt>期待結果</dt><dd>${h(r.c.expect)}</dd>
${r.error && r.verdict !== 'OK' ? `<dt>実行時のエラー</dt><dd class="err">${h(r.error)}</dd>` : ''}${r.note ? `<dt>備考（基準）</dt><dd>${h(r.note)}</dd>` : ''}</dl>
<div class="scroll"><table><thead><tr><th>確認観点</th><th>種別</th><th>期待値</th><th>実測値</th><th>結果</th></tr></thead><tbody>
${r.items.map(i => `<tr class="${itemRes(i) === 'NG' ? 'rng' : ''}"><td>${h(i.desc)}</td><td>${itemType(i)}</td><td>${h(i.expected ?? '')}</td><td>${h(i.actual)}</td><td class="res ${{ OK: 'ok', NG: 'ng', 注意: 'warn', 未実施: 'bl' }[itemRes(i)]}">${itemRes(i)}</td></tr>`).join('\n')}
</tbody></table></div>
${(evidence[r.c.id] ?? []).length ? `<div class="shots">${evidence[r.c.id].map(e => `<figure><img loading="lazy" src="${img(e)}" alt="${h(e.label)}"><figcaption>${h(e.label)}</figcaption></figure>`).join('')}</div>` : ''}</div></details>`;
  };
  const notes = diffLines(sum);
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(report.title)}</title><style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#0f172a;--sub:#5b6677;--line:#dfe3ea;--ok:#0f7a55;--okbg:#dff5ea;--ng:#b42318;--ngbg:#fde4e1;--bl:#475569;--blbg:#e6eaf0;--warn:#a15c07;--accent:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--card:#181c24;--ink:#e6e9ef;--sub:#9aa5b5;--line:#2a303b;--ok:#4ade80;--okbg:#12301f;--ng:#fca5a5;--ngbg:#3b1614;--bl:#b6c0cf;--blbg:#262c37;--warn:#fbbf24;--accent:#93b4ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 system-ui,"Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{font-size:20px;margin:0 0 4px}.sub{color:var(--sub);font-size:13px;margin:0 0 16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:0 0 12px}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px}
.card b{display:block;font-size:26px;line-height:1.2;font-variant-numeric:tabular-nums}.card span{color:var(--sub);font-size:12px}.card.ok b{color:var(--ok)}.card.ng b{color:var(--ng)}.card.bl b{color:var(--bl)}
.verdict{border-radius:8px;padding:10px 14px;margin:0 0 12px;font-weight:600;background:var(--okbg);color:var(--ok)}.verdict.alert{background:var(--ngbg);color:var(--ng)}
.notes{margin:0 0 16px;padding-left:20px;color:var(--sub);font-size:13px}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}.filters button{font:inherit;padding:5px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.filters button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}@media (prefers-color-scheme:dark){.filters button[aria-pressed=true]{color:#0f1218}}
.case{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:8px;margin:0 0 8px}.case.ng{border-left-color:var(--ng)}.case.bl{border-left-color:var(--bl)}
summary{display:flex;gap:10px;align-items:center;padding:9px 14px;cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}
.badge{flex:none;font-size:12px;font-weight:700;border-radius:4px;padding:1px 8px;background:var(--okbg);color:var(--ok)}.badge.ng{background:var(--ngbg);color:var(--ng)}.badge.bl{background:var(--blbg);color:var(--bl)}
.id{flex:none;font-weight:700;font-variant-numeric:tabular-nums}.title{flex:1;min-width:0}.meta{flex:none;display:flex;gap:8px;align-items:center;color:var(--sub);font-size:12px}
.diff{border:1px solid var(--line);border-radius:4px;padding:0 6px}.diff.alert{border-color:var(--ng);color:var(--ng);font-weight:700}
.body{padding:4px 14px 14px;border-top:1px solid var(--line)}.info{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;margin:10px 0}.info dt{color:var(--sub)}.info dd{margin:0;white-space:pre-wrap}.err{color:var(--ng)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{color:var(--sub);font-weight:600;white-space:nowrap}
tr.rng td{background:var(--ngbg)}.res{font-weight:700;white-space:nowrap}.res.ok{color:var(--ok)}.res.ng{color:var(--ng)}.res.warn{color:var(--warn)}.res.bl{color:var(--bl)}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:12px}figure{margin:0}figure.zoom{grid-column:1/-1}figure img{width:100%;cursor:zoom-in;border:1px solid var(--line);border-radius:4px;display:block}figcaption{font-size:12px;color:var(--sub);margin-top:2px}
@media (max-width:640px){summary{flex-wrap:wrap}.info{grid-template-columns:1fr}}
</style></head><body><main>
<h1>${h(report.title)}</h1>
<p class="sub">実施：${h(sum.date)}　対象：${h(report.target())}　実行：${h(eng.text)}</p>
<div class="cards"><div class="card"><b>${sum.total}</b><span>ケース</span></div><div class="card ok"><b>${sum.ok}</b><span>OK</span></div><div class="card ng"><b>${sum.ng}</b><span>NG</span></div>
<div class="card bl"><b>${sum.blocked}</b><span>ブロック</span></div><div class="card"><b>${sum.fresh.length + sum.changed.length}</b><span>想定外（基準比）</span></div><div class="card"><b>${sum.warnings}</b><span>注意</span></div></div>
<p class="verdict${sum.exitCode ? ' alert' : ''}">${sum.exitCode ? `基準と違う結果が ${sum.fresh.length + sum.changed.length} 件あります。確認が必要です。` : '基準どおりの結果です。' + (sum.known.length ? `（既知の NG ${sum.known.length} 件）` : '')}</p>
${notes.length ? `<ul class="notes">${notes.map(n => `<li>${h(n)}</li>`).join('')}</ul>` : ''}
<div class="filters" role="group" aria-label="表示の絞り込み">${[['all', `すべて ${sum.total}`], ['u', `想定外 ${sum.fresh.length + sum.changed.length}`], ['ng', `NG ${sum.ng}`], ['bl', `ブロック ${sum.blocked}`], ['ok', `OK ${sum.ok}`]].map(([k, t], i) => `<button type="button" data-f="${k}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>
${sorted.map(caseHtml).join('\n')}
</main><script>
document.querySelectorAll('.filters button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.filters button').forEach(x => x.setAttribute('aria-pressed', x === b));
  const f = b.dataset.f;
  document.querySelectorAll('.case').forEach(c => { c.hidden = !(f === 'all' || (f === 'u' ? c.dataset.u === '1' : c.dataset.v === f)); });
}));
// 証跡の画面はクリックで原寸幅に拡大・戻す
document.querySelectorAll('figure img').forEach(i => i.addEventListener('click', () => i.parentElement.classList.toggle('zoom')));
</script></body></html>`;
  fs.writeFileSync(file, html);
}
