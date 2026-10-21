// ポイントクーポン交換サイト（デモ）画面試験：ケース定義（試験仕様書・YAML・判定の単一ソース）
// 起草の入力：app/設計書.md（期待値の根拠）＋ inventory/inventory.md（core/explore.mjs の採取結果・操作と読み取り位置の根拠）
// flow の指示文は標準辞書（core/locators.mjs の DEFAULTS）の書き方。Midscene（AI）・Playwright のどちらでもそのまま動く。
// 判定方針：合否は javascript で記録した DOM 値とポイント基盤 API への送信電文（ctx.journal.ledger）。aiAssert は参考。

import { eq, eqObj, ai } from '../../../core/check.mjs';

// ---------- 共通 JS ----------
// 画面の状態（見出し・入力欄・ラジオ・エラー・メッセージ・表示項目・表）を 1 回で記録する
function pageState() {
  const txt = e => (e?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const vis = e => !!e && e.offsetParent !== null && !e.closest('[hidden]');
  const fields = {};
  document.querySelectorAll('input[id]:not([type=hidden]):not([type=radio])').forEach(e => { fields[e.id] = { value: e.value, visible: vis(e), disabled: e.disabled }; });
  const radios = {};
  document.querySelectorAll('input[type=radio]').forEach(e => { radios[e.name] ??= null; if (e.checked) radios[e.name] = e.value; });
  const errors = {};
  document.querySelectorAll('.field-error').forEach(p => { if (vis(p)) errors[p.id.replace(/-error$/, '')] = txt(p); });
  const dl = {};
  document.querySelectorAll('dt').forEach(dt => { dl[txt(dt)] = txt(dt.nextElementSibling); });
  const rows = [...document.querySelectorAll('tbody tr')];
  return { title: txt(document.querySelector('h1')), path: location.pathname, fields, radios, errors, dl,
    alert: txt(document.querySelector('[role=alert]')) || null, status: txt(document.querySelector('[role=status]')) || null,
    caption: txt(document.querySelector('caption')) || null, table: rows.map(r => [...r.cells].map(txt)), rowLinks: rows.map(r => !!r.querySelector('a')),
    balance: txt(document.getElementById('balance')) || null };
}
const STATE = `(${pageState.toString()})()\n`;
const state = name => ({ javascript: STATE, name });
// 画面遷移（URL 直接）：Midscene の javascript ステップでは遷移完了を待てないため setTimeout ＋ sleep ＋ 見出し待ち
const go = (path, title) => [{ javascript: `setTimeout(() => { location.href = '${path}'; }, 300);\n` }, { sleep: 1500 },
  { aiWaitFor: `「${title}」画面が表示されている`, timeout: 15000 }];
const shot = label => ({ recordToReport: label });

// ---------- ケース定義 ----------
// check: (o, ctx) => [ [観点, 合否 boolean, 実測値] ... ]  o=当該スイートの出力 JSON、ctx.journal.ledger=ポイント基盤 API 送信電文
export const SUITES = [
{
  file: '01-login', title: 'S01 ログイン', cases: [
  { id: 'L-01', screen: 'S02→S01', kind: '遷移', title: '〈ログアウト〉でログイン画面へ',
    steps: '1. マイページで〈ログアウト〉', expect: 'ログイン画面。会員ID・パスワードは空欄。',
    flow: [...go('/', 'マイページ'), { aiTap: '「ログアウト」ボタン' }, { aiWaitFor: '「ログイン」画面が表示されている', timeout: 15000 }, state('L01'), shot('L-01 ログイン画面')],
    check: o => { const v = o.L01 ?? {}; return [
      ['ログイン画面', v.title === 'ログイン', v.title],
      ['会員ID・パスワードが空欄', v.fields?.memberId?.value === '' && v.fields?.password?.value === '', [v.fields?.memberId?.value, v.fields?.password?.value]]]; } },

  { id: 'L-02', screen: 'S01 ログイン', kind: '必須チェック', title: '未入力のままログイン',
    steps: '1. 何も入力せず〈ログイン〉', expect: '会員ID の下に「会員IDを入力してください。」、パスワードの下に「パスワードを入力してください。」。',
    flow: [{ aiTap: '「ログイン」ボタン' }, { aiWaitFor: '「会員IDを入力してください。」と表示されている', timeout: 15000 }, state('L02'), shot('L-02 必須エラー')],
    check: o => { const e = o.L02?.errors ?? {}; return [
      ['会員ID の必須エラー', e.memberId === '会員IDを入力してください。', e.memberId],
      ['パスワードの必須エラー', e.password === 'パスワードを入力してください。', e.password],
      ['ログイン画面のまま', o.L02?.title === 'ログイン', o.L02?.title]]; } },

  { id: 'L-03', screen: 'S01 ログイン', kind: '異常系', title: 'パスワード誤り',
    steps: '1. 会員ID「M0001」、パスワード「wrong」\n2. 〈ログイン〉', expect: '画面上部に「会員IDまたはパスワードが正しくありません。」。会員ID は保持、パスワードは空。',
    flow: [{ aiInput: '会員IDの入力欄', value: 'M0001' }, { aiInput: 'パスワードの入力欄', value: 'wrong' }, { aiTap: '「ログイン」ボタン' },
      { aiWaitFor: '「会員IDまたはパスワードが正しくありません。」と表示されている', timeout: 15000 }, state('L03'), shot('L-03 認証失敗')],
    check: o => { const v = o.L03 ?? {}; return [
      ['認証失敗メッセージ', v.alert === '会員IDまたはパスワードが正しくありません。', v.alert],
      ['会員ID を保持', v.fields?.memberId?.value === 'M0001', v.fields?.memberId?.value],
      ['パスワードは空', v.fields?.password?.value === '', v.fields?.password?.value]]; } },

  { id: 'L-04', screen: 'S01→S02', kind: '正常系', title: '正しい会員ID・パスワードでログイン',
    steps: '1. （L-03 の続き・会員ID は入力済み）パスワード「pass1234」\n2. 〈ログイン〉', expect: 'マイページ。会員名「山田 太郎」、保有ポイント「1,200 pt」。',
    flow: [{ aiInput: 'パスワードの入力欄', value: 'pass1234' }, { aiTap: '「ログイン」ボタン' }, { aiWaitFor: '「マイページ」画面が表示されている', timeout: 15000 },
      state('L04'), { aiAssert: '保有ポイントに「1,200 pt」と表示されている', name: 'L04_ai' }, shot('L-04 マイページ')],
    check: o => { const d = o.L04?.dl ?? {}; return [
      ['マイページへ遷移', o.L04?.title === 'マイページ', o.L04?.title],
      ['会員名', d['会員名'] === '山田 太郎', d['会員名']],
      ['保有ポイント（3 桁区切り＋pt）', d['保有ポイント'] === '1,200 pt', d['保有ポイント']],
      ['AI：保有ポイント', ai(o.L04_ai)]]; } },
  ] },
{
  file: '02-list', title: 'S03 クーポン一覧', cases: [
  { id: 'S-01', screen: 'S03 クーポン一覧', kind: '表示', title: '一覧の初期表示（全件・在庫なしの行）',
    steps: '1. マイページ〈クーポン一覧〉', expect: '4 件表示。必要ポイント「300 pt」、在庫「10 枚」形式。\nベーカリー（在庫 0）は「在庫なし」でリンクなし、他は「交換する」リンク。\nカテゴリは「すべて」選択。保有ポイント「1,200 pt」。',
    flow: [...go('/', 'マイページ'), { aiTap: '「クーポン一覧」リンク' }, { aiWaitFor: '「クーポン一覧」画面が表示されている', timeout: 15000 }, state('S01'),
      { aiAssert: '「ベーカリー 100円引き」の行に「在庫なし」と表示され、「交換する」リンクがない', name: 'S01_ai' }, shot('S-01 クーポン一覧')],
    check: o => { const v = o.S01 ?? {}; const t = v.table ?? []; const row = n => t.find(r => r[0] === n) ?? [];
      return [
      ['4 件表示', t.length === 4, t.length],
      ['カフェの行', eq(row('カフェ 200円引き').slice(0, 5), ['カフェ 200円引き', '飲食', '300 pt', '10 枚', '交換する']), row('カフェ 200円引き')],
      ['在庫 0 は「在庫なし」でリンクなし', row('ベーカリー 100円引き')[4] === '在庫なし' && v.rowLinks?.[t.indexOf(row('ベーカリー 100円引き'))] === false, row('ベーカリー 100円引き')],
      ['在庫ありの行は「交換する」リンク', ['カフェ 200円引き', '書店 500円券', '映画 1,000円券'].every(n => row(n)[4] === '交換する'), t.map(r => r[4])],
      ['カテゴリ初期値＝すべて', v.radios?.cat === 'すべて', v.radios?.cat],
      ['保有ポイント', v.balance === '1,200 pt', v.balance],
      ['AI：在庫なしの表示', ai(o.S01_ai)]]; } },

  { id: 'S-02', screen: 'S03 クーポン一覧', kind: '絞り込み', title: 'カテゴリ「飲食」で絞り込み',
    steps: '1. カテゴリ「飲食」を選択\n2. 〈絞り込む〉', expect: '飲食の 2 件（カフェ・ベーカリー）だけ表示。カテゴリは「飲食」選択のまま。',
    flow: [{ aiTap: 'カテゴリの「飲食」ラジオボタン' }, { aiTap: '「絞り込む」ボタン' }, { aiWaitFor: '「クーポン 2 件」と表示されている', timeout: 15000 },
      state('S02'), shot('S-02 飲食で絞り込み')],
    check: o => { const v = o.S02 ?? {}; return [
      ['飲食の 2 件のみ', eq((v.table ?? []).map(r => r[0]), ['カフェ 200円引き', 'ベーカリー 100円引き']), (v.table ?? []).map(r => r[0])],
      ['全行のカテゴリ＝飲食', (v.table ?? []).every(r => r[1] === '飲食'), (v.table ?? []).map(r => r[1])],
      ['選択状態を保持', v.radios?.cat === '飲食', v.radios?.cat]]; } },
  ] },
{
  file: '03-input', title: 'S04 クーポン交換（入力チェック）', cases: [
  { id: 'E-01', screen: 'S04 クーポン交換', kind: '表示', title: '交換画面の初期表示',
    steps: '1. クーポン一覧で「カフェ 200円引き」の〈交換する〉', expect: 'クーポン名・必要ポイント（1 枚）300 pt・在庫 10 枚・保有ポイント 1,200 pt。\n枚数は空、受取方法は未選択、メールアドレスは非表示。',
    flow: [...go('/coupons', 'クーポン一覧'), { aiTap: '「カフェ 200円引き」の行の「交換する」リンク' }, { aiWaitFor: '「クーポン交換」画面が表示されている', timeout: 15000 },
      state('E01'), shot('E-01 交換画面')],
    check: o => { const v = o.E01 ?? {}, d = v.dl ?? {}; return [
      ['クーポン情報', d['クーポン名'] === 'カフェ 200円引き' && d['必要ポイント（1 枚）'] === '300 pt' && d['在庫'] === '10 枚', [d['クーポン名'], d['必要ポイント（1 枚）'], d['在庫']]],
      ['保有ポイント', d['保有ポイント'] === '1,200 pt', d['保有ポイント']],
      ['枚数は空・受取方法は未選択', v.fields?.qty?.value === '' && v.radios?.method === null, [v.fields?.qty?.value, v.radios?.method]],
      ['メールアドレスは非表示', v.fields?.email?.visible === false, v.fields?.email]]; } },

  { id: 'E-02', screen: 'S04 クーポン交換', kind: '表示切替', title: '受取方法「メール」でメールアドレスを表示',
    steps: '1. 受取方法「メール」をクリック', expect: 'メールアドレスの入力欄が表示され入力可能。',
    flow: [{ aiTap: '受取方法の「メール」ラジオボタン' }, state('E02'), { aiAssert: 'メールアドレスの入力欄が表示されている', name: 'E02_ai' }, shot('E-02 メール選択')],
    check: o => { const f = o.E02?.fields?.email ?? {}; return [
      ['メールアドレスが表示・入力可', f.visible === true && f.disabled === false, f],
      ['AI：メールアドレス欄', ai(o.E02_ai)]]; } },

  { id: 'E-03', screen: 'S04 クーポン交換', kind: '表示切替', title: '「アプリ」へ切り替えるとメールアドレスを非表示にして値をクリア',
    steps: '1. メールアドレス「taro@example.com」を入力\n2. 受取方法「アプリ」をクリック\n3. 受取方法「メール」をクリック', expect: '2 でメールアドレスが非表示。3 で再表示された欄は空欄。',
    flow: [{ aiInput: 'メールアドレスの入力欄', value: 'taro@example.com' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, state('E03_app'),
      { aiTap: '受取方法の「メール」ラジオボタン' }, state('E03_back'), shot('E-03 再表示（空欄）')],
    check: o => { const a = o.E03_app?.fields?.email ?? {}, b = o.E03_back?.fields?.email ?? {}; return [
      ['アプリでは非表示', a.visible === false, a],
      ['メールに戻すと空欄で再表示', b.visible === true && b.value === '', b]]; } },

  { id: 'E-04', screen: 'S04 クーポン交換', kind: '必須チェック', title: '未入力のまま〈確認〉',
    steps: '1. 交換画面を開き直す\n2. 何も入力せず〈確認〉', expect: '「枚数を入力してください。」「受取方法を選択してください。」。交換画面のまま。',
    flow: [...go('/coupons/1/exchange', 'クーポン交換'), { aiTap: '「確認」ボタン' }, { aiWaitFor: '「枚数を入力してください。」と表示されている', timeout: 15000 },
      state('E04'), shot('E-04 必須エラー')],
    check: o => { const v = o.E04 ?? {}, e = v.errors ?? {}; return [
      ['枚数の必須エラー', e.qty === '枚数を入力してください。', e.qty],
      ['受取方法の必須エラー', e.method === '受取方法を選択してください。', e.method],
      ['交換画面のまま', v.title === 'クーポン交換', v.title]]; } },

  { id: 'E-05', screen: 'S04 クーポン交換', kind: '型チェック', title: '枚数に全角数字',
    steps: '1. 枚数「２」、受取方法「アプリ」\n2. 〈確認〉', expect: '「枚数は半角数字で入力してください。」。枚数「２」と受取方法「アプリ」は保持。',
    flow: [{ aiInput: '枚数の入力欄', value: '２' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      { aiWaitFor: '「枚数は半角数字で入力してください。」と表示されている', timeout: 15000 }, state('E05'), shot('E-05 全角数字')],
    check: o => { const v = o.E05 ?? {}; return [
      ['型エラー', v.errors?.qty === '枚数は半角数字で入力してください。', v.errors?.qty],
      ['入力値を保持', v.fields?.qty?.value === '２' && v.radios?.method === 'アプリ', [v.fields?.qty?.value, v.radios?.method]]]; } },

  { id: 'E-06', screen: 'S04 クーポン交換', kind: '境界値', title: '枚数 6 と 0 は範囲外',
    steps: '1. 枚数「6」で〈確認〉\n2. 枚数「0」で〈確認〉', expect: 'どちらも「枚数は1〜5の範囲で入力してください。」。',
    flow: [{ aiInput: '枚数の入力欄', value: '6' }, { aiTap: '「確認」ボタン' }, { aiWaitFor: '「枚数は1〜5の範囲で入力してください。」と表示されている', timeout: 15000 }, state('E06_6'),
      { aiInput: '枚数の入力欄', value: '0' }, { aiTap: '「確認」ボタン' }, { aiWaitFor: '「枚数は1〜5の範囲で入力してください。」と表示されている', timeout: 15000 }, state('E06_0'),
      shot('E-06 範囲外')],
    check: o => [
      ['6 は範囲外', o.E06_6?.errors?.qty === '枚数は1〜5の範囲で入力してください。' && o.E06_6?.fields?.qty?.value === '6', [o.E06_6?.fields?.qty?.value, o.E06_6?.errors?.qty]],
      ['0 は範囲外', o.E06_0?.errors?.qty === '枚数は1〜5の範囲で入力してください。' && o.E06_0?.fields?.qty?.value === '0', [o.E06_0?.fields?.qty?.value, o.E06_0?.errors?.qty]]] },

  { id: 'E-07', screen: 'S04 クーポン交換', kind: '必須・形式', title: 'メール選択時のメールアドレス未入力・形式誤り',
    steps: '1. 枚数「1」、受取方法「メール」、メールアドレス空で〈確認〉\n2. メールアドレス「taro.example.com」で〈確認〉', expect: '1：「メールアドレスを入力してください。」\n2：「メールアドレスの形式が正しくありません。」',
    flow: [{ aiInput: '枚数の入力欄', value: '1' }, { aiTap: '受取方法の「メール」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      { aiWaitFor: '「メールアドレスを入力してください。」と表示されている', timeout: 15000 }, state('E07_empty'),
      { aiInput: 'メールアドレスの入力欄', value: 'taro.example.com' }, { aiTap: '「確認」ボタン' },
      { aiWaitFor: '「メールアドレスの形式が正しくありません。」と表示されている', timeout: 15000 }, state('E07_format'), shot('E-07 形式誤り')],
    check: o => [
      ['未入力エラー', o.E07_empty?.errors?.email === 'メールアドレスを入力してください。', o.E07_empty?.errors?.email],
      ['形式エラー', o.E07_format?.errors?.email === 'メールアドレスの形式が正しくありません。', o.E07_format?.errors?.email],
      ['他項目はエラーなし', !o.E07_format?.errors?.qty && !o.E07_format?.errors?.method, o.E07_format?.errors]] },
  ] },
{
  file: '04-exchange', title: 'S05〜S07 交換確定・履歴', cases: [
  { id: 'X-01', screen: 'S05 確認', kind: '正常系', title: 'カフェ 2 枚・メールで確認画面',
    steps: '1. カフェの交換画面で枚数「2」、受取方法「メール」、メールアドレス「taro@example.com」\n2. 〈確認〉', expect: '確認画面：枚数「2 枚」、受取方法「メール」、メールアドレス表示、必要ポイント合計「600 pt」、交換後の保有ポイント「600 pt」。',
    flow: [...go('/coupons/1/exchange', 'クーポン交換'), { aiInput: '枚数の入力欄', value: '2' }, { aiTap: '受取方法の「メール」ラジオボタン' },
      { aiInput: 'メールアドレスの入力欄', value: 'taro@example.com' }, { aiTap: '「確認」ボタン' }, { aiWaitFor: '「交換内容の確認」画面が表示されている', timeout: 15000 },
      state('X01'), { aiAssert: '必要ポイント合計に「600 pt」と表示されている', name: 'X01_ai' }, shot('X-01 確認画面')],
    check: o => { const d = o.X01?.dl ?? {}; return [
      ['確認画面', o.X01?.title === '交換内容の確認', o.X01?.title],
      ['表示内容', d['クーポン名'] === 'カフェ 200円引き' && d['枚数'] === '2 枚' && d['受取方法'] === 'メール' && d['メールアドレス'] === 'taro@example.com', d],
      ['必要ポイント合計＝300×2', d['必要ポイント合計'] === '600 pt', d['必要ポイント合計']],
      ['交換後の保有ポイント＝1,200−600', d['交換後の保有ポイント'] === '600 pt', d['交換後の保有ポイント']],
      ['AI：合計', ai(o.X01_ai)]]; } },

  { id: 'X-02', screen: 'S05→S04', kind: '遷移', title: '〈戻る〉で入力値を保持',
    steps: '1. 確認画面で〈戻る〉', expect: '交換画面に戻り、枚数「2」・受取方法「メール」・メールアドレス「taro@example.com」を保持。',
    flow: [{ aiTap: '「戻る」ボタン' }, { aiWaitFor: '「クーポン交換」画面が表示されている', timeout: 15000 }, state('X02'), shot('X-02 戻る')],
    check: o => { const v = o.X02 ?? {}; return [
      ['交換画面へ戻る', v.title === 'クーポン交換', v.title],
      ['入力値を保持', v.fields?.qty?.value === '2' && v.radios?.method === 'メール' && v.fields?.email?.value === 'taro@example.com' && v.fields?.email?.visible, [v.fields?.qty?.value, v.radios?.method, v.fields?.email]]]; } },

  { id: 'X-03', screen: 'S05→S06', kind: '正常系', title: '交換確定と送信電文',
    steps: '1. 〈確認〉\n2. 確認画面で〈交換する〉', expect: '完了画面「クーポンの交換が完了しました。」、交換番号「EX-000001」、保有ポイント「600 pt」。\nポイント基盤 API へ POINT_USE を 1 回送信（USE_PT=600、COUPON_ID=1、MAISU=2、KOKAN_NO=EX-000001）。',
    flow: [{ aiTap: '「確認」ボタン' }, { aiWaitFor: '「交換内容の確認」画面が表示されている', timeout: 15000 }, { aiTap: '「交換する」ボタン' },
      { aiWaitFor: '「クーポンの交換が完了しました。」と表示されている', timeout: 15000 }, state('X03'), shot('X-03 交換完了')],
    check: (o, ctx) => { const d = o.X03?.dl ?? {}, l = ctx.journal.ledger; return [
      ['完了メッセージ', o.X03?.status === 'クーポンの交換が完了しました。', o.X03?.status],
      ['交換番号', d['交換番号'] === 'EX-000001', d['交換番号']],
      ['交換後の保有ポイント', d['交換後の保有ポイント'] === '600 pt', d['交換後の保有ポイント']],
      ['送信は 1 回', l.length === 1, l.length],
      ['送信電文', eqObj(l[0], { API: 'POINT_USE', KAIIN_NO: 'M0001', USE_PT: 600, COUPON_ID: 1, MAISU: 2, KOKAN_NO: 'EX-000001' }), l[0]]]; } },

  { id: 'X-04', screen: 'S07／S03', kind: '反映', title: '交換履歴・在庫・保有ポイントへの反映',
    steps: '1. 完了画面〈交換履歴〉\n2. クーポン一覧を開く', expect: '交換履歴に「EX-000001｜カフェ 200円引き｜2 枚｜600 pt｜メール」。\nクーポン一覧でカフェの在庫「8 枚」、保有ポイント「600 pt」。',
    flow: [{ aiTap: '「交換履歴」リンク' }, { aiWaitFor: '「交換履歴」画面が表示されている', timeout: 15000 }, state('X04_history'), shot('X-04 交換履歴'),
      ...go('/coupons', 'クーポン一覧'), state('X04_list'), shot('X-04 一覧（在庫・保有ポイント）')],
    check: o => { const h = o.X04_history?.table ?? [], t = o.X04_list?.table ?? []; return [
      ['履歴 1 件', eq(h, [['EX-000001', 'カフェ 200円引き', '2 枚', '600 pt', 'メール']]), h],
      ['カフェの在庫 10→8', t.find(r => r[0] === 'カフェ 200円引き')?.[3] === '8 枚', t.find(r => r[0] === 'カフェ 200円引き')?.[3]],
      ['保有ポイント 1,200→600', o.X04_list?.balance === '600 pt', o.X04_list?.balance]]; } },
  ] },
{
  file: '05-boundary', title: 'S04 業務チェック（在庫・ポイント境界）', cases: [
  { id: 'B-01', screen: 'S04 クーポン交換', kind: '業務チェック', title: '在庫を超える枚数',
    steps: '1. 書店 500円券（在庫 2）の交換画面で枚数「3」、受取方法「アプリ」\n2. 〈確認〉', expect: '画面上部に「在庫が不足しています（残り 2 枚）。」（在庫チェックはポイントより先）。交換画面のまま。',
    flow: [...go('/coupons/3/exchange', 'クーポン交換'), { aiInput: '枚数の入力欄', value: '3' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      { aiWaitFor: '「在庫が不足しています（残り 2 枚）。」と表示されている', timeout: 15000 }, state('B01'), shot('B-01 在庫不足')],
    check: o => [['在庫不足メッセージ', o.B01?.alert === '在庫が不足しています（残り 2 枚）。', o.B01?.alert], ['交換画面のまま', o.B01?.title === 'クーポン交換', o.B01?.title]] },

  { id: 'B-02', screen: 'S04 クーポン交換', kind: '業務チェック', title: '必要ポイント合計が保有ポイントを超える',
    steps: '1. カフェ（300 pt）の交換画面で枚数「5」（合計 1,500 pt ＞ 保有 1,200 pt）、受取方法「アプリ」\n2. 〈確認〉', expect: '画面上部に「保有ポイントが不足しています。」。交換画面のまま。',
    flow: [...go('/coupons/1/exchange', 'クーポン交換'), { aiInput: '枚数の入力欄', value: '5' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      { aiWaitFor: '「保有ポイントが不足しています。」と表示されている', timeout: 15000 }, state('B02'), shot('B-02 ポイント不足')],
    check: o => [['ポイント不足メッセージ', o.B02?.alert === '保有ポイントが不足しています。', o.B02?.alert], ['交換画面のまま', o.B02?.title === 'クーポン交換', o.B02?.title]] },

  { id: 'B-03', screen: 'S04→S05', kind: '境界値', title: '必要ポイント合計＝保有ポイントは交換できる',
    steps: '1. 映画 1,000円券（1,200 pt）の交換画面で枚数「1」（合計 1,200 pt ＝ 保有 1,200 pt）、受取方法「アプリ」\n2. 〈確認〉', expect: '確認画面へ進む。必要ポイント合計「1,200 pt」、交換後の保有ポイント「0 pt」（設計書 S04：同じ場合は交換できる）。',
    flow: [...go('/coupons/4/exchange', 'クーポン交換'), { aiInput: '枚数の入力欄', value: '1' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      // 不具合時は交換画面のままになるため、待機の前に画面を記録して実際の表示を結果に残す
      { sleep: 1000 }, state('B03'), shot('B-03 確認（ちょうど）'), { aiWaitFor: '「交換内容の確認」画面が表示されている', timeout: 5000 }],
    check: o => { const v = o.B03 ?? {}, d = v.dl ?? {}; return [
      ['確認画面へ進む', v.title === '交換内容の確認', `${v.title}${v.alert ? '（' + v.alert + '）' : ''}`],
      ['必要ポイント合計', d['必要ポイント合計'] === '1,200 pt', d['必要ポイント合計']],
      ['交換後の保有ポイント 0 pt', d['交換後の保有ポイント'] === '0 pt', d['交換後の保有ポイント']]]; } },

  { id: 'B-04', screen: 'S05→S06', kind: '境界値', title: '保有ポイントちょうどの交換確定',
    steps: '1. （B-03 の続き）〈交換する〉', expect: '完了画面で保有ポイント「0 pt」。送信電文 USE_PT=1200、COUPON_ID=4、MAISU=1（このスイートで送信は 1 回のみ）。',
    flow: [{ aiTap: '「交換する」ボタン' }, { aiWaitFor: '「クーポンの交換が完了しました。」と表示されている', timeout: 15000 }, state('B04'), shot('B-04 交換完了（0 pt）')],
    check: (o, ctx) => { const l = ctx.journal.ledger; return [
      ['完了・保有ポイント 0 pt', o.B04?.status === 'クーポンの交換が完了しました。' && o.B04?.dl?.['交換後の保有ポイント'] === '0 pt', [o.B04?.status, o.B04?.dl?.['交換後の保有ポイント']]],
      ['送信は 1 回（B-01/02 は送信しない）', l.length === 1, l.length],
      ['送信電文', l[0]?.USE_PT === 1200 && l[0]?.COUPON_ID === 4 && l[0]?.MAISU === 1, l[0]]]; } },
  ] },
];

