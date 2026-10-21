// AI 指示文（aiTap / aiInput / aiWaitFor）→ Playwright 操作の辞書の仕組み（全サイト共通）
// 辞書 = { aiTap: [[正規表現, (page, match) => Locator]], aiInput: [...], aiWaitFor: [[正規表現, (page, match) => Locator | 関数]] }
// createLocators(サイト固有の辞書, ..., DEFAULTS) の順に照合し、最初に解決できたものを使う。
// 未登録の指示文は例外（何も押さずに「OK」になるのを防ぐ）。

export function createLocators(...tables) {
  const match = (kind, prompt, page) => {
    for (const t of tables) for (const [re, fn] of t[kind] ?? []) { const m = prompt.match(re); if (m) { const r = fn(page, m); if (r) return r; } }
    return null;
  };
  const resolve = (kind, prompt, page = DUMMY) => {
    const r = match(kind, prompt, page);
    if (!r) throw new Error(`ロケーター辞書に未登録の指示文：${kind}「${prompt}」`);
    return r;
  };
  // 網羅確認：flow 中の指示文で辞書が解決できないものを返す（--build-only で使用）
  const unmapped = suites => {
    const out = new Set();
    for (const s of suites) for (const c of s.cases) for (const st of c.flow)
      for (const k of KINDS) if (typeof st[k] === 'string') { try { resolve(k, st[k]); } catch { out.add(`${k}「${st[k]}」`); } }
    return [...out];
  };
  return { resolve, unmapped };
}

export const KINDS = ['aiTap', 'aiInput', 'aiWaitFor'];

// 網羅確認用：ロケーター生成をすべて受け付けるダミー
const DUMMY = new Proxy({}, { get: () => () => DUMMY });

export const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const exact = s => new RegExp(`^\\s*${esc(s)}\\s*$`);

// 押せる要素（button / link）を表示名の完全一致で探す。first=false なら同名の最後の要素（「画面下部の」等）
export const clickable = (scope, name, last = false) => {
  const l = scope.getByRole('button', { name, exact: true }).or(scope.getByRole('link', { name, exact: true })).filter({ visible: true });
  return last ? l.last() : l.first();
};

// 標準辞書：アクセシビリティ（label・fieldset/legend・role・h1）が整った画面なら、サイト固有の辞書なしで解決できる指示文の書き方。
// 新しいサイトのケースはこの書き方で flow を書けば、Midscene（AI）でも Playwright（辞書）でもそのまま動く。
export const DEFAULTS = {
  aiTap: [
    // 例：受取方法の「メール」ラジオボタン／お知らせの「受け取る」チェックボックス（グループ名＝fieldset の legend）
    [/^(.+)の「(.+)」(ラジオボタン|チェックボックス)$/, (page, [, group, name, kind]) =>
      page.getByRole('group', { name: group }).getByRole(kind === 'ラジオボタン' ? 'radio' : 'checkbox', { name, exact: true })],
    // 例：「カフェ 200円引き」の行の「交換する」ボタン
    [/^「(.+)」の行の「(.+)」(?:ボタン|リンク)$/, (page, [, row, name]) => clickable(page.getByRole('row').filter({ hasText: row }), name)],
    // 例：「確認」ボタン／画面下部の「戻る」ボタン／「交換履歴」リンク
    [/^(画面下部の)?「(.+)」(?:ボタン|リンク)$/, (page, [, bottom, name]) => clickable(page, name, !!bottom)],
  ],
  aiInput: [
    // 例：枚数の入力欄（label の文言＝アクセシブルネームの完全一致）
    [/^(.+)の入力欄$/, (page, [, label]) => page.getByLabel(label, { exact: true })],
  ],
  aiWaitFor: [
    [/^「(.+)」画面が表示されている$/, (page, [, title]) => page.getByRole('heading', { level: 1, name: title, exact: true })],
    [/^「(.+)」(?:という(?:エラー)?メッセージが|と)表示されている$/, (page, [, text]) => page.getByText(text).filter({ visible: true }).first()],
  ],
};
