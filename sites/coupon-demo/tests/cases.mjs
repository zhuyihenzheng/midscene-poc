// ポイントクーポン交換サイト（デモ）画面試験：ケース定義（試験仕様書・YAML・判定の単一ソース）
// 起草の入力：app/設計書.md（期待値の根拠）＋ inventory/inventory.md（core/explore.mjs の採取結果・操作と読み取り位置の根拠）
// flow の指示文は標準辞書（core/locators.mjs の DEFAULTS）の書き方。Midscene（AI）・Playwright のどちらでもそのまま動く。
// 判定方針：合否は画面状態（state で記録した DOM 値）とポイント基盤 API への送信電文（journal.ledger）。aiAssert は参考。
//   verify：[観点, 記録値のパス, 期待値]。期待値はすべて設計書の記述から取る。
import { makeState, go, shot } from '../../../core/steps.mjs';
import { AI, absent, count, includes, partial } from '../../../core/check.mjs';

// 画面状態の記録。保有ポイント（#balance）はこのサイト固有の読み取り位置
const state = makeState({ extra: { balance: '#balance' } });
const wait = (text, timeout = 15000) => ({ aiWaitFor: text, timeout });
const screen = title => wait(`「${title}」画面が表示されている`);
const shown = text => wait(`「${text}」と表示されている`);

export const SUITES = [
{
  file: '01-login', title: 'S01 ログイン', cases: [
  { id: 'L-01', screen: 'S02→S01', kind: '遷移', title: '〈ログアウト〉でログイン画面へ',
    steps: '1. マイページで〈ログアウト〉', expect: 'ログイン画面。会員ID・パスワードは空欄。',
    flow: [...go('/', 'マイページ'), { aiTap: '「ログアウト」ボタン' }, screen('ログイン'), state('L01'), shot('L-01 ログイン画面')],
    verify: [
      ['ログイン画面', 'L01.title', 'ログイン'],
      ['会員ID は空欄', 'L01.fields.memberId.value', ''],
      ['パスワードは空欄', 'L01.fields.password.value', '']] },

  { id: 'L-02', screen: 'S01 ログイン', kind: '必須チェック', title: '未入力のままログイン',
    steps: '1. 何も入力せず〈ログイン〉', expect: '会員ID の下に「会員IDを入力してください。」、パスワードの下に「パスワードを入力してください。」。',
    flow: [{ aiTap: '「ログイン」ボタン' }, shown('会員IDを入力してください。'), state('L02'), shot('L-02 必須エラー')],
    verify: [
      ['会員ID の必須エラー', 'L02.errors.memberId', '会員IDを入力してください。'],
      ['パスワードの必須エラー', 'L02.errors.password', 'パスワードを入力してください。'],
      ['ログイン画面のまま', 'L02.title', 'ログイン']] },

  { id: 'L-03', screen: 'S01 ログイン', kind: '異常系', title: 'パスワード誤り',
    steps: '1. 会員ID「M0001」、パスワード「wrong」\n2. 〈ログイン〉', expect: '画面上部に「会員IDまたはパスワードが正しくありません。」。会員ID は保持、パスワードは空。',
    flow: [{ aiInput: '会員IDの入力欄', value: 'M0001' }, { aiInput: 'パスワードの入力欄', value: 'wrong' }, { aiTap: '「ログイン」ボタン' },
      shown('会員IDまたはパスワードが正しくありません。'), state('L03'), shot('L-03 認証失敗')],
    verify: [
      ['認証失敗メッセージ', 'L03.alert', '会員IDまたはパスワードが正しくありません。'],
      ['会員ID を保持', 'L03.fields.memberId.value', 'M0001'],
      ['パスワードは空', 'L03.fields.password.value', '']] },

  { id: 'L-04', screen: 'S01→S02', kind: '正常系', title: '正しい会員ID・パスワードでログイン',
    steps: '1. （L-03 の続き・会員ID は入力済み）パスワード「pass1234」\n2. 〈ログイン〉', expect: 'マイページ。会員名「山田 太郎」、保有ポイント「1,200 pt」。',
    flow: [{ aiInput: 'パスワードの入力欄', value: 'pass1234' }, { aiTap: '「ログイン」ボタン' }, screen('マイページ'),
      state('L04'), { aiAssert: '保有ポイントに「1,200 pt」と表示されている', name: 'L04_ai' }, shot('L-04 マイページ')],
    verify: [
      ['マイページへ遷移', 'L04.title', 'マイページ'],
      ['会員名', 'L04.dl.会員名', '山田 太郎'],
      ['保有ポイント（3 桁区切り＋pt）', 'L04.dl.保有ポイント', '1,200 pt'],
      ['AI：保有ポイント', 'L04_ai', AI]] },
  ] },
{
  file: '02-list', title: 'S03 クーポン一覧', cases: [
  { id: 'S-01', screen: 'S03 クーポン一覧', kind: '表示', title: '一覧の初期表示（全件・在庫なしの行）',
    steps: '1. マイページ〈クーポン一覧〉', expect: '4 件表示。必要ポイント「300 pt」、在庫「10 枚」形式。\nベーカリー（在庫 0）は「在庫なし」でリンクなし、他は「交換する」リンク。\nカテゴリは「すべて」選択。保有ポイント「1,200 pt」。',
    flow: [...go('/', 'マイページ'), { aiTap: '「クーポン一覧」リンク' }, screen('クーポン一覧'), state('S01'),
      { aiAssert: '「ベーカリー 100円引き」の行に「在庫なし」と表示され、「交換する」リンクがない', name: 'S01_ai' }, shot('S-01 クーポン一覧')],
    verify: [
      ['4 件表示', 'S01.table', count(4)],
      ['列見出し', 'S01.headers', ['クーポン名', 'カテゴリ', '必要ポイント', '在庫', '操作']],
      ['カフェの行', 'S01.rows.カフェ 200円引き', ['カフェ 200円引き', '飲食', '300 pt', '10 枚', '交換する']],
      ['在庫 0 は「在庫なし」', 'S01.rows.ベーカリー 100円引き.4', '在庫なし'],
      ['在庫 0 の行はリンクなし', 'S01.rowActions.ベーカリー 100円引き', []],
      ['在庫ありの行は「交換する」リンク（カフェ）', 'S01.rowActions.カフェ 200円引き', ['交換する']],
      ['在庫ありの行は「交換する」リンク（書店）', 'S01.rowActions.書店 500円券', ['交換する']],
      ['在庫ありの行は「交換する」リンク（映画）', 'S01.rowActions.映画 1,000円券', ['交換する']],
      ['カテゴリ初期値＝すべて', 'S01.radios.cat', 'すべて'],
      ['保有ポイント', 'S01.balance', '1,200 pt'],
      ['AI：在庫なしの表示', 'S01_ai', AI]] },

  { id: 'S-02', screen: 'S03 クーポン一覧', kind: '絞り込み', title: 'カテゴリ「飲食」で絞り込み',
    steps: '1. カテゴリ「飲食」を選択\n2. 〈絞り込む〉', expect: '飲食の 2 件（カフェ・ベーカリー）だけ表示。カテゴリは「飲食」選択のまま。',
    flow: [{ aiTap: 'カテゴリの「飲食」ラジオボタン' }, { aiTap: '「絞り込む」ボタン' }, shown('クーポン 2 件'), state('S02'), shot('S-02 飲食で絞り込み')],
    // 表の列を取り出す判定は関数形式で書く（宣言形式と併用できる）
    verify: [['選択状態を保持', 'S02.radios.cat', '飲食']],
    check: o => { const t = o.S02?.table ?? []; return [
      ['飲食の 2 件のみ', JSON.stringify(t.map(r => r[0])) === JSON.stringify(['カフェ 200円引き', 'ベーカリー 100円引き']), t.map(r => r[0])],
      ['全行のカテゴリ＝飲食', t.length > 0 && t.every(r => r[1] === '飲食'), t.map(r => r[1])]]; } },
  ] },
{
  file: '03-input', title: 'S04 クーポン交換（入力チェック）', cases: [
  { id: 'E-01', screen: 'S04 クーポン交換', kind: '表示', title: '交換画面の初期表示',
    steps: '1. クーポン一覧で「カフェ 200円引き」の〈交換する〉', expect: 'クーポン名・必要ポイント（1 枚）300 pt・在庫 10 枚・保有ポイント 1,200 pt。\n枚数は空、受取方法は未選択、メールアドレスは非表示。',
    flow: [...go('/coupons', 'クーポン一覧'), { aiTap: '「カフェ 200円引き」の行の「交換する」リンク' }, screen('クーポン交換'), state('E01'), shot('E-01 交換画面')],
    verify: [
      ['クーポン情報・保有ポイント', 'E01.dl', { クーポン名: 'カフェ 200円引き', '必要ポイント（1 枚）': '300 pt', 在庫: '10 枚', 保有ポイント: '1,200 pt' }],
      ['枚数は空', 'E01.fields.qty.value', ''],
      ['受取方法は未選択', 'E01.radios.method', null],
      ['メールアドレスは非表示', 'E01.fields.email.visible', false]] },

  { id: 'E-02', screen: 'S04 クーポン交換', kind: '表示切替', title: '受取方法「メール」でメールアドレスを表示',
    steps: '1. 受取方法「メール」をクリック', expect: 'メールアドレスの入力欄が表示され入力可能。',
    flow: [{ aiTap: '受取方法の「メール」ラジオボタン' }, state('E02'), { aiAssert: 'メールアドレスの入力欄が表示されている', name: 'E02_ai' }, shot('E-02 メール選択')],
    verify: [
      ['メールアドレスが表示・入力可', 'E02.fields.email', partial({ visible: true, disabled: false })],
      ['AI：メールアドレス欄', 'E02_ai', AI]] },

  { id: 'E-03', screen: 'S04 クーポン交換', kind: '表示切替', title: '「アプリ」へ切り替えるとメールアドレスを非表示にして値をクリア',
    steps: '1. メールアドレス「taro@example.com」を入力\n2. 受取方法「アプリ」をクリック\n3. 受取方法「メール」をクリック', expect: '2 でメールアドレスが非表示。3 で再表示された欄は空欄。',
    flow: [{ aiInput: 'メールアドレスの入力欄', value: 'taro@example.com' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, state('E03_app'),
      { aiTap: '受取方法の「メール」ラジオボタン' }, state('E03_back'), shot('E-03 再表示（空欄）')],
    verify: [
      ['アプリでは非表示', 'E03_app.fields.email.visible', false],
      ['メールに戻すと空欄で再表示', 'E03_back.fields.email', partial({ visible: true, value: '' })]] },

  { id: 'E-04', screen: 'S04 クーポン交換', kind: '必須チェック', title: '未入力のまま〈確認〉',
    steps: '1. 交換画面を開き直す\n2. 何も入力せず〈確認〉', expect: '「枚数を入力してください。」「受取方法を選択してください。」。交換画面のまま。',
    flow: [...go('/coupons/1/exchange', 'クーポン交換'), { aiTap: '「確認」ボタン' }, shown('枚数を入力してください。'), state('E04'), shot('E-04 必須エラー')],
    verify: [
      ['枚数の必須エラー', 'E04.errors.qty', '枚数を入力してください。'],
      ['受取方法の必須エラー', 'E04.errors.method', '受取方法を選択してください。'],
      ['交換画面のまま', 'E04.title', 'クーポン交換']] },

  { id: 'E-05', screen: 'S04 クーポン交換', kind: '型チェック', title: '枚数に全角数字',
    steps: '1. 枚数「２」、受取方法「アプリ」\n2. 〈確認〉', expect: '「枚数は半角数字で入力してください。」。枚数「２」と受取方法「アプリ」は保持。',
    flow: [{ aiInput: '枚数の入力欄', value: '２' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      shown('枚数は半角数字で入力してください。'), state('E05'), shot('E-05 全角数字')],
    verify: [
      ['型エラー', 'E05.errors.qty', '枚数は半角数字で入力してください。'],
      ['枚数の入力値を保持', 'E05.fields.qty.value', '２'],
      ['受取方法を保持', 'E05.radios.method', 'アプリ']] },

  { id: 'E-06', screen: 'S04 クーポン交換', kind: '境界値', title: '枚数 6 と 0 は範囲外',
    steps: '1. 枚数「6」で〈確認〉\n2. 枚数「0」で〈確認〉', expect: 'どちらも「枚数は1〜5の範囲で入力してください。」。',
    flow: [{ aiInput: '枚数の入力欄', value: '6' }, { aiTap: '「確認」ボタン' }, shown('枚数は1〜5の範囲で入力してください。'), state('E06_6'),
      { aiInput: '枚数の入力欄', value: '0' }, { aiTap: '「確認」ボタン' }, shown('枚数は1〜5の範囲で入力してください。'), state('E06_0'), shot('E-06 範囲外')],
    verify: [
      ['6 は範囲外', 'E06_6.errors.qty', '枚数は1〜5の範囲で入力してください。'],
      ['6 の入力値を保持', 'E06_6.fields.qty.value', '6'],
      ['0 は範囲外', 'E06_0.errors.qty', '枚数は1〜5の範囲で入力してください。'],
      ['0 の入力値を保持', 'E06_0.fields.qty.value', '0']] },

  { id: 'E-07', screen: 'S04 クーポン交換', kind: '必須・形式', title: 'メール選択時のメールアドレス未入力・形式誤り',
    steps: '1. 枚数「1」、受取方法「メール」、メールアドレス空で〈確認〉\n2. メールアドレス「taro.example.com」で〈確認〉', expect: '1：「メールアドレスを入力してください。」\n2：「メールアドレスの形式が正しくありません。」',
    flow: [{ aiInput: '枚数の入力欄', value: '1' }, { aiTap: '受取方法の「メール」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      shown('メールアドレスを入力してください。'), state('E07_empty'),
      { aiInput: 'メールアドレスの入力欄', value: 'taro.example.com' }, { aiTap: '「確認」ボタン' },
      shown('メールアドレスの形式が正しくありません。'), state('E07_format'), shot('E-07 形式誤り')],
    verify: [
      ['未入力エラー', 'E07_empty.errors.email', 'メールアドレスを入力してください。'],
      ['形式エラー', 'E07_format.errors', { email: 'メールアドレスの形式が正しくありません。' }]] },

  { id: 'E-08', screen: 'S04 クーポン交換', kind: '境界値', title: '枚数 1 と 5 は範囲内',
    steps: '1. 交換画面を開き直し、枚数「1」、受取方法「アプリ」で〈確認〉\n2. 〈戻る〉、枚数「5」で〈確認〉', expect: '1：確認画面へ進む（枚数「1 枚」）。\n2：枚数は範囲内のため枚数のエラーは出ない（合計 1,500 pt ＞ 保有 1,200 pt のため「保有ポイントが不足しています。」）。',
    flow: [...go('/coupons/1/exchange', 'クーポン交換'), { aiInput: '枚数の入力欄', value: '1' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      screen('交換内容の確認'), state('E08_1'), { aiTap: '「戻る」ボタン' }, screen('クーポン交換'),
      { aiInput: '枚数の入力欄', value: '5' }, { aiTap: '「確認」ボタン' }, shown('保有ポイントが不足しています。'), state('E08_5'), shot('E-08 枚数 5')],
    verify: [
      ['1 は確認画面へ進む', 'E08_1.title', '交換内容の確認'],
      ['確認画面の枚数', 'E08_1.dl.枚数', '1 枚'],
      ['5 は枚数のエラーなし', 'E08_5.errors', {}],
      ['5 は業務チェック（ポイント不足）へ進む', 'E08_5.alert', '保有ポイントが不足しています。']] },
  ] },
{
  file: '04-exchange', title: 'S05〜S07 交換確定・履歴', cases: [
  { id: 'X-00', screen: 'S07 交換履歴', kind: '表示', title: '履歴がないときの表示',
    steps: '1. （初期データ）交換履歴を開く', expect: '「交換履歴はありません。」と表示。一覧は表示しない。',
    flow: [...go('/history', '交換履歴'), state('X00'), shot('X-00 履歴なし')],
    verify: [
      ['履歴なしの文言', 'X00.text', includes('交換履歴はありません。')],
      ['一覧は表示しない', 'X00.table', count(0)]] },

  { id: 'X-01', screen: 'S05 確認', kind: '正常系', title: 'カフェ 2 枚・メールで確認画面',
    steps: '1. カフェの交換画面で枚数「2」、受取方法「メール」、メールアドレス「taro@example.com」\n2. 〈確認〉', expect: '確認画面：枚数「2 枚」、受取方法「メール」、メールアドレス表示、必要ポイント合計「600 pt」、交換後の保有ポイント「600 pt」。',
    flow: [...go('/coupons/1/exchange', 'クーポン交換'), { aiInput: '枚数の入力欄', value: '2' }, { aiTap: '受取方法の「メール」ラジオボタン' },
      { aiInput: 'メールアドレスの入力欄', value: 'taro@example.com' }, { aiTap: '「確認」ボタン' }, screen('交換内容の確認'),
      state('X01'), { aiAssert: '必要ポイント合計に「600 pt」と表示されている', name: 'X01_ai' }, shot('X-01 確認画面')],
    verify: [
      ['確認画面', 'X01.title', '交換内容の確認'],
      ['表示内容（合計＝300×2、交換後＝1,200−600）', 'X01.dl', { クーポン名: 'カフェ 200円引き', 枚数: '2 枚', 受取方法: 'メール', メールアドレス: 'taro@example.com', 必要ポイント合計: '600 pt', 交換後の保有ポイント: '600 pt' }],
      ['AI：合計', 'X01_ai', AI]] },

  { id: 'X-02', screen: 'S05→S04', kind: '遷移', title: '〈戻る〉で入力値を保持',
    steps: '1. 確認画面で〈戻る〉', expect: '交換画面に戻り、枚数「2」・受取方法「メール」・メールアドレス「taro@example.com」を保持。',
    flow: [{ aiTap: '「戻る」ボタン' }, screen('クーポン交換'), state('X02'), shot('X-02 戻る')],
    verify: [
      ['交換画面へ戻る', 'X02.title', 'クーポン交換'],
      ['枚数を保持', 'X02.fields.qty.value', '2'],
      ['受取方法を保持', 'X02.radios.method', 'メール'],
      ['メールアドレスを保持して表示', 'X02.fields.email', partial({ value: 'taro@example.com', visible: true })]] },

  { id: 'X-03', screen: 'S05→S06', kind: '正常系', title: '交換確定と送信電文',
    steps: '1. 〈確認〉\n2. 確認画面で〈交換する〉', expect: '完了画面「クーポンの交換が完了しました。」、交換番号「EX-000001」、保有ポイント「600 pt」。\nポイント基盤 API へ POINT_USE を 1 回送信（USE_PT=600、COUPON_ID=1、MAISU=2、KOKAN_NO=EX-000001）。',
    flow: [{ aiTap: '「確認」ボタン' }, screen('交換内容の確認'), { aiTap: '「交換する」ボタン' }, shown('クーポンの交換が完了しました。'), state('X03'), shot('X-03 交換完了')],
    verify: [
      ['完了メッセージ', 'X03.status', 'クーポンの交換が完了しました。'],
      ['交換番号', 'X03.dl.交換番号', 'EX-000001'],
      ['交換後の保有ポイント', 'X03.dl.交換後の保有ポイント', '600 pt'],
      ['送信は 1 回', 'journal.ledger', count(1)],
      ['送信電文', 'journal.ledger.0', { API: 'POINT_USE', KAIIN_NO: 'M0001', USE_PT: 600, COUPON_ID: 1, MAISU: 2, KOKAN_NO: 'EX-000001' }]] },

  { id: 'X-04', screen: 'S07／S03', kind: '反映', title: '交換履歴・在庫・保有ポイントへの反映',
    steps: '1. 完了画面〈交換履歴〉\n2. クーポン一覧を開く', expect: '交換履歴に「EX-000001｜カフェ 200円引き｜2 枚｜600 pt｜メール」。\nクーポン一覧でカフェの在庫「8 枚」、保有ポイント「600 pt」。',
    flow: [{ aiTap: '「交換履歴」リンク' }, screen('交換履歴'), state('X04_history'), shot('X-04 交換履歴'),
      ...go('/coupons', 'クーポン一覧'), state('X04_list'), shot('X-04 一覧（在庫・保有ポイント）')],
    verify: [
      ['履歴の列見出し', 'X04_history.headers', ['交換番号', 'クーポン名', '枚数', '使用ポイント', '受取方法']],
      ['履歴 1 件', 'X04_history.table', [['EX-000001', 'カフェ 200円引き', '2 枚', '600 pt', 'メール']]],
      ['カフェの在庫 10→8', 'X04_list.rows.カフェ 200円引き.3', '8 枚'],
      ['保有ポイント 1,200→600', 'X04_list.balance', '600 pt']] },
  ] },
{
  file: '05-boundary', title: 'S04 業務チェック（在庫・ポイント境界）', cases: [
  { id: 'B-01', screen: 'S04 クーポン交換', kind: '業務チェック', title: '在庫を超える枚数',
    steps: '1. 書店 500円券（在庫 2）の交換画面で枚数「3」、受取方法「アプリ」\n2. 〈確認〉', expect: '画面上部に「在庫が不足しています（残り 2 枚）。」（在庫チェックはポイントより先）。交換画面のまま。',
    flow: [...go('/coupons/3/exchange', 'クーポン交換'), { aiInput: '枚数の入力欄', value: '3' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      shown('在庫が不足しています（残り 2 枚）。'), state('B01'), shot('B-01 在庫不足')],
    verify: [['在庫不足メッセージ', 'B01.alert', '在庫が不足しています（残り 2 枚）。'], ['交換画面のまま', 'B01.title', 'クーポン交換']] },

  { id: 'B-02', screen: 'S04 クーポン交換', kind: '業務チェック', title: '必要ポイント合計が保有ポイントを超える',
    steps: '1. カフェ（300 pt）の交換画面で枚数「5」（合計 1,500 pt ＞ 保有 1,200 pt）、受取方法「アプリ」\n2. 〈確認〉', expect: '画面上部に「保有ポイントが不足しています。」。交換画面のまま。',
    flow: [...go('/coupons/1/exchange', 'クーポン交換'), { aiInput: '枚数の入力欄', value: '5' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      shown('保有ポイントが不足しています。'), state('B02'), shot('B-02 ポイント不足')],
    verify: [['ポイント不足メッセージ', 'B02.alert', '保有ポイントが不足しています。'], ['交換画面のまま', 'B02.title', 'クーポン交換']] },

  { id: 'B-03', screen: 'S04→S05', kind: '境界値', title: '必要ポイント合計＝保有ポイントは交換できる',
    steps: '1. 映画 1,000円券（1,200 pt）の交換画面で枚数「1」（合計 1,200 pt ＝ 保有 1,200 pt）、受取方法「アプリ」\n2. 〈確認〉', expect: '確認画面へ進む。必要ポイント合計「1,200 pt」、交換後の保有ポイント「0 pt」（設計書 S04：同じ場合は交換できる）。',
    flow: [...go('/coupons/4/exchange', 'クーポン交換'), { aiInput: '枚数の入力欄', value: '1' }, { aiTap: '受取方法の「アプリ」ラジオボタン' }, { aiTap: '「確認」ボタン' },
      // 不具合時は交換画面のままになるため、待機の前に画面を記録して実際の表示を結果に残す
      { sleep: 1000 }, state('B03'), shot('B-03 確認（ちょうど）'), wait('「交換内容の確認」画面が表示されている', 5000)],
    verify: [
      ['確認画面へ進む', 'B03.title', '交換内容の確認'],
      ['エラーメッセージなし', 'B03.alert', absent],
      ['必要ポイント合計', 'B03.dl.必要ポイント合計', '1,200 pt'],
      ['交換後の保有ポイント 0 pt', 'B03.dl.交換後の保有ポイント', '0 pt']] },

  { id: 'B-04', screen: 'S05→S06', kind: '境界値', title: '保有ポイントちょうどの交換確定',
    steps: '1. （B-03 の続き）〈交換する〉', expect: '完了画面で保有ポイント「0 pt」。送信電文 USE_PT=1200、COUPON_ID=4、MAISU=1（このスイートで送信は 1 回のみ）。',
    flow: [{ aiTap: '「交換する」ボタン' }, shown('クーポンの交換が完了しました。'), state('B04'), shot('B-04 交換完了（0 pt）')],
    verify: [
      ['完了メッセージ', 'B04.status', 'クーポンの交換が完了しました。'],
      ['交換後の保有ポイント 0 pt', 'B04.dl.交換後の保有ポイント', '0 pt'],
      ['送信は 1 回（B-01/02 は送信しない）', 'journal.ledger', count(1)],
      ['送信電文', 'journal.ledger.0', partial({ USE_PT: 1200, COUPON_ID: 4, MAISU: 1 })]] },
  ] },
];
