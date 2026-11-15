// モデルの評価：設定したモデルが、このサイトの画面で指示文どおりの要素を見つけられるかを測る。
//   node core/model-eval.mjs sites/<name>/tests/site.mjs [--max 30] [--per-page 10] [--dry-run] [--out <dir>]
//
// AI 操作（--engine ai / midscene・--heal）を使う前に、「このモデルは自分たちの画面でどのくらい当たるか」を数字で確かめるためのもの。
// 画面採取（core/explore.mjs）の inventory.json にある指示文候補のうち、辞書で 1 要素に解決できたものを問題にする。
//   正解：辞書（site.locators）が解決した要素の位置
//   回答：Midscene の aiLocate（.env の MIDSCENE_MODEL_* のモデルが、画面の画像だけを見て答えた位置）
//   判定：回答の中心が正解の要素の中に入っていれば命中（クリックすればその要素に当たる）
// 画面は開くだけで、クリックや入力はしない（データは変わらない）。
// 出力：<inventory>/モデル評価.md・model-eval.json。--dry-run はモデルを呼ばず、問題の一覧と各画面の画像（model-eval-shots/）だけを出す。
import fs from 'fs'; import path from 'path'; import { pathToFileURL, fileURLToPath } from 'url';
import { launch } from './browser.mjs';
import { rel } from './paths.mjs';

const TOLERANCE = 3; // 要素の縁からこの px 以内なら命中とみなす

export async function evaluateModel(site, { inventory, max = 30, perPage = 10, dryRun = false, outDir, agentFactory = defaultAgent, log = console.log } = {}) {
  const stopApp = site.startApp ? await site.startApp() : null;
  const browser = await launch();
  const rows = []; const shots = [];
  try {
    const { page } = await site.login(browser, { viewport: site.viewport });
    let agent = null; // 最初の画面を開いてから作る（遷移の途中で作ると Midscene が警告を出す）
    const seen = new Set();
    for (const [i, inv] of inventory.entries()) {
      if (rows.length >= max) break;
      // 同じ指示文（どの画面にもあるログアウトなど）は最初の画面でだけ問う
      const prompts = inv.prompts.filter(p => p.ok && (p.kind === 'aiTap' || p.kind === 'aiInput') && !seen.has(p.prompt)).slice(0, Math.min(perPage, max - rows.length));
      if (!prompts.length) continue;
      const flow = inv.via && site.explore?.flows?.find(f => f.name === inv.via);
      if (inv.via && !flow) continue;
      if (flow) await flow.run(page); else await page.goto(new URL(inv.url, site.url).href);
      await page.waitForLoadState('networkidle').catch(() => {});
      const screen = inv.h1 ?? inv.title ?? inv.url;
      if (!dryRun) agent ??= await agentFactory(page);
      if (outDir) { const f = path.join(outDir, 'model-eval-shots', `${String(i + 1).padStart(2, '0')}.png`); fs.mkdirSync(path.dirname(f), { recursive: true }); await page.screenshot({ path: f }); shots.push({ screen, file: f }); }
      for (const p of prompts) {
        seen.add(p.prompt);
        const box = await site.locators.resolve(p.kind, p.prompt, page).boundingBox().catch(() => null);
        if (!box) continue; // 画面外・非表示で位置が取れないものは問題にしない
        const row = { screen, kind: p.kind, prompt: p.prompt, box: [box.x, box.y, box.width, box.height].map(Math.round) };
        if (!dryRun) {
          const t0 = Date.now();
          try {
            const r = await agent.aiLocate(p.prompt);
            const [x, y] = Array.isArray(r.center) ? r.center : [r.center.x, r.center.y];
            row.answer = [Math.round(x), Math.round(y)];
            row.hit = x >= box.x - TOLERANCE && x <= box.x + box.width + TOLERANCE && y >= box.y - TOLERANCE && y <= box.y + box.height + TOLERANCE;
            // 外れたときの目安：正解の要素の中心からの距離
            if (!row.hit) row.off = Math.round(Math.hypot(x - (box.x + box.width / 2), y - (box.y + box.height / 2)));
          } catch (e) { row.hit = false; row.error = e.message.split('\n').filter(Boolean).slice(0, 2).join(' ').slice(0, 160); }
          row.ms = Date.now() - t0;
          log(`  ${row.hit ? '✔' : '✖'} ${screen}：${p.prompt}${row.hit ? '' : `　← ${row.error ?? `中心から ${row.off}px`}`}`);
        }
        rows.push(row);
      }
    }
  } finally { await browser.close(); await stopApp?.(); }
  const hits = rows.filter(r => r.hit).length;
  return { model: process.env.MIDSCENE_MODEL_NAME ?? null, family: process.env.MIDSCENE_MODEL_FAMILY ?? null, date: new Date().toLocaleString('sv-SE'), total: rows.length, hits,
    rate: rows.length && !dryRun ? Math.round(hits * 1000 / rows.length) / 10 : null, dryRun, rows, shots };
}

async function defaultAgent(page) {
  const { PlaywrightAgent } = await import('@midscene/web/playwright');
  return new PlaywrightAgent(page, { generateReport: false, forceSameTabNavigation: false });
}

export function toMarkdown(site, r) {
  const by = k => { const list = r.rows.filter(x => x.kind === k); return `${list.filter(x => x.hit).length}/${list.length}`; };
  const L = ['# モデル評価（自動生成）', '', `対象：${site.url}　実施：${r.date}`, `モデル：${r.model}（family：${r.family}）`, '',
    `- 命中率：**${r.rate}%**（${r.hits}/${r.total}）　クリック対象（aiTap）${by('aiTap')}、入力欄（aiInput）${by('aiInput')}`,
    `- 判定：モデルが答えた位置の中心が、辞書で特定した正解の要素の中（縁から ${TOLERANCE}px 以内）なら命中`, '',
    '> 命中率が高ければ、AI 操作（--engine ai・--heal）をこのサイトで使える見込みがある。外れた指示文は、言い回しを変えるか、辞書（Playwright エンジン）で操作する。', ''];
  const miss = r.rows.filter(x => !x.hit);
  if (miss.length) L.push('## 外れた指示文', '', '| 画面 | 指示文 | 正解の要素 [x, y, 幅, 高さ] | モデルの回答 | 備考 |', '|---|---|---|---|---|',
    ...miss.map(x => `| ${x.screen} | ${x.prompt} | ${JSON.stringify(x.box)} | ${x.answer ? JSON.stringify(x.answer) : '-'} | ${x.error ?? `中心から ${x.off}px`} |`), '');
  L.push('## 全問', '', '| 画面 | 種別 | 指示文 | 結果 | 正解の要素 | 回答の中心 | 時間 |', '|---|---|---|---|---|---|---|',
    ...r.rows.map(x => `| ${x.screen} | ${x.kind} | ${x.prompt} | ${x.hit ? '命中' : '**外れ**'} | ${JSON.stringify(x.box)} | ${x.answer ? JSON.stringify(x.answer) : '-'} | ${(x.ms / 1000).toFixed(1)}s |`), '');
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, d) => args.includes(name) ? args[args.indexOf(name) + 1] : d;
  const siteFile = path.resolve(args[0] ?? '');
  if (!args[0] || !fs.existsSync(siteFile)) { console.error('使い方：node core/model-eval.mjs sites/<name>/tests/site.mjs [--max 30] [--per-page 10] [--dry-run] [--out <dir>]'); process.exit(1); }
  const site = (await import(pathToFileURL(siteFile).href)).default;
  const outDir = path.resolve(opt('--out', path.join(path.dirname(siteFile), 'inventory')));
  const invFile = path.join(path.dirname(siteFile), 'inventory', 'inventory.json');
  if (!fs.existsSync(invFile)) { console.error(`画面採取の結果がありません。先に node core/explore.mjs ${args[0]} を実行してください`); process.exit(1); }
  const dryRun = args.includes('--dry-run');
  if (!dryRun && !process.env.MIDSCENE_MODEL_BASE_URL) { console.error('モデルが設定されていません。.env に MIDSCENE_MODEL_BASE_URL / _API_KEY / _NAME / _FAMILY を設定してください（問題の一覧だけなら --dry-run）'); process.exit(1); }
  const r = await evaluateModel(site, { inventory: JSON.parse(fs.readFileSync(invFile, 'utf8')), max: Number(opt('--max', 30)), perPage: Number(opt('--per-page', 10)), dryRun, outDir });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'model-eval.json'), JSON.stringify(r, null, 1));
  if (dryRun) console.log(`問題 ${r.total} 件（モデルは呼んでいません）→ ${rel(path.join(outDir, 'model-eval.json'))}、画面：${rel(path.join(outDir, 'model-eval-shots'))}`);
  else { fs.writeFileSync(path.join(outDir, 'モデル評価.md'), toMarkdown(site, r)); console.log(`\n命中率 ${r.rate}%（${r.hits}/${r.total}）　モデル：${r.model} → ${rel(path.join(outDir, 'モデル評価.md'))}`); }
}
