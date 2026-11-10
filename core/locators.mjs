// AI 指示文（aiTap / aiInput / aiWaitFor）→ Playwright 操作の辞書の仕組み（全サイト共通）
// 辞書 = { aiTap: [[正規表現, (page, match) => Locator]], aiInput: [...], aiWaitFor: [[正規表現, (page, match) => Locator | 関数 | { locator, state }]] }
// aiHover は aiTap の辞書で解決する。aiWaitFor の関数はブラウザ内で真になるまで待つ条件、{ locator, state: 'hidden' } は消えるまで待つ。
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
      for (const k of [...KINDS, 'upload', 'download']) if (typeof st[k] === 'string') { try { resolve({ aiHover: 'aiTap', download: 'aiTap', upload: 'aiInput' }[k] ?? k, st[k]); } catch { out.add(`${k}「${st[k]}」`); } }
    return [...out];
  };
  return { resolve, unmapped };
}

export const KINDS = ['aiTap', 'aiHover', 'aiInput', 'aiWaitFor'];

// 網羅確認用：ロケーター生成をすべて受け付けるダミー
const DUMMY = new Proxy({}, { get: () => () => DUMMY });

export const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const exact = s => new RegExp(`^\\s*${esc(s)}\\s*$`);

// 押せる要素（button / link）を表示名の完全一致で探す。first=false なら同名の最後の要素（「画面下部の」等）
export const clickable = (scope, name, last = false) => {
  const l = scope.getByRole('button', { name, exact: true }).or(scope.getByRole('link', { name, exact: true })).filter({ visible: true });
  return last ? l.last() : l.first();
};

// 表形式のフォーム（label のない古い画面）：「項目名のセル」と同じ行にある入力部品を探す。
//   <tr><td>顧客名</td><td><input name="custName"></td></tr>
// 項目名のセルに「必須」などの印が付いていてもよい（先頭一致）。同じ項目名が複数あるときは最初のもの
export const cellField = (scope, label, selector = 'input:not([type=hidden]), select, textarea') =>
  scope.locator('tr').filter({ has: scope.locator('th, td').filter({ hasText: new RegExp(`^\\s*${esc(label)}`) }) }).filter({ visible: true }).first().locator(selector).first();

// 表形式のフォーム用の辞書。label のない画面のサイトは createLocators(TABLE_FORM, DEFAULTS) とする（サイト固有の辞書はその前に置く）
export const TABLE_FORM = {
  aiTap: [
    // 例：至急のチェックボックス（項目名のセルの隣にあるチェックボックス）
    [/^(.+)のチェックボックス$/, (page, [, label]) => cellField(page, label, 'input[type=checkbox]')],
    // 例：区分の「法人」ラジオボタン（項目名のセルの隣に並ぶラジオボタン。選択肢は value か直後の文言）
    [/^(.+)の「(.+)」ラジオボタン$/, (page, [, label, name]) => page.locator('tr').filter({ has: page.locator('th, td').filter({ hasText: new RegExp(`^\\s*${esc(label)}`) }) }).first()
      .locator(`input[type=radio][value="${name}"], label:has-text("${name}") input[type=radio]`).first()],
  ],
  aiInput: [
    // label がある項目はそれを優先し、なければ項目名のセルの隣を探す（label のある画面とない画面が混ざっていてもよい）
    [/^(.+)の(?:入力欄|選択欄|テキストエリア)$/, (page, [, label]) => page.getByLabel(label, { exact: true })
      .or(cellField(page, label, 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), select, textarea')).first()],
  ],
};

// iframe の中の画面：辞書の各パターンを、指定した iframe の中で探すようにする。
//   createLocators(inFrame('iframe[name=main]', DEFAULTS))            画面全体が iframe の中
//   createLocators(inFrame('#detail', SITE_DETAIL), DEFAULTS)         一部の指示文だけ iframe の中
export const inFrame = (frameSelector, ...tables) => {
  const out = {};
  for (const t of tables) for (const [kind, list] of Object.entries(t)) (out[kind] ??= []).push(...list.map(([re, fn]) => [re, (page, m) => fn(page.frameLocator ? page.frameLocator(frameSelector) : page, m)]));
  return out;
};

// 標準辞書：アクセシビリティ（label・fieldset/legend・role・h1）が整った画面なら、サイト固有の辞書なしで解決できる指示文の書き方。
// 新しいサイトのケースはこの書き方で flow を書けば、Midscene（AI）でも Playwright（辞書）でもそのまま動く。
export const DEFAULTS = {
  aiTap: [
    // 例：受取方法の「メール」ラジオボタン／お知らせの「受け取る」チェックボックス（グループ名＝fieldset の legend）
    [/^(.+)の「(.+)」(ラジオボタン|チェックボックス)$/, (page, [, group, name, kind]) =>
      page.getByRole('group', { name: group }).getByRole(kind === 'ラジオボタン' ? 'radio' : 'checkbox', { name, exact: true })],
    // 例：「利用規約に同意する」チェックボックス（グループに入っていない単独のもの）
    [/^「(.+)」(ラジオボタン|チェックボックス)$/, (page, [, name, kind]) => page.getByRole(kind === 'ラジオボタン' ? 'radio' : 'checkbox', { name, exact: true })],
    // 例：「カフェ 200円引き」の行の「交換する」ボタン
    [/^「(.+)」の行の「(.+)」(?:ボタン|リンク)$/, (page, [, row, name]) => clickable(page.getByRole('row').filter({ hasText: row }), name)],
    // 例：「明細」タブ／「設定」メニュー
    [/^「(.+)」タブ$/, (page, [, name]) => page.getByRole('tab', { name, exact: true })],
    [/^「(.+)」メニュー$/, (page, [, name]) => page.getByRole('menuitem', { name, exact: true })],
    // 例：「確認」ボタン／画面下部の「戻る」ボタン／「交換履歴」リンク
    [/^(画面下部の)?「(.+)」(?:ボタン|リンク)$/, (page, [, bottom, name]) => clickable(page, name, !!bottom)],
  ],
  aiInput: [
    // 例：「山田 太郎」の行の数量の入力欄（表の行の中の入力欄）
    [/^「(.+)」の行の(.+)の(?:入力欄|選択欄)$/, (page, [, row, label]) => page.getByRole('row').filter({ hasText: row }).getByLabel(label, { exact: true })],
    // 例：枚数の入力欄／都道府県の選択欄（label の文言＝アクセシブルネームの完全一致。select は value に選択肢の表示名を書く）
    [/^(.+)の(?:入力欄|選択欄|テキストエリア)$/, (page, [, label]) => page.getByLabel(label, { exact: true })],
  ],
  aiWaitFor: [
    [/^「(.+)」画面が表示されている$/, (page, [, title]) => page.getByRole('heading', { level: 1, name: title, exact: true })],
    // 例：「読み込み中」が表示されていない（消えるまで待つ）
    [/^「(.+)」(?:が|は)表示されていない$/, (page, [, text]) => ({ locator: page.getByText(text).filter({ visible: true }).first(), state: 'hidden' })],
    [/^「(.+)」(?:という(?:エラー)?メッセージが|と|が)表示されている$/, (page, [, text]) => page.getByText(text).filter({ visible: true }).first()],
  ],
};
