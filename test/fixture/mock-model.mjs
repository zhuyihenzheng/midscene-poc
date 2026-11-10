// 模型の代わりをする OpenAI 互換サーバー（フレームワークの試験用）。
// Midscene が実際に送る要求（要素の位置特定・画面の判定）に、決めておいた答えを Midscene の応答形式で返す。
// これで --ai-assert・--heal・Midscene エンジンを、本物の Midscene ライブラリを通して端から端まで確かめられる
// （確かめられないのはモデルの賢さだけ）。
//   locate：{ 指示文: [x, y, 幅, 高さ]（画面の px） }  → {"bbox_2d":[…]}（0〜1000 に正規化）
//   truthy：文 => true/false                        → <data-json>{"StatementIsTruthy":…}</data-json>
import http from 'http';

export async function startMockModel({ locate = {}, truthy = () => true, viewport = { width: 1000, height: 700 } } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body || '{}');
      const text = role => (j.messages ?? []).filter(m => m.role === role).map(m => typeof m.content === 'string' ? m.content : m.content.filter(c => c.type === 'text').map(c => c.text).join('\n')).join('\n');
      const system = text('system'); const user = text('user');
      let content;
      if (system.includes('bbox_2d')) {
        const prompt = user.match(/Find: (.+)/)?.[1]?.trim() ?? '';
        const box = locate[prompt];
        calls.push({ type: 'locate', prompt, found: !!box });
        content = box ? JSON.stringify({ bbox_2d: [box[0] * 1000 / viewport.width, box[1] * 1000 / viewport.height, (box[0] + box[2]) * 1000 / viewport.width, (box[1] + box[3]) * 1000 / viewport.height].map(Math.round) })
          : JSON.stringify({ bbox_2d: [], error: `not found: ${prompt}` });
      } else {
        const statement = user.match(/whether the following statement is true: ([^"\n]+)/g)?.pop()?.replace(/^.*is true: /, '').trim() ?? '';
        const ok = !!truthy(statement);
        calls.push({ type: 'assert', statement, ok });
        content = `<observation>mock model: ${ok ? 'the statement holds' : 'the statement does not hold'}</observation>\n<data-json>\n{ "StatementIsTruthy": ${ok} }\n</data-json>`;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', model: j.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const env = { MIDSCENE_MODEL_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, MIDSCENE_MODEL_API_KEY: 'mock', MIDSCENE_MODEL_NAME: 'mock-model', MIDSCENE_MODEL_FAMILY: 'qwen3' };
  return { env, calls, close: () => new Promise(r => server.close(r)) };
}
