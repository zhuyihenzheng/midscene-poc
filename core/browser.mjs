// ブラウザ起動・cookie 保存（全サイト共通）
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url).pathname }); // 実行ディレクトリによらずリポジトリ直下の .env
import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';

// 既定はインストール済みの Google Chrome（社内 PC で Playwright のブラウザ取得が不要）。
// TEST_BROWSER_CHANNEL=msedge で Edge、空文字で Playwright 同梱の Chromium。TEST_HEADED=1 で画面表示。
export async function launch({ headless = process.env.TEST_HEADED !== '1' } = {}) {
  const channel = process.env.TEST_BROWSER_CHANNEL ?? 'chrome';
  return chromium.launch({ headless, ...(channel ? { channel } : {}) });
}

// Midscene の web.cookie 形式（puppeteer の cookie 配列）で保存する
export async function saveCookies(context, file) {
  const cookies = (await context.cookies()).map(c => ({ ...c, size: c.name.length + c.value.length, session: c.expires === -1 }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cookies, null, 1));
  return cookies;
}
