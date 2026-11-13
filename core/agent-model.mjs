// エージェントをモデルにする中継サーバー：Midscene のモデル呼び出しを、Claude Code や GitHub Copilot などの
// コーディングエージェント（または人）が画面を見て答えられる形に変える。モデルの API キーがなくても、
// Midscene エンジン・--heal・--ai-assert を本物の視覚モデル（エージェント自身）で動かせる。
//
//   node core/agent-model.mjs [--port 8765] [--dir .agent-model]
//
// 1. このサーバーを起動し、表示された 4 つの環境変数を設定して試験を実行する（別の端末、またはバックグラウンド）
// 2. Midscene から要求が来るたびに <dir>/req-N.json と req-N.png（その時点の画面）ができる
//      { "type": "locate", "prompt": "「確認」ボタン", "image": "req-N.png", "width": 1280, "height": 1000 }
//      { "type": "assert", "statement": "「マイページ」画面が表示されている", "image": "req-N.png", ... }
// 3. 画面を見て <dir>/ans-N.json を書くと、Midscene に応答が返り、試験が先へ進む
//      locate → { "bbox": [左, 上, 右, 下] }（画像上の px。見つからなければ { "bbox": null, "reason": "…" }）
//      assert → { "ok": true }（成り立たなければ { "ok": false, "reason": "…" }）
//
// 1 回の応答に人手やエージェントの時間がかかるため、待ち時間の指定（aiWaitFor の timeout）は長めにする。
// 毎回の定期実行には向かない（それは Playwright エンジンの役目）。向いているのは、辞書を作る前の初回の画面確認、
// --heal での辞書の修正候補集め、aiAssert の目視確認を API なしで行う場合。
import fs from 'fs'; import http from 'http'; import path from 'path';
import { fileURLToPath } from 'url';

// PNG / JPEG の大きさ（px）を読む
export function imageSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  for (let i = 2; i < buf.length;) { const m = buf[i + 1], len = buf.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }; i += 2 + len; }
  return { width: 0, height: 0 };
}

// Midscene の要求（OpenAI 互換の chat/completions の本文）を、答える側に見せる形へ変換する
export function parseRequest(body) {
  const j = JSON.parse(body || '{}');
  const parts = role => (j.messages ?? []).filter(m => m.role === role).flatMap(m => typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content);
  const text = role => parts(role).filter(c => c.type === 'text').map(c => c.text).join('\n');
  const system = text('system'); const user = text('user');
  const url = parts('user').filter(c => c.type === 'image_url').map(c => c.image_url?.url).pop() ?? '';
  const m = url.match(/^data:image\/(\w+);base64,(.+)$/s);
  const image = m ? { ext: m[1] === 'jpeg' ? 'jpg' : m[1], data: Buffer.from(m[2], 'base64') } : null;
  if (system.includes('bbox_2d')) return { model: j.model, type: 'locate', prompt: user.match(/Find: (.+)/)?.[1]?.trim() ?? user.trim(), image };
  const statement = user.match(/whether the following statement is true: ([^"\n]+)/g)?.pop()?.replace(/^.*is true: /, '').trim();
  if (statement) return { model: j.model, type: 'assert', statement, image };
  // 位置特定・判定以外（aiQuery・計画など）は、求められている内容をそのまま渡す
  return { model: j.model, type: 'other', system: system.slice(-1500), user: user.slice(-1500), image };
}

// 答え（ans-N.json）を Midscene の応答形式にする
export function formatAnswer(req, ans, size) {
  if (req.type === 'locate') {
    if (!Array.isArray(ans.bbox)) return JSON.stringify({ bbox_2d: [], error: ans.reason ?? 'not found' });
    const [x1, y1, x2, y2] = ans.bbox;
    return JSON.stringify({ bbox_2d: [x1 * 1000 / size.width, y1 * 1000 / size.height, x2 * 1000 / size.width, y2 * 1000 / size.height].map(Math.round) });
  }
  if (req.type === 'assert') return `<observation>${ans.reason ?? (ans.ok ? 'the statement holds' : 'the statement does not hold')}</observation>\n<data-json>\n{ "StatementIsTruthy": ${!!ans.ok} }\n</data-json>`;
  return String(ans.content ?? '');
}

export async function startAgentModel({ port = 8765, dir = '.agent-model', poll = 300, log = console.log } = {}) {
  dir = path.resolve(dir);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', async () => {
      const id = ++n; const r = parseRequest(body);
      const size = r.image ? imageSize(r.image.data) : { width: 0, height: 0 };
      const image = r.image ? `req-${id}.${r.image.ext}` : null;
      if (image) fs.writeFileSync(path.join(dir, image), r.image.data);
      const { image: _, model, ...ask } = r;
      fs.writeFileSync(path.join(dir, `req-${id}.json`), JSON.stringify({ id, ...ask, image, ...size }, null, 1));
      log(`[${id}] ${r.type}：${r.prompt ?? r.statement ?? '(other)'}　→ ${path.join(dir, `ans-${id}.json`)} を待っています`);
      const ansFile = path.join(dir, `ans-${id}.json`);
      let ans = null;
      while (!ans && !res.destroyed) {
        await new Promise(x => setTimeout(x, poll));
        if (fs.existsSync(ansFile)) { try { ans = JSON.parse(fs.readFileSync(ansFile, 'utf8')); } catch { /* 書き込み途中。次の回で読み直す */ } }
      }
      if (!ans) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `agent-${id}`, object: 'chat.completion', model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: formatAnswer(r, ans, size) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  const env = { MIDSCENE_MODEL_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, MIDSCENE_MODEL_API_KEY: 'agent', MIDSCENE_MODEL_NAME: 'agent-in-the-loop', MIDSCENE_MODEL_FAMILY: 'qwen3',
    MIDSCENE_MODEL_TIMEOUT: '1800000', MIDSCENE_MODEL_RETRY_COUNT: '0' };
  return { env, dir, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, d) => args.includes(name) ? args[args.indexOf(name) + 1] : d;
  const s = await startAgentModel({ port: Number(opt('--port', 8765)), dir: opt('--dir', '.agent-model') });
  console.log(`エージェントをモデルにする中継サーバーを起動しました。要求と画面：${s.dir}\n試験を実行する側で次の環境変数を設定してください（.env でも可）：\n` + Object.entries(s.env).map(([k, v]) => `  ${k}=${v}`).join('\n') + '\n');
}
