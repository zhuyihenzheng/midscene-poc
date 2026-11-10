// エージェントをモデルにする中継サーバー（core/agent-model.mjs）の試験。
// Midscene はモデルの設定をプロセス内で 1 回だけ読むため、模型サーバーを使う ai.test.mjs とは別のファイル（別プロセス）にしてある。
import test, { before, after } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { startAgentModel, parseRequest, formatAnswer, imageSize } from '../core/agent-model.mjs';
import { launch } from '../core/browser.mjs';
import { startFixture } from './fixture/site.mjs';

let fx;
before(async () => { fx = await startFixture(); });
after(async () => { await fx.close(); });

test('エージェントをモデルにする中継：Midscene の要求と画面を書き出し、書かれた答えで Midscene が実際にクリックする', async () => {
  // 応答形式の変換
  const size = { width: 1000, height: 700 };
  assert.equal(formatAnswer({ type: 'locate' }, { bbox: [100, 220, 220, 260] }, size), '{"bbox_2d":[100,314,220,371]}');
  assert.equal(formatAnswer({ type: 'locate' }, { bbox: null, reason: 'no such button' }, size), '{"bbox_2d":[],"error":"no such button"}');
  assert.match(formatAnswer({ type: 'assert' }, { ok: false, reason: 'not shown' }, size), /<observation>not shown<\/observation>[\s\S]*"StatementIsTruthy": false/);
  assert.deepEqual(parseRequest(JSON.stringify({ messages: [{ role: 'system', content: 'return bbox_2d' }, { role: 'user', content: [{ type: 'text', text: 'Find: 「登録」ボタン' }] }] })).prompt, '「登録」ボタン');

  // 本物の Midscene エージェントを中継サーバーにつなぎ、答える役（ここでは試験コード）が ans-N.json を書く
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-model-'));
  const bridge = await startAgentModel({ port: 0, dir, poll: 50, log: () => {} });
  const saved = { ...process.env };
  Object.assign(process.env, bridge.env);
  const seen = [];
  const answerer = setInterval(() => {
    for (const f of fs.readdirSync(bridge.dir).filter(f => /^req-\d+\.json$/.test(f))) {
      const ans = path.join(bridge.dir, f.replace('req', 'ans')); if (fs.existsSync(ans)) continue;
      const req = JSON.parse(fs.readFileSync(path.join(bridge.dir, f), 'utf8'));
      seen.push(req);
      // 画面（/renamed）の「登録」ボタンは left:100 top:220 幅 120 高さ 40
      fs.writeFileSync(ans, JSON.stringify(req.type === 'locate' ? { bbox: [100, 220, 220, 260] } : { ok: true }));
    }
  }, 50);
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto(fx.url + 'renamed');
    const { PlaywrightAgent } = await import('@midscene/web/playwright');
    const agent = new PlaywrightAgent(page, { generateReport: false });
    await agent.aiTap('「登録」ボタン');
    await page.waitForURL(/\/saved/);
    const verdict = await agent.aiAssert('「保存しました。」と表示されている', undefined, { keepRawResponse: true });
    assert.equal(verdict.pass, true);
  } finally {
    clearInterval(answerer); await browser.close(); await bridge.close();
    for (const k of Object.keys(bridge.env)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
  }
  assert.deepEqual(seen.map(r => r.type), ['locate', 'assert']);
  assert.equal(seen[0].prompt, '「登録」ボタン');
  // 要求には、答える側が見るための画面（画像）と大きさが付いている
  const img = fs.readFileSync(path.join(bridge.dir, seen[0].image));
  assert.deepEqual([seen[0].width, seen[0].height], [imageSize(img).width, imageSize(img).height]);
  assert.ok(seen[0].width >= 1000 && img.length > 1000);
});
