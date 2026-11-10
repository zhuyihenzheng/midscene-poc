// Playwright エンジン（全サイト共通）：cases.mjs の flow（Midscene YAML と同じステップ）をモデルなしで実行する
// - goto → page.goto（site.url からの相対パス）
// - javascript → page.evaluate（name 付きは Midscene と同じ { name: 値 } 形式で出力 JSON へ）
// - aiTap / aiHover / aiInput / aiWaitFor → サイトのロケーター辞書（site.locators）で固定ロケーターに解決
//   aiInput の対象が select なら表示名で選択、aiKeyboardPress はキー入力
// - aiAssert → 既定は未実施（skipped）。aiAssert:true のときだけ Midscene の PlaywrightAgent で AI 判定（要モデル）
// - upload → ファイル選択欄にファイルを設定／download → クリックしてダウンロードを待ち、ファイル名・大きさ・内容（テキストの場合）を記録
// - 別ウィンドウ（window.open・target=_blank）が開いたら、以降のステップはそのウィンドウに対して行い、閉じたら元のウィンドウへ戻る
// - recordToReport → スクリーンショット（manifest に記録し、runner が evidence/ へ取り込む）。visual:true なら見た目の比較用の PNG も撮る
// ケースは 1 ページ上で順に実行する（前ケースの画面を引き継ぐケースがあるため）。失敗したケースは以降のステップを打ち切り、
// その画面を引き継ぐ後続ケース（flow が goto で始まらないケース）は「ブロック」として実行しない。
// heal:true（要モデル）のとき、辞書で操作できなかったステップを AI で代替し、辞書の修正候補として記録する。
import fs from 'fs'; import path from 'path';
import { launch } from './browser.mjs';
import { continues, DIALOG_HOOK } from './steps.mjs';
import { watch } from './health.mjs';

const DEFAULT_TIMEOUT = 15000;

// site：{ url, viewport, login(browser, { viewport }) → { context, page }, locators: { resolve }, settle?, health? }
// viewport は Midscene 版と同じにする（枠内表示・スクロール系の判定が画面サイズに依存するため）
export async function runSuite(suite, { site, outFile, shotsDir, traceFile, downloadsDir = path.join(shotsDir, 'downloads'), aiAssert = false, heal = false, visual = false, agentFactory = aiAgent, log = console.log }) {
  const browser = await launch();
  const out = {}; const tasks = {}; const errors = []; const shots = []; const info = {};
  let health = null;
  fs.rmSync(shotsDir, { recursive: true, force: true }); fs.mkdirSync(shotsDir, { recursive: true });
  try {
    const { context, page } = await site.login(browser, { viewport: site.viewport });
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    await context.tracing.start({ screenshots: true, snapshots: true, title: suite.file });
    const agent = aiAssert || heal ? await agentFactory(page) : null;
    const monitor = watch(page, site);
    // ダイアログ：site.dialogs = true なら記録用の差し替えを全ページに入れる。無効のときは OK で閉じ、自動検査の注意に残す
    const onDialog = p => p.on('dialog', d => { monitor.note('warn', '想定外のダイアログ', `${d.type()}：${d.message()}（site.dialogs = true で記録・判定できる）`); d.accept().catch(() => {}); });
    if (site.dialogs) { await context.addInitScript(DIALOG_HOOK); await page.evaluate(DIALOG_HOOK).catch(() => {}); }
    else onDialog(page);
    // 操作対象のウィンドウ：最後に開いたもの。閉じたら 1 つ前へ戻る
    const pages = [page];
    // 閉じた直後は close イベントの処理より先に次のステップへ進むことがあるため、閉じたウィンドウは飛ばす
    const current = () => pages.findLast(p => !p.isClosed()) ?? pages[0];
    context.on('page', p => {
      pages.push(p); p.setDefaultTimeout(DEFAULT_TIMEOUT); monitor.attach(p); if (!site.dialogs) onDialog(p);
      p.on('close', () => { const i = pages.indexOf(p); if (i > 0) pages.splice(i, 1); });
    });
    const ctx = { site, out, shots, shotsDir, downloadsDir, pages, agent, aiAssert, heal, visual, monitor, resolve: site.locators.resolve, settle: site.settle ?? settle };
    let prev = null;
    for (const c of suite.cases) {
      const t0 = Date.now(); const ci = (info[c.id] = { healed: [] });
      if (prev && continues(c) && tasks[prev.id] !== 'ok') {
        tasks[c.id] = 'blocked'; ci.error = `${prev.id} が中断したため未実行`;
        log(`  － ${c.id}_${c.title}（ブロック：${prev.id} の続き）`);
        prev = c; continue;
      }
      monitor.setCase(c.id);
      try {
        for (const st of c.flow) await step(current(), st, { ...ctx, c, ci });
        await monitor.lint(current());
        tasks[c.id] = 'ok';
      } catch (e) {
        tasks[c.id] = 'failed'; ci.error = e.message.split('\n')[0];
        errors.push(`${c.id}: ${ci.error}`);
        await monitor.lint(current());
        await shot(current(), `${c.id} 失敗時の画面`, { ...ctx, visual: false }).catch(() => {});
      }
      monitor.setCase(null);
      ci.sec = +((Date.now() - t0) / 1000).toFixed(1);
      log(`  ${tasks[c.id] === 'ok' ? '✔' : '✖'} ${c.id}_${c.title}（${ci.sec}s）${ci.healed.length ? `　※AI で代替 ${ci.healed.length} 件` : ''}`);
      prev = c;
    }
    health = monitor.result();
    await context.tracing.stop({ path: traceFile });
  } finally { await browser.close(); }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(shotsDir, 'manifest.json'), JSON.stringify(shots, null, 1));
  return { tasks, errors, shots, info, health };
}

async function step(page, st, ctx) {
  const timeout = st.timeout ?? DEFAULT_TIMEOUT;
  if ('goto' in st) {
    // 独立したケースの開始：前のケースが開いたままにした別ウィンドウを閉じ、元のウィンドウで開く
    for (const p of ctx.pages.slice(1)) if (!p.isClosed()) await p.close().catch(() => {});
    page = ctx.pages[0];
    await page.goto(new URL(st.goto, ctx.site.url).href, { waitUntil: 'domcontentloaded', timeout });
    return ctx.settle(page);
  }
  if ('javascript' in st) {
    const v = await page.evaluate(st.javascript);
    if (st.name) ctx.out[st.name] = v ?? null;
    return;
  }
  if ('sleep' in st) return page.waitForTimeout(st.sleep);
  if ('aiKeyboardPress' in st) { await page.keyboard.press(st.aiKeyboardPress); return ctx.settle(page); }
  for (const kind of ['aiTap', 'aiHover', 'aiInput', 'aiWaitFor']) {
    if (!(kind in st)) continue;
    try { await operate(page, kind, st, timeout, ctx); }
    catch (e) {
      // AI での代替（--heal）：辞書のロケーターが画面の変更で外れた場合も試験を止めず、修正候補として記録する
      if (!ctx.heal || !ctx.agent) throw e;
      if (kind === 'aiTap') await ctx.agent.aiTap(st.aiTap);
      else if (kind === 'aiHover') await ctx.agent.aiHover(st.aiHover);
      else if (kind === 'aiInput') await ctx.agent.aiInput(st.aiInput, { value: String(st.value) });
      else await ctx.agent.aiWaitFor(st.aiWaitFor, { timeoutMs: timeout });
      ctx.ci.healed.push({ kind, prompt: st[kind], error: e.message.split('\n')[0] });
    }
    // クリックで別ウィンドウが開いた場合は、そのウィンドウの読み込みを待つ
    if (kind === 'aiTap') { await page.waitForTimeout(50).catch(() => {}); const top = ctx.pages.findLast(p => !p.isClosed()) ?? ctx.pages[0]; if (top !== page) return ctx.settle(top); }
    return ctx.settle(page);
  }
  if ('upload' in st) {
    const target = ctx.resolve('aiInput', st.upload, page);
    await target.setInputFiles([].concat(st.file).map(f => path.resolve(ctx.site.dir, f)), { timeout });
    return ctx.settle(page);
  }
  if ('download' in st) {
    const target = ctx.resolve('aiTap', st.download, page);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), target.click({ timeout })]);
    fs.mkdirSync(ctx.downloadsDir, { recursive: true });
    const file = path.join(ctx.downloadsDir, `${ctx.c.id}_${dl.suggestedFilename().replace(/[\\/:*?"<>|]+/g, '_')}`);
    await dl.saveAs(file);
    const buf = fs.readFileSync(file);
    // テキストとして読める小さなファイル（CSV など）は内容も記録する。BOM は除く
    const text = buf.length <= 200000 && !buf.subarray(0, 4000).includes(0) ? buf.toString('utf8').replace(/^\uFEFF/, '') : null;
    if (st.name) ctx.out[st.name] = { filename: dl.suggestedFilename(), size: buf.length, text, lines: text === null ? null : text.split(/\r?\n/).filter(l => l !== '') };
    return;
  }
  if ('aiAssert' in st) {
    if (!st.name) return;
    ctx.out[st.name] = ctx.aiAssert && ctx.agent ? await ctx.agent.aiAssert(st.aiAssert, undefined, { keepRawResponse: true })
      : { pass: null, skipped: true, thought: 'Playwright モード：AI 判定は未実施' };
    return;
  }
  if ('recordToReport' in st) { await ctx.monitor.lint(page); return shot(page, st.recordToReport, ctx); }
  throw new Error('未対応のステップ：' + JSON.stringify(st).slice(0, 120));
}

async function operate(page, kind, st, timeout, ctx) {
  const target = ctx.resolve(kind === 'aiHover' ? 'aiTap' : kind, st[kind], page);
  if (kind === 'aiWaitFor') {
    if (typeof target === 'function') await page.waitForFunction(target, null, { timeout });
    else if (typeof target.waitFor === 'function') await target.waitFor({ state: 'visible', timeout });
    else await target.locator.waitFor({ state: target.state ?? 'visible', timeout }); // { locator, state }：消えるまで待つ等
    return;
  }
  await target.scrollIntoViewIfNeeded({ timeout });
  if (kind === 'aiTap') return target.click({ timeout });
  if (kind === 'aiHover') return target.hover({ timeout });
  if (await target.evaluate(e => e.tagName === 'SELECT', null, { timeout })) return target.selectOption({ label: String(st.value) }, { timeout });
  // 利用者の入力と同じく 1 文字ずつ打鍵する（maxlength・入力時の変換処理も実画面どおりに効く）
  await target.fill('', { timeout });
  await target.pressSequentially(String(st.value), { timeout });
}

// クリック・入力後、画面遷移と部分更新（HTMX 等）が落ち着くまで待つ。サイト固有の待ちは site.settle(page) で差し替える
async function settle(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.htmx-request, .htmx-swapping, .htmx-settling'), null, { timeout: 5000 }).catch(() => {});
}

// Midscene の recordToReport と同じく「その時点の画面（ビューポート）」を撮る
// visual:true のときは比較用に PNG も撮る（アニメーションを止め、site.visual.mask の要素を塗りつぶす）
async function shot(page, label, { shots, shotsDir, visual, site }) {
  const caseId = label.split(' ')[0];
  const n = shots.filter(s => s.caseId === caseId).length + 1;
  const file = path.join(shotsDir, `${caseId}_${n}_${label.slice(caseId.length).trim().replace(/[\\/:*?"<>|（）() ]+/g, '_')}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
  const entry = { caseId, label, file };
  if (visual) {
    entry.png = file.replace(/\.jpg$/, '.png');
    await page.screenshot({ path: entry.png, type: 'png', animations: 'disabled', caret: 'hide', mask: (site.visual?.mask ?? []).map(sel => page.locator(sel)) });
  }
  shots.push(entry);
}

// aiAssert の AI 判定・--heal の代替操作に使う Midscene エージェント。.env の MIDSCENE_MODEL_* を使用
async function aiAgent(page) {
  const { PlaywrightAgent } = await import('@midscene/web/playwright');
  return new PlaywrightAgent(page, { generateReport: true, groupName: 'playwright-ai' });
}
