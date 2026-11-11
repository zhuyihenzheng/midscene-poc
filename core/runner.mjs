// 試験ランナー（全サイト共通）：cases.mjs → YAML・試験仕様書 → 実行（Midscene / Playwright）→ 判定 → 基準比較 → 試験結果
// 各サイトの run.mjs が site 設定を渡して呼ぶ：await runTests({ ...site, suites: SUITES })
//
// 引数
//   --engine playwright|ai|midscene  playwright＝固定ロケーター（モデル不要）／ai＝同じブラウザ上で Midscene の AI が操作（要モデル）／
//                                 midscene＝YAML を Midscene CLI で実行（要モデル）。既定は TEST_ENGINE、なければ midscene
//   --only 01-xxx,02-yyy          実行するスイートを絞る
//   --build-only                  YAML・試験仕様書・観点カバレッジの生成と、ケース定義・ロケーター辞書の検査だけ行う（ブラウザ不要）
//   --eval-only                   実行せず、前回の出力を判定し直す
//   --retries N                   「実行不能」（操作できなかった）ケースがあるスイートを最大 N 回やり直す（値の不一致はやり直さない）
//   --ai-assert                   playwright エンジンで aiAssert だけ AI 判定する（要モデル）
//   --heal                        playwright エンジンで、辞書で操作できなかったステップを AI で代替する（要モデル）
//   --visual                      playwright エンジンで、証跡の画面を基準の画像（visual-baseline/）と比べ、違いを「注意」に載せる
//   --update-visual               今回の画面を見た目の基準として保存する（--visual を含む）
//   --workers N                   スイートを N 並列で実行する（playwright エンジンで、site.parallel = true のサイトだけ）
//   --update-baseline             今回の結果を baseline.json（既知の NG）として保存する
//   --strict                      基準で NG のケースが OK になった場合も終了コード 1 にする
//   --results <dir>               生成物（YAML・out・evidence・結果）の出力先を変える（既定はサイトの tests/）
//
// 終了コード：基準（baseline.json）と違う結果（新規 NG・NG 内容の変化）があれば 1。基準どおりなら既知の NG があっても 0。
//
// site 設定
//   name, dir（tests ディレクトリ・末尾区切りつき）, suites（cases.mjs の SUITES）, url（開始 URL）, viewport, cookieFile
//   login(browser, { viewport }) → { context, page }、locators（core/locators.mjs の createLocators）
//   design                    任意：設計書（Markdown）のパス。観点カバレッジと期待値の根拠確認に使う
//   yamlStep(step)            任意：Midscene YAML 出力時のステップ変換
//   startApp()                任意：試験対象が起動していなければ起動し、停止関数を返す
//   beforeSuite(s) → state    任意：スイート前処理（データ初期化・受信履歴リセットなど）
//   afterSuite(s, state) → journal  任意：スイート後処理。戻り値は out/<スイート>-journal.json に保存し、判定の journal になる
//   emptyJournal              journal がないときの値
//   settle(page)              任意：操作後の待ち（既定は読み込み完了＋通信の静止）
//   parallel                  任意：true でスイートの並列実行（--workers）を許可する。スイートどうしがデータを共有しないサイトだけ
//   dialogs                   任意：true で alert / confirm / prompt の文言を記録し、答えを指定できるようにする（core/steps.mjs）
//   state                     任意：makeState に渡す設定（titleSelector など）。画面採取（core/explore.mjs）も見出しの取得に使う
//   health                    任意：自動検査の設定（false で無効、{ ignore: [/…/] } で除外）
//   visual                    任意：見た目の比較の設定（{ threshold: 0.001, mask: ['セレクター'] }）
//   report: { title, target(), basis, sections({ pw, aiUsed }) → md 行の配列 }  任意
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process';
import yaml from 'js-yaml';
import { launch, saveCookies, bundledChromium } from './browser.mjs'; // .env もここで読み込む
import { ROOT, rel } from './paths.mjs';
import { evaluate } from './check.mjs';
import { continues, toYamlSteps } from './steps.mjs';
import { healthItems } from './health.mjs';
import { compareVisual, visualItems } from './visual.mjs';
import { validateCases } from './validate.mjs';
import { writeCoverage } from './coverage.mjs';
import { loadBaseline, compareBaseline, saveBaseline } from './baseline.mjs';
import { writeSpec, writeResult, writeMd, writeHtml, writeJunit, writeBugDrafts } from './report.mjs';

const HELP = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(3, 21).map(l => l.replace(/^\/\/ ?/, '')).join('\n');

// setExitCode:false にすると process.exitCode を変えない（戻り値の exitCode だけを使う。フレームワーク自身の試験用）
export async function runTests(site, args = process.argv.slice(2), { setExitCode = true } = {}) {
  const fail = () => { if (setExitCode) process.exitCode = 1; };
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return null; }
  const opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const { dir: DIR, suites: SUITES } = site;
  const OUT = opt('--results') ? path.resolve(opt('--results')) + path.sep : DIR;
  site = { ...site, out: OUT };
  const only = opt('--only')?.split(',') ?? null;
  const unknown = only?.filter(f => !SUITES.some(s => s.file === f)) ?? [];
  if (unknown.length) throw new Error(`--only に存在しないスイート：${unknown.join(', ')}（指定できるのは ${SUITES.map(s => s.file).join(', ')}）`);
  const suites = SUITES.filter(s => !only || only.includes(s.file));
  const engine = opt('--engine') ?? (process.env[site.engineEnv ?? 'TEST_ENGINE'] || process.env.TEST_ENGINE || 'midscene');
  if (!['midscene', 'playwright', 'ai'].includes(engine)) throw new Error('--engine は playwright / ai / midscene');
  const inBrowser = engine !== 'midscene'; // playwright・ai はこのプロセスの Playwright で実行する
  const flags = { aiAssert: args.includes('--ai-assert'), heal: args.includes('--heal'), retries: Number(opt('--retries') ?? 0),
    visual: args.includes('--visual') || args.includes('--update-visual'), updateVisual: args.includes('--update-visual') };
  fs.mkdirSync(OUT + 'out', { recursive: true });

  // ---------- 1. 生成・検査 ----------
  for (const s of SUITES) {
    const doc = { web: { url: site.url, cookie: rel(site.cookieFile), viewportWidth: site.viewport.width, viewportHeight: site.viewport.height,
      output: rel(OUT + `out/${s.file}.json`) },
      tasks: s.cases.map(c => ({ name: `${c.id}_${c.title}`, continueOnError: true, flow: c.flow.flatMap(st => toYamlSteps(st, { dialogs: !!site.dialogs })).map(site.yamlStep ?? (st => st)) })) };
    fs.writeFileSync(OUT + s.file + '.yaml', `# 自動生成（cases.mjs）：${s.title}\n` + yaml.dump(doc, { lineWidth: 200, noRefs: true }));
  }
  await writeSpec(OUT + '試験仕様書.xlsx', SUITES);
  const problems = validateCases(SUITES);
  if (problems.length) { console.error('ケース定義の誤り：\n  ' + problems.join('\n  ')); fail(); throw new Error(`ケース定義に ${problems.length} 件の誤りがあります`); }
  // Playwright モード用ロケーター辞書の網羅確認（未登録の指示文があると Playwright では実行できない）
  const missing = site.locators.unmapped(SUITES);
  if (missing.length) {
    console.error('ロケーター辞書に未登録：\n  ' + missing.join('\n  '));
    if (engine === 'playwright') { fail(); throw new Error(`ロケーター辞書に未登録の指示文が ${missing.length} 件あります`); }
  } else console.log(`ロケーター辞書：全指示文を解決可（${SUITES.length} スイート・${SUITES.reduce((n, s) => n + s.cases.length, 0)} ケース）`);
  if (site.design) {
    const cov = writeCoverage(OUT + '観点カバレッジ.md', site, SUITES);
    console.log(`観点カバレッジ：設計書の ${cov.total} 項目中 ${cov.covered} 項目にケースあり` + (cov.uncovered.length ? `（未対応 ${cov.uncovered.length}：${cov.uncovered.slice(0, 5).join('／')}${cov.uncovered.length > 5 ? ' ほか' : ''}）` : '')
      + (cov.unfounded.length ? `\n  設計書に根拠のない期待値 ${cov.unfounded.length} 件：${cov.unfounded.slice(0, 5).map(u => `${u.id}「${u.text}」`).join('／')}` : ''));
  }
  const pwOnly = SUITES.flatMap(s => s.cases).filter(c => c.flow.some(st => 'upload' in st || 'download' in st)).map(c => c.id);
  if (pwOnly.length && engine === 'midscene') console.log(`注意：upload / download は Midscene の YAML では実行できません（--engine ai なら AI 操作で実行できます）。該当ケース：${pwOnly.join(', ')}`);
  if (args.includes('--build-only')) return { results: [], exitCode: 0 };

  // ---------- 2. 実行 ----------
  const runsFile = OUT + 'out/runs.json';
  const runs = fs.existsSync(runsFile) ? JSON.parse(fs.readFileSync(runsFile, 'utf8')) : {};
  if (!args.includes('--eval-only')) {
    const stopApp = site.startApp ? await site.startApp() : null;
    try {
      // スイート 1 件を（必要ならやり直しつきで）実行する。print はログの出力先
      const runSuite = async (s, print) => {
        print(`\n=== ${s.file} ${s.title}`);
        const flaky = new Set();
        for (let attempt = 1; ; attempt++) {
          runs[s.file] = { ...(await runOnce(site, s, engine, { ...flags, print })), attempts: attempt };
          const stuck = evaluateSuite(site, s, runs).filter(r => r.cause === '実行不能').map(r => r.c.id);
          if (!stuck.length || attempt > flags.retries) break;
          stuck.forEach(id => flaky.add(id));
          print(`  実行不能 ${stuck.join(', ')} → スイートをやり直します（${attempt}/${flags.retries}）`);
        }
        // やり直しで通ったケースは「不安定」として結果に残す
        runs[s.file].flaky = [...flaky].filter(id => runs[s.file].tasks[id] === 'ok');
        fs.writeFileSync(runsFile, JSON.stringify(runs, null, 1));
        print(`  [${engine}] ${runs[s.file].sec}s　${runs[s.file].engine !== 'midscene' ? 'Trace' : 'レポート'}：${runs[s.file].report ? rel(runs[s.file].report) : '-'}`);
      };
      // 並列実行（--workers N）：スイートどうしがデータを共有しないサイト（site.parallel = true）で、Playwright エンジンのときだけ行う。
      // ログはスイートごとにまとめて出す
      const workers = Math.max(1, Number(opt('--workers') ?? 1));
      if (workers > 1 && !(site.parallel && inBrowser)) console.log(`--workers ${workers} は使いません（${!inBrowser ? 'playwright / ai エンジン専用' : 'site.parallel = true のサイトだけ。スイートがデータを共有すると結果が変わるため'}）。順に実行します`);
      if (workers > 1 && site.parallel && inBrowser) {
        const queue = [...suites];
        await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, async () => {
          for (let s = queue.shift(); s; s = queue.shift()) { const lines = []; await runSuite(s, l => lines.push(l)); console.log(lines.join('\n')); }
        }));
      } else for (const s of suites) await runSuite(s, console.log);
    } finally { await stopApp?.(); }
  }

  // ---------- 3. 判定・基準比較 ----------
  const results = SUITES.flatMap(s => evaluateSuite(site, s, runs));
  const baselineFile = DIR + 'baseline.json';
  if (args.includes('--update-baseline')) { saveBaseline(baselineFile, results, loadBaseline(baselineFile)); console.log(`\n基準を更新：${rel(baselineFile)}`); }
  const diff = compareBaseline(results, loadBaseline(baselineFile));
  const unexpected = results.filter(r => ['新規NG', 'NG内容の変化'].includes(r.diff) || (args.includes('--strict') && r.diff === '解消'));
  const count = v => results.filter(r => r.verdict === v).length;
  const summary = { site: site.name, date: new Date().toLocaleString('sv-SE'), total: results.length, ok: count('OK'), ng: count('NG'), blocked: count('ブロック'),
    known: diff.known, fresh: diff.fresh, changed: diff.changed, resolved: diff.resolved, flaky: results.filter(r => r.flaky).map(r => r.c.id),
    healed: results.filter(r => r.healed.length).map(r => r.c.id), visualDiff: results.filter(r => r.items.some(i => i.visual)).map(r => r.c.id), warnings: results.reduce((n, r) => n + r.items.filter(i => i.warn).length, 0),
    exitCode: unexpected.length ? 1 : 0,
    cases: results.map(r => ({ id: r.c.id, verdict: r.verdict, cause: r.cause, diff: r.diff, ng: r.ng })) };

  // ---------- 4. 出力 ----------
  const evidence = extractEvidence(OUT, SUITES, runs);
  await writeResult(OUT + '試験結果.xlsx', OUT, results, evidence);
  writeMd(OUT + '結果一覧.md', site, results, runs, summary);
  writeBugDrafts(OUT + '不具合票ドラフト.md', site, results, evidence, runs);
  writeHtml(OUT + 'report.html', site, results, evidence, runs, summary);
  writeJunit(OUT + 'out/junit.xml', site, results);
  fs.writeFileSync(OUT + 'out/summary.json', JSON.stringify(summary, null, 1));

  console.log('\n' + results.map(r => `${r.c.id}\t${r.verdict}${r.cause ? `（${r.cause}）` : ''}\t${r.diff === '一致' ? '' : `[${r.diff}] `}${r.ng.join(' / ')}${r.error && r.verdict !== 'OK' ? `　← ${r.error}` : ''}`).join('\n'));
  console.log(`\n結果：${summary.ok}/${summary.total} OK` + (summary.ng ? `、NG ${summary.ng}` : '') + (summary.blocked ? `、ブロック ${summary.blocked}` : '')
    + `　基準比：${unexpected.length ? `想定外 ${unexpected.length} 件（${unexpected.map(r => `${r.c.id} ${r.diff}`).join('、')}）` : '想定どおり'}`
    + (diff.known.length ? `、既知の NG ${diff.known.length}` : '') + (diff.resolved.length ? `、解消 ${diff.resolved.length}（${diff.resolved.join(', ')}：--update-baseline で基準を更新）` : '')
    + (summary.flaky.length ? `、不安定 ${summary.flaky.join(', ')}` : '') + (summary.healed.length ? `、AI で代替 ${summary.healed.join(', ')}` : '') + (summary.visualDiff.length ? `、見た目の違い ${summary.visualDiff.join(', ')}` : '') + (summary.warnings ? `、注意 ${summary.warnings} 件` : ''));
  console.log(`レポート：${rel(OUT + 'report.html')}`);
  if (summary.exitCode) fail();
  return { results, summary, exitCode: summary.exitCode };
}

// スイートを 1 回実行する。ログイン失敗などエンジンごと落ちた場合も記録して次のスイートへ進む
async function runOnce(site, s, engine, flags) {
  const state = site.beforeSuite ? await site.beforeSuite(s) : undefined;
  const t0 = Date.now(); let run, journal;
  try { run = engine !== 'midscene' ? await runPlaywright(site, s, { ...flags, ai: engine === 'ai' }) : await runMidscene(site, s); }
  catch (e) {
    const fatal = e.message.split('\n')[0];
    flags.print(`  ✖ スイートを実行できません：${fatal}`);
    fs.rmSync(site.out + `out/${s.file}.json`, { force: true });
    run = { report: null, tasks: Object.fromEntries(s.cases.map(c => [c.id, 'failed'])), info: Object.fromEntries(s.cases.map(c => [c.id, { error: fatal, healed: [] }])), error: [fatal], fatal };
  } finally { journal = site.afterSuite ? await Promise.resolve(site.afterSuite(s, state)).catch(() => undefined) : undefined; }
  const jFile = site.out + `out/${s.file}-journal.json`;
  if (journal !== undefined) fs.writeFileSync(jFile, JSON.stringify(journal, null, 1)); else fs.rmSync(jFile, { force: true });
  return { engine, aiAssert: engine === 'playwright' ? flags.aiAssert : true, sec: Math.round((Date.now() - t0) / 1000), ...run };
}

// スイートの出力を判定する。verdict：OK / NG / ブロック、cause（NG の分類）：不一致（不具合の候補）/ 実行不能（操作できず。画面変更か試験側の問題）
export function evaluateSuite(site, s, runs) {
  const run = runs[s.file]; if (!run) return [];
  const read = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  const o = read(site.out + `out/${s.file}.json`) ?? {};
  const ctx = { journal: read(site.out + `out/${s.file}-journal.json`) ?? site.emptyJournal ?? {} };
  const health = read(site.out + `out/${s.file}-health.json`);
  const visual = read(site.out + `out/${s.file}-visual.json`);
  const results = []; let prev = null;
  for (const c of s.cases) {
    const task = run.tasks?.[c.id] ?? '-';
    const blocked = task === 'blocked' || (!!prev && continues(c) && ['failed', 'blocked'].includes(prev.task) && task !== 'ok');
    let items;
    try { items = evaluate(c, o, ctx); } catch (e) { items = [{ desc: '判定処理', pass: false, actual: '例外：' + e.message, missing: true }]; }
    if (health && !blocked) items.push(...healthItems(health[c.id]));
    items.push(...visualItems(visual, c.id));
    const info = run.info?.[c.id] ?? {};
    for (const h of info.healed ?? []) items.push({ desc: `AI で代替操作：${h.kind}「${h.prompt}」`, auto: true, warn: true, pass: true, expected: '辞書のロケーターで操作', actual: h.error });
    const hard = items.filter(i => !i.ai && !i.warn); const failed = hard.filter(i => !i.pass); const aiItems = items.filter(i => i.ai);
    const verdict = blocked ? 'ブロック' : hard.length && !failed.length && task !== 'failed' ? 'OK' : 'NG';
    const cause = verdict !== 'NG' ? null : failed.some(i => !i.missing) ? '不一致' : '実行不能';
    const r = { suite: s, c, items, verdict, cause, task, blocked, ng: verdict === 'NG' ? failed.map(i => i.desc) : [], error: info.error ?? null, healed: info.healed ?? [], sec: info.sec ?? null,
      flaky: (run.flaky ?? []).includes(c.id), aiNg: aiItems.filter(i => !i.pass && !i.skipped).length, aiRun: aiItems.filter(i => !i.skipped).length,
      report: run.report, engine: run.engine ?? 'midscene' };
    results.push(r); prev = r;
  }
  return results;
}

// Midscene：Playwright でログインして cookie を保存→ YAML を CLI で実行し、ログとレポートからタスク結果を拾う
async function runMidscene(site, s) {
  const browser = await launch();
  try { const { context } = await site.login(browser, { viewport: site.viewport }); await saveCookies(context, site.cookieFile); }
  finally { await browser.close(); }
  // Windows の npx は npx.cmd（シェル経由でないと起動できない）
  const win = process.platform === 'win32';
  const yamlFile = path.relative(ROOT, site.out + s.file + '.yaml');
  // 非同期で起動する（同じプロセスで動かしている試験対象・スタブがあっても応答できるようにする）
  const launchCli = () => new Promise((resolve, reject) => {
    const p = spawn(win ? 'npx.cmd' : 'npx', ['midscene', win ? `"${yamlFile}"` : yamlFile], { cwd: ROOT, shell: win, env: { ...process.env, ...midsceneBrowserEnv() } });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('error', e => reject(new Error(`Midscene CLI を起動できません：${e.message}`)));
    p.on('close', () => resolve(out));
  });
  // 最初の画面を開くところで失敗し、どのケースも始まらなかった場合（net::ERR_ABORTED など起動時の一時的な失敗）は、起動からやり直す。
  // ケースが 1 件でも始まっていれば、失敗は結果として扱い、やり直さない
  let log = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const out = await launchCli();
    log += (attempt > 1 ? `\n--- 起動のやり直し ${attempt} 回目 ---\n` : '') + out;
    if (!midsceneStartupFailed(out)) { log = attempt > 1 ? log : out; break; }
  }
  fs.writeFileSync(site.out + `out/${s.file}.log`, log);
  fs.rmSync(site.out + `out/${s.file}-health.json`, { force: true });
  const summaryPath = [...log.matchAll(/Summary: (\S+\.json)/g)].pop()?.[1];
  const report = summaryPath ? path.resolve(ROOT, path.dirname(summaryPath), JSON.parse(fs.readFileSync(path.resolve(ROOT, summaryPath), 'utf8')).results[0].report) : null;
  const tasks = parseMidsceneTasks(log.split('--- 起動のやり直し').pop());
  return { report, tasks, error: [...log.matchAll(/Error: (.+)/g)].map(m => m[1]).slice(0, 5) };
}

// Midscene CLI が、どのケースの結果も出さないまま失敗で終わったか（起動時の失敗）
export function midsceneStartupFailed(log) {
  return Object.keys(parseMidsceneTasks(log)).length === 0 && /YAML execution failed|Failed: [1-9]/.test(log);
}

// Midscene CLI のログからタスク（ケース）ごとの結果を拾う。CLI は同じタスクを「◌ 実行中」→「✔ 成功／✘ 失敗」の順に出すが、
// 標準出力と標準エラーを合わせて読むと行の順序は保証されないため、順序によらず「失敗の印があれば failed、成功の印があれば ok」とする。
// どちらの印もないタスク（実行中のまま終わった・未実行）は結果に含めない（判定は記録値だけで行う）
export function parseMidsceneTasks(log) {
  const ok = new Set(); const failed = new Set();
  for (const m of log.matchAll(/^\s*(\S+)\s+([A-Z]+-\d+)_/gm)) {
    if (/^[✘✖✗×]/.test(m[1])) failed.add(m[2]);
    else if (/^[✔✓]/.test(m[1])) ok.add(m[2]);
  }
  const tasks = {};
  for (const id of ok) tasks[id] = 'ok';
  for (const id of failed) tasks[id] = 'failed';
  return tasks;
}

// Midscene CLI（puppeteer）にも Playwright と同じブラウザを使わせる：TEST_BROWSER_PATH、または同梱 Chromium（TEST_BROWSER_CHANNEL=chromium）
function midsceneBrowserEnv() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return {};
  const exe = process.env.TEST_BROWSER_PATH || (['', 'chromium'].includes(process.env.TEST_BROWSER_CHANNEL) ? bundledChromium() : '');
  return exe ? { PUPPETEER_EXECUTABLE_PATH: exe } : {};
}

// Playwright：同じ flow を固定ロケーターで実行。証跡はスクリーンショット＋Trace（npx playwright show-trace で開く）
async function runPlaywright(site, s, flags) {
  const { runSuite } = await import('./engine-playwright.mjs');
  const OUT = site.out; const lines = [];
  const r = await runSuite(s, { site, outFile: OUT + `out/${s.file}.json`, shotsDir: OUT + `out/shots/${s.file}`, traceFile: OUT + `out/${s.file}-trace.zip`,
    aiAssert: flags.aiAssert, heal: flags.heal, ai: flags.ai, visual: flags.visual, agentFactory: site.agentFactory, downloadsDir: OUT + `out/downloads/${s.file}`, log: l => { lines.push(l); flags.print(l); } });
  fs.writeFileSync(OUT + `out/${s.file}.log`, lines.concat(r.errors).join('\n') + '\n');
  const hFile = OUT + `out/${s.file}-health.json`;
  if (r.health) fs.writeFileSync(hFile, JSON.stringify(r.health, null, 1)); else fs.rmSync(hFile, { force: true });
  // 見た目の比較：基準はサイトの tests/visual-baseline/（端末ごと。初回は登録だけ行う）
  const vFile = OUT + `out/${s.file}-visual.json`;
  if (flags.visual) {
    const v = compareVisual(r.shots, { baselineDir: site.dir + 'visual-baseline', diffDir: OUT + 'out/visual', threshold: site.visual?.threshold, update: flags.updateVisual });
    fs.writeFileSync(vFile, JSON.stringify(v, null, 1));
    const n = st => v.filter(x => x.status === st).length;
    flags.print(`  見た目の比較：同じ ${n('same')}、違い ${n('changed')}` + (n('new') ? `、基準を新規登録 ${n('new')}` : '') + (n('updated') ? `、基準を更新 ${n('updated')}` : ''));
  } else fs.rmSync(vFile, { force: true });
  return { report: OUT + `out/${s.file}-trace.zip`, shots: OUT + `out/shots/${s.file}/manifest.json`, tasks: r.tasks, info: r.info, error: r.errors.slice(0, 5) };
}

// recordToReport の画面を evidence/ へ保存する（Midscene：レポート HTML から抽出／Playwright：撮影済みの jpg を複写）
function extractEvidence(OUT, SUITES, runs) {
  const ev = {}; const dirE = OUT + 'evidence/'; fs.rmSync(dirE, { recursive: true, force: true }); fs.mkdirSync(dirE, { recursive: true });
  for (const s of SUITES) {
    if (runs[s.file] && runs[s.file].engine !== 'midscene') {
      const mf = runs[s.file].shots; if (!mf || !fs.existsSync(mf)) continue;
      for (const { caseId, label, file: src } of JSON.parse(fs.readFileSync(mf, 'utf8'))) {
        if (!fs.existsSync(src)) continue;
        const file = 'evidence/' + path.basename(src); fs.copyFileSync(src, OUT + file); (ev[caseId] ??= []).push({ label, file });
      }
      // 見た目の比較で違いがあった画面は、差分の画像も証跡に加える
      const vFile = OUT + `out/${s.file}-visual.json`;
      for (const v of fs.existsSync(vFile) ? JSON.parse(fs.readFileSync(vFile, 'utf8')) : []) {
        if (!v.diff || !fs.existsSync(v.diff)) continue;
        const file = 'evidence/' + path.basename(v.diff); fs.copyFileSync(v.diff, OUT + file); (ev[v.caseId] ??= []).push({ label: `見た目の差分：${v.label}`, file });
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
      fs.writeFileSync(OUT + file, Buffer.from(img, 'base64')); ev[caseId].push({ label, file });
    }
  }
  return ev;
}
