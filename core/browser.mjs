// ブラウザ起動・cookie 保存（全サイト共通）
import dotenv from 'dotenv';
import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';
import { ROOT } from './paths.mjs';
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true }); // 実行ディレクトリによらずリポジトリ直下の .env

// 起動するブラウザの決め方（上から順）
//   TEST_BROWSER_PATH     実行ファイルを直接指定（社内配布の Chrome・CI のキャッシュ済み Chromium など）
//   TEST_BROWSER_CHANNEL  chrome / msedge / chromium（Playwright 同梱の Chromium。空文字でも同じ）
//   どちらも未設定        chrome → msedge → 同梱 Chromium の順に、起動できたものを使う
// TEST_HEADED=1 で画面表示。
let announced = false;
export async function launch({ headless = process.env.TEST_HEADED !== '1' } = {}) {
  const exe = process.env.TEST_BROWSER_PATH;
  if (exe) return chromium.launch({ headless, executablePath: exe });
  const set = process.env.TEST_BROWSER_CHANNEL;
  // 「chromium」は同梱 Chromium の別名（Windows では空文字の環境変数を設定できないため）
  const candidates = set !== undefined ? [set === 'chromium' ? '' : set] : ['chrome', 'msedge', ''];
  let lastError;
  for (const channel of candidates) {
    try {
      const b = await chromium.launch({ headless, ...(channel ? { channel } : {}) });
      if (!announced && channel !== candidates[0]) console.log(`ブラウザ：${channel || 'Playwright 同梱 Chromium'}（${candidates[0]} は起動できず）`);
      announced = true;
      return b;
    } catch (e) { lastError = e; }
  }
  throw new Error(`ブラウザを起動できません（試行：${candidates.map(c => c || '同梱 Chromium').join(' → ')}）。` +
    `.env の TEST_BROWSER_CHANNEL / TEST_BROWSER_PATH を確認するか、npx playwright install chromium を実行してください。\n${lastError?.message.split('\n')[0]}`);
}

// Midscene の web.cookie 形式（puppeteer の cookie 配列）で保存する
export async function saveCookies(context, file) {
  const cookies = (await context.cookies()).map(c => ({ ...c, size: c.name.length + c.value.length, session: c.expires === -1 }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cookies, null, 1));
  return cookies;
}
