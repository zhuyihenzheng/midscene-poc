// Playwright エンジン（全サイト共通）：cases.mjs の flow（Midscene YAML と同じステップ）をモデルなしで実行する
// - javascript → page.evaluate（name 付きは Midscene と同じ { name: 値 } 形式で出力 JSON へ）
// - aiTap / aiInput / aiWaitFor → サイトのロケーター辞書（site.locators）で固定ロケーターに解決
// - aiAssert → 既定は未実施（skipped）。aiAssert:true のときだけ Midscene の PlaywrightAgent で AI 判定（要モデル）
// - recordToReport → スクリーンショット（manifest に記録し、run.mjs が evidence/ へ取り込む）
// ケースは Midscene と同様に 1 ページ上で順に実行し（前ケースの画面状態を引き継ぐケースがあるため）、失敗したケースは
// 以降のステップを打ち切って次のケースへ進む（continueOnError と同じ）。
import fs from 'fs'; import path from 'path';
import { launch } from './browser.mjs';

const DEFAULT_TIMEOUT = 15000;

// site：{ viewport, login(browser, { viewport }) → { context, page }, locators: { resolve } }
// viewport は Midscene 版と同じにする（枠内表示・スクロール系の判定が画面サイズに依存するため）
export async function runSuite(suite, { site, outFile, shotsDir, traceFile, aiAssert = false, log = console.log }) {
  const resolve = site.locators.resolve;
  const browser = await launch();
  const out = {}; const tasks = {}; const errors = []; const shots = [];
  fs.rmSync(shotsDir, { recursive: true, force: true }); fs.mkdirSync(shotsDir, { recursive: true });
  try {
    const { context, page } = await site.login(browser, { viewport: site.viewport });
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    await context.tracing.start({ screenshots: true, snapshots: true, title: suite.file });
    const agent = aiAssert ? await aiAgent(page) : null;
    for (const c of suite.cases) {
      const t0 = Date.now();
      try {
        for (const [i, st] of c.flow.entries()) await step(page, st, { c, i, out, shots, shotsDir, agent, resolve });
        tasks[c.id] = 'ok';
      } catch (e) {
        tasks[c.id] = 'failed';
        errors.push(`${c.id}: ${e.message.split('\n')[0]}`);
        await shot(page, `${c.id} 失敗時の画面`, { shots, shotsDir }).catch(() => {});
      }
      log(`  ${tasks[c.id] === 'ok' ? '✔' : '✖'} ${c.id}_${c.title}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    }
    await context.tracing.stop({ path: traceFile });
  } finally { await browser.close(); }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(shotsDir, 'manifest.json'), JSON.stringify(shots, null, 1));
  return { tasks, errors, shots };
}

async function step(page, st, ctx) {
  const timeout = st.timeout ?? DEFAULT_TIMEOUT;
  if ('javascript' in st) {
    const v = await page.evaluate(st.javascript);
    if (st.name) ctx.out[st.name] = v ?? null;
    // location.href を setTimeout で切り替えるスクリプト（JS.menu / JS.go）は直後の sleep・待機で遷移を待つ
    return;
  }
  if ('sleep' in st) return page.waitForTimeout(st.sleep);
  if ('aiTap' in st) {
    const l = ctx.resolve('aiTap', st.aiTap, page);
    await l.scrollIntoViewIfNeeded({ timeout });
    await l.click({ timeout });
    return settle(page);
  }
  if ('aiInput' in st) {
    const l = ctx.resolve('aiInput', st.aiInput, page);
    // 利用者の入力と同じく 1 文字ずつ打鍵する（maxlength・入力時の変換処理も実画面どおりに効く）
    await l.fill('', { timeout });
    await l.pressSequentially(String(st.value), { timeout });
    return settle(page);
  }
  if ('aiWaitFor' in st) {
    const w = ctx.resolve('aiWaitFor', st.aiWaitFor, page);
    if (typeof w === 'function') await page.waitForFunction(w, null, { timeout });
    else await w.waitFor({ state: 'visible', timeout });
    return settle(page);
  }
  if ('aiAssert' in st) {
    if (!st.name) return;
    ctx.out[st.name] = ctx.agent ? await ctx.agent.aiAssert(st.aiAssert, undefined, { keepRawResponse: true })
      : { pass: null, skipped: true, thought: 'Playwright モード：AI 判定は未実施' };
    return;
  }
  if ('recordToReport' in st) return shot(page, st.recordToReport, ctx);
  throw new Error('未対応のステップ：' + JSON.stringify(st).slice(0, 120));
}

// クリック・入力後、HTMX の部分更新と画面遷移が落ち着くまで待つ（AI 版は推論時間が実質の待ちになっていた）
async function settle(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.htmx-request, .htmx-swapping, .htmx-settling'), null, { timeout: 5000 }).catch(() => {});
}

// Midscene の recordToReport と同じく「その時点の画面（ビューポート）」を撮る
async function shot(page, label, { shots, shotsDir }) {
  const caseId = label.split(' ')[0];
  const n = shots.filter(s => s.caseId === caseId).length + 1;
  const file = path.join(shotsDir, `${caseId}_${n}_${label.slice(caseId.length).trim().replace(/[\\/:*?"<>|（）() ]+/g, '_')}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
  shots.push({ caseId, label, file });
}

// 任意：aiAssert だけ AI で判定する（Playwright 操作＋AI 目視の併用）。.env の MIDSCENE_MODEL_* を使用
async function aiAgent(page) {
  const { PlaywrightAgent } = await import('@midscene/web/playwright');
  return new PlaywrightAgent(page, { generateReport: true, groupName: 'playwright-ai-assert' });
}
