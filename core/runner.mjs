// 試験ランナー（全サイト共通）：cases.mjs → YAML・試験仕様書 → 実行（Midscene / Playwright）→ 判定 → 試験結果（xlsx / md）
// 各サイトの run.mjs が site 設定を渡して呼ぶ：await runTests(site)
//   引数：[--engine midscene|playwright] [--ai-assert] [--only 01-xxx,02-yyy] [--build-only] [--eval-only]
//   --engine    midscene＝AI 操作（モデル必須）／playwright＝固定ロケーター（モデル不要）。既定は site.engineEnv（なければ TEST_ENGINE）の値、なければ midscene
//   --ai-assert playwright エンジンで aiAssert のみ AI 判定する（モデルが使える環境向け・任意）
//
// site 設定：
//   name, dir（スイートのディレクトリ・末尾 /）, suites（cases.mjs の SUITES）, url（開始 URL）, viewport, cookieFile
//   login(browser, { viewport }) → { context, page }、locators（core/locators.mjs の createLocators）
//   yamlStep(step)            任意：Midscene YAML 出力時のステップ変換
//   startApp()                任意：試験対象が起動していなければ起動し、停止関数を返す
//   beforeSuite(s) → state    任意：スイート前処理（受信履歴リセット・一時スタブ注入など）
//   afterSuite(s, state) → journal  任意：スイート後処理。戻り値は out/<スイート>-journal.json に保存し check の ctx.journal になる
//   emptyJournal              journal がないときの ctx.journal
//   report: { title, target(), basis, sections({ pw, aiUsed }) → md 行の配列 }  任意（各項目とも既定値あり）
import fs from 'fs'; import path from 'path'; import { spawnSync } from 'child_process';
import yaml from 'js-yaml'; import ExcelJS from 'exceljs';
import { launch, saveCookies } from './browser.mjs'; // .env もここで読み込む

const ROOT = new URL('../', import.meta.url).pathname; // リポジトリ直下（npx midscene の実行ディレクトリ）
const wrap = { wrapText: true, vertical: 'top' };
const rel = p => './' + path.relative(ROOT, p);

export async function runTests(site, args = process.argv.slice(2)) {
  const { dir: DIR, suites: SUITES } = site;
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
  const suites = SUITES.filter(s => !only || only.includes(s.file));
  const engine = args.includes('--engine') ? args[args.indexOf('--engine') + 1] : process.env[site.engineEnv ?? 'TEST_ENGINE'] || process.env.TEST_ENGINE || 'midscene';
  if (!['midscene', 'playwright'].includes(engine)) throw new Error('--engine は midscene / playwright');
  const aiAssert = args.includes('--ai-assert');
  fs.mkdirSync(DIR + 'out', { recursive: true });

  // ---------- 1. 生成 ----------
  for (const s of SUITES) {
    const doc = { web: { url: site.url, cookie: rel(site.cookieFile), viewportWidth: site.viewport.width, viewportHeight: site.viewport.height,
      output: rel(DIR + `out/${s.file}.json`) },
      tasks: s.cases.map(c => ({ name: `${c.id}_${c.title}`, continueOnError: true, flow: c.flow.map(site.yamlStep ?? (st => st)) })) };
    fs.writeFileSync(DIR + s.file + '.yaml', `# 自動生成（cases.mjs）：${s.title}\n` + yaml.dump(doc, { lineWidth: 200, noRefs: true }));
  }
  await writeSpec(DIR + '試験仕様書.xlsx', SUITES);
  // Playwright モード用ロケーター辞書の網羅確認（未登録の指示文があると Playwright では実行できない）
  const missing = site.locators.unmapped(SUITES);
  if (missing.length) { console.error('ロケーター辞書に未登録：\n  ' + missing.join('\n  ')); if (engine === 'playwright') process.exit(1); }
  else console.log(`ロケーター辞書：全指示文を解決可（${SUITES.length} スイート）`);
  if (args.includes('--build-only')) return;

  // ---------- 2. 実行 ----------
  const runsFile = DIR + 'out/runs.json';
  const runs = fs.existsSync(runsFile) ? JSON.parse(fs.readFileSync(runsFile, 'utf8')) : {};
  if (!args.includes('--eval-only')) {
    const stopApp = site.startApp ? await site.startApp() : null;
    try {
      for (const s of suites) {
        console.log(`\n=== ${s.file} ${s.title}`);
        const state = site.beforeSuite ? await site.beforeSuite(s) : undefined;
        const t0 = Date.now();
        let run, journal;
        try { run = engine === 'playwright' ? await runPlaywright(site, s, aiAssert) : await runMidscene(site, s); }
        finally { journal = site.afterSuite ? await site.afterSuite(s, state) : undefined; }
        if (journal !== undefined) fs.writeFileSync(DIR + `out/${s.file}-journal.json`, JSON.stringify(journal, null, 1));
        runs[s.file] = { engine, aiAssert: engine === 'playwright' ? aiAssert : true, sec: Math.round((Date.now() - t0) / 1000), ...run };
        fs.writeFileSync(runsFile, JSON.stringify(runs, null, 1));
        console.log(`  [${engine}] ${runs[s.file].sec}s tasks=${JSON.stringify(runs[s.file].tasks)}\n  report: ${runs[s.file].report}`);
      }
    } finally { await stopApp?.(); }
  }

  // ---------- 3. 判定 ----------
  const results = [];
  for (const s of SUITES) {
    const outFile = DIR + `out/${s.file}.json`; const jFile = DIR + `out/${s.file}-journal.json`;
    if (!fs.existsSync(outFile) && !fs.existsSync(jFile)) continue;
    const o = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
    const ctx = { journal: fs.existsSync(jFile) ? JSON.parse(fs.readFileSync(jFile, 'utf8')) : site.emptyJournal ?? {} };
    for (const c of s.cases) {
      let items;
      try { items = c.check(o, ctx).map(([desc, p, actual]) => typeof p === 'object' && p?.ai ? { desc, pass: p.pass, actual: p.actual, ai: true, skipped: !!p.skipped } : { desc, pass: !!p, actual: fmt(actual) }); }
      catch (e) { items = [{ desc: '判定処理', pass: false, actual: '例外：' + e.message }]; }
      const hard = items.filter(i => !i.ai); const aiItems = items.filter(i => i.ai);
      const verdict = hard.length && hard.every(i => i.pass) ? 'OK' : 'NG';
      results.push({ suite: s, c, items, verdict, aiNg: aiItems.filter(i => !i.pass && !i.skipped).length, aiRun: aiItems.filter(i => !i.skipped).length, task: runs[s.file]?.tasks?.[c.id] ?? '-', report: runs[s.file]?.report, engine: runs[s.file]?.engine ?? 'midscene' });
    }
  }
  const evidence = extractEvidence(DIR, SUITES, runs);
  await writeResult(DIR + '試験結果.xlsx', DIR, results, evidence);
  writeMd(DIR + '結果一覧.md', site, results, runs);
  console.log('\n' + results.map(r => `${r.c.id}\t${r.verdict}\t${r.items.filter(i => !i.pass && !i.skipped).map(i => i.desc).join(' / ')}`).join('\n'));
  return results;
}

// Midscene：Playwright でログインして cookie を保存→ YAML を CLI で実行し、ログとレポートからタスク結果を拾う
async function runMidscene(site, s) {
  const browser = await launch();
  try { const { context } = await site.login(browser, { viewport: site.viewport }); await saveCookies(context, site.cookieFile); }
  finally { await browser.close(); }
  const r = spawnSync('npx', ['midscene', rel(site.dir + s.file + '.yaml')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const log = (r.stdout || '') + (r.stderr || '');
  fs.writeFileSync(site.dir + `out/${s.file}.log`, log);
  const summaryPath = log.match(/Summary: (\S+\.json)/)?.[1];
  const report = summaryPath ? path.resolve(path.dirname(summaryPath), JSON.parse(fs.readFileSync(summaryPath, 'utf8')).results[0].report) : null;
  const tasks = {};
  for (const m of log.matchAll(/^\s+(\S+)\s+([A-Z]+-\d+)_/gm)) tasks[m[2]] = m[1].startsWith('✔') ? 'ok' : m[1];
  return { report, tasks, error: [...log.matchAll(/Error: (.+)/g)].map(m => m[1]).slice(0, 5) };
}

// Playwright：同じ flow を固定ロケーターで実行。証跡はスクリーンショット＋Trace（npx playwright show-trace で開く）
async function runPlaywright(site, s, aiAssert) {
  const { runSuite } = await import('./engine-playwright.mjs');
  const DIR = site.dir; const lines = [];
  const r = await runSuite(s, { site, outFile: DIR + `out/${s.file}.json`, shotsDir: DIR + `out/shots/${s.file}`, traceFile: DIR + `out/${s.file}-trace.zip`,
    aiAssert, log: l => { lines.push(l); console.log(l); } });
  fs.writeFileSync(DIR + `out/${s.file}.log`, lines.concat(r.errors).join('\n') + '\n');
  return { report: DIR + `out/${s.file}-trace.zip`, shots: DIR + `out/shots/${s.file}/manifest.json`, tasks: r.tasks, error: r.errors.slice(0, 5) };
}

// ---------- 出力 ----------
// recordToReport の画面を evidence/ へ保存する（Midscene：レポート HTML から抽出／Playwright：撮影済みの jpg を複写）
function extractEvidence(DIR, SUITES, runs) {
  const ev = {}; const dirE = DIR + 'evidence/'; fs.rmSync(dirE, { recursive: true, force: true }); fs.mkdirSync(dirE, { recursive: true });
  for (const s of SUITES) {
    if (runs[s.file]?.engine === 'playwright') {
      const mf = runs[s.file].shots; if (!mf || !fs.existsSync(mf)) continue;
      for (const { caseId, label, file: src } of JSON.parse(fs.readFileSync(mf, 'utf8'))) {
        const file = 'evidence/' + path.basename(src); fs.copyFileSync(src, DIR + file); (ev[caseId] ??= []).push({ label, file });
      }
      continue;
    }
    const rep = runs[s.file]?.report; if (!rep || !fs.existsSync(rep)) continue;
    const html = fs.readFileSync(rep, 'utf8');
    for (const m of html.matchAll(/"name":"Log - ([^"]+)".{0,400}?"midscene_screenshot_ref","id":"([0-9a-f-]+)"/g)) {
      const [, label, id] = m; const caseId = label.split(' ')[0];
      const img = html.match(new RegExp(`data-id="${id}">data:image/jpeg;base64,([A-Za-z0-9+/=]+)`))?.[1]; if (!img) continue;
      const n = (ev[caseId] ??= []).length + 1;
      const file = `evidence/${caseId}_${n}_${label.slice(caseId.length).trim().replace(/[\\/:*?"<>|（）() ]+/g, '_')}.jpg`;
      fs.writeFileSync(DIR + file, Buffer.from(img, 'base64')); ev[caseId].push({ label, file });
    }
  }
  return ev;
}

function fmt(v) { return v === undefined ? '(未取得)' : typeof v === 'string' ? v : JSON.stringify(v); }

function sheetHeader(ws, cols) {
  ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

async function writeSpec(file, SUITES) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('試験仕様書');
  sheetHeader(ws, [['ケースID', 'id', 12], ['画面', 'screen', 22], ['区分', 'kind', 14], ['テスト内容', 'title', 36], ['操作手順', 'steps', 60], ['期待結果', 'expect', 70]]);
  for (const s of SUITES) for (const c of s.cases) ws.addRow(c).alignment = wrap;
  await wb.xlsx.writeFile(file);
}

async function writeResult(file, DIR, rs, evidence = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('試験結果');
  sheetHeader(ws, [['ケースID', 'id', 10], ['画面', 'screen', 20], ['区分', 'kind', 14], ['テスト内容', 'title', 34], ['操作手順', 'steps', 48], ['期待結果', 'expect', 56],
    ['判定', 'verdict', 8], ['確認観点（OK 数/全数）', 'score', 14], ['NG 観点', 'ng', 40], ['AI 判定', 'ai', 14], ['実行エンジン', 'engine', 12], ['証跡（Midscene レポート／Playwright Trace）', 'report', 40]]);
  for (const r of rs) {
    const hard = r.items.filter(i => !i.ai);
    const row = ws.addRow({ ...r.c, verdict: r.verdict, score: `${hard.filter(i => i.pass).length}/${hard.length}`,
      ng: hard.filter(i => !i.pass).map(i => `${i.desc}：${i.actual}`).join('\n'), ai: aiLabel(r), engine: r.engine,
      report: r.report ? path.basename(r.report) : '' });
    row.alignment = wrap;
    row.getCell('verdict').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r.verdict === 'OK' ? 'FFD1FAE5' : 'FFFEE2E2' } };
  }
  const wd = wb.addWorksheet('観点別明細');
  sheetHeader(wd, [['ケースID', 'id', 10], ['確認観点', 'desc', 48], ['種別', 'type', 10], ['結果', 'res', 8], ['実測値', 'actual', 90]]);
  for (const r of rs) for (const i of r.items) {
    const row = wd.addRow({ id: r.c.id, desc: i.desc, type: i.ai ? 'AI 判定' : 'DOM／電文', res: i.skipped ? '未実施' : i.pass ? 'OK' : 'NG', actual: i.actual });
    row.alignment = wrap; row.getCell('res').font = { bold: true, color: { argb: i.skipped ? 'FF64748B' : i.pass ? 'FF047857' : 'FFB91C1C' } };
  }
  // エビデンス：ケースごとに見出し＋画面（縮小表示・原寸は evidence/ の jpg）
  const we = wb.addWorksheet('エビデンス'); we.getColumn(1).width = 110; let row = 1;
  for (const r of rs) for (const e of evidence[r.c.id] ?? []) {
    const h = we.getCell(row, 1); h.value = `${r.c.id}　${r.c.title}　―　${e.label}（${r.verdict}）`; h.font = { bold: true };
    const buf = fs.readFileSync(DIR + e.file); const w = buf.readUInt16BE ? jpegSize(buf) : { w: 1280, h: 1800 };
    const width = 760, height = Math.round(width * w.h / w.w);
    we.addImage(wb.addImage({ buffer: buf, extension: 'jpeg' }), { tl: { col: 0, row }, ext: { width, height } });
    row += 1 + Math.ceil(height / 20) + 1;
  }
  await wb.xlsx.writeFile(file);
}

// AI 判定欄：AI 観点なし '-'／全件未実施（Playwright モード）'未実施'／それ以外は NG 件数
function aiLabel(r) { return !r.items.some(i => i.ai) ? '-' : !r.aiRun ? '未実施' : r.aiNg ? `NG ${r.aiNg} 件` : 'OK'; }

function jpegSize(b) { for (let i = 2; i < b.length;) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; } return { w: 1280, h: 1800 }; }

function writeMd(file, site, rs, runs) {
  const { suites: SUITES } = site;
  // report 未指定のサイトは既定の見出し・判定方法で出力する
  const report = { title: `${site.name} 画面試験 結果一覧`, target: () => site.url, basis: 'DOM 記録値', sections: () => [], ...site.report };
  const aiUsed = SUITES.some(s => runs[s.file]?.engine === 'playwright' && runs[s.file].aiAssert);
  const ok = rs.filter(r => r.verdict === 'OK').length;
  const engines = [...new Set(rs.map(r => r.engine))];
  const pw = engines.includes('playwright');
  const engineLine = engines.map(e => e === 'playwright'
    ? `Playwright ${'1.64'}（固定ロケーター・モデル不要）${aiUsed ? '＋ aiAssert のみ AI（' + process.env.MIDSCENE_MODEL_NAME + '）' : '、aiAssert は未実施'}`
    : `Midscene ${'1.15.3'} ＋ ローカル LM（${process.env.MIDSCENE_MODEL_NAME}）、ブラウザ操作は AI（aiTap/aiInput）`).join('／');
  const lines = [`# ${report.title}（${engines.map(e => e === 'playwright' ? 'Playwright' : 'Midscene').join('＋')}）`, '',
    `- 実施日：${new Date().toLocaleDateString('sv-SE')}　対象：${report.target()}`,
    `- 実行：${engineLine}、合否は ${report.basis}で判定`,
    `- 結果：**${ok}/${rs.length} ケース OK**`, '',
    '| ID | 画面 | テスト内容 | 判定 | 観点 OK/全数 | AI 判定 | NG 観点 |', '|---|---|---|---|---|---|---|'];
  for (const r of rs) {
    const hard = r.items.filter(i => !i.ai);
    lines.push(`| ${r.c.id} | ${r.c.screen} | ${r.c.title} | ${r.verdict === 'OK' ? '✅ OK' : '❌ NG'} | ${hard.filter(i => i.pass).length}/${hard.length} | ${aiLabel(r)} | ${hard.filter(i => !i.pass).map(i => `${i.desc}（${i.actual}）`).join('<br>').replace(/\|/g, '｜')} |`);
  }
  lines.push('', ...report.sections({ pw, aiUsed }));
  const reportLines = SUITES.filter(s => runs[s.file]).map(s => `- ${runs[s.file].engine === 'playwright' ? 'Playwright Trace' : 'Midscene レポート'} ${s.file}（${s.title}・${runs[s.file].sec}s）：${runs[s.file].report}`);
  const at = lines.indexOf('## 再実行');
  if (at > 0) lines.splice(at - 1, 0, ...reportLines); else lines.push(...reportLines);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}
