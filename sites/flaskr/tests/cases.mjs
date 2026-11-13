// Flaskr（Flask 公式チュートリアルのアプリ）画面試験：ケース定義
// 期待値はすべて sites/flaskr/設計書.md（チュートリアルとアプリのソース）から取る。画面は英語なので、指示文の「…」の中は英語の表示名。
// 試験の計画（対象アプリの選定・観点・ケース）は Fable 5.2 が立て、実装と実行は Opus 5.5 が行った（sites/flaskr/README.md）。
import { makeState, go, shot, answerDialog } from '../../../core/steps.mjs';
import { count, includes, matches, not, where } from '../../../core/check.mjs';
import site, { USERS } from './site.mjs';

const state = makeState(site.state);
const wait = (text, timeout = 15000) => ({ aiWaitFor: text, timeout });
const screen = title => wait(`「${title}」画面が表示されている`);
const tap = name => ({ aiTap: `「${name}」ボタン` });
const link = name => ({ aiTap: `「${name}」リンク` });
const input = (label, value) => ({ aiInput: `${label}の入力欄`, value });
// 投稿の一覧は表ではなく article.post の並びなので、ここで記録する（タイトル・by 行・本文・Edit リンクの有無）
const posts = name => ({ name, javascript: `[...document.querySelectorAll('article.post')].map(a => ({
  title: a.querySelector('h1')?.innerText.trim(), about: a.querySelector('.about')?.innerText.trim(),
  body: a.querySelector('.body')?.innerText.trim(), edit: !!a.querySelector('a.action') }))\n` });
// 画面の入力チェック（required）を外してサーバー側のチェックを確かめる（チュートリアル templates.rst が勧める確かめ方）
// 一覧のタイトルの並び（記録した投稿の配列に対して使う）
const titles = list => where(`タイトルが ${list.join('、')} の順`, v => Array.isArray(v) && JSON.stringify(v.map(p => p.title)) === JSON.stringify(list));
const dropRequired = id => ({ javascript: `document.getElementById('${id}').removeAttribute('required');\n` });
const login = user => [...go('/auth/login', 'Log In'), input('Username', user), input('Password', USERS[user]), tap('Log In'), screen('Posts')];

export const SUITES = [
{
  file: '01-auth', title: 'S02 Register・S03 Log In', cases: [
  { id: 'A-01', screen: 'S02 Register', kind: '初期表示', title: '登録画面の初期表示',
    steps: '1. 未ログインで Register 画面を開く', expect: '見出し「Register」。Username・Password は空。ナビに「Register」「Log In」リンク、「Log Out」はない。',
    flow: [...go('/auth/register', 'Register'), state('A01'), shot('A-01 Register 画面')],
    verify: [
      ['見出し', 'A01.title', 'Register'],
      ['Username は空', 'A01.fields.username.value', ''],
      ['Password は空', 'A01.fields.password.value', ''],
      ['ナビ（未ログイン）', 'A01.links', includes('Log In')],
      ['ナビに Log Out はない', 'A01.links', not(includes('Log Out'))]] },

  { id: 'A-02', screen: 'S02 Register', kind: '必須チェック', title: '未入力のまま〈Register〉',
    steps: '1. （A-01 の続き）何も入力せず〈Register〉', expect: 'ブラウザが送信させない（required）。Register 画面のまま、Username・Password は入力チェック NG。',
    flow: [tap('Register'), state('A02'), shot('A-02 未入力')],
    verify: [
      ['送信されず Register 画面のまま', 'A02.path', '/auth/register'],
      ['Username は必須で NG', 'A02.fields.username.valid', false],
      ['Password は必須で NG', 'A02.fields.password.valid', false],
      ['サーバーのエラーは出ない', 'A02.alert', null]] },

  { id: 'A-03', screen: 'S02 Register', kind: '重複チェック', title: '登録済みのユーザー名で登録',
    steps: '1. Username「alice」（登録済み）、Password「x」\n2. 〈Register〉', expect: '画面上部に「User alice is already registered.」。Register 画面のまま。',
    flow: [...go('/auth/register', 'Register'), input('Username', 'alice'), input('Password', 'x'), tap('Register'),
      wait('「User alice is already registered.」と表示されている'), state('A03'), shot('A-03 重複')],
    verify: [['重複のメッセージ', 'A03.alert', 'User alice is already registered.'], ['Register 画面のまま', 'A03.title', 'Register']] },

  { id: 'A-04', screen: 'S02→S03', kind: '正常系', title: '新しいユーザーを登録',
    steps: '1. Username「carol」、Password「carol-pw」\n2. 〈Register〉', expect: 'Log In 画面へ（views.rst：登録後はログイン画面）。',
    flow: [...go('/auth/register', 'Register'), input('Username', 'carol'), input('Password', 'carol-pw'), tap('Register'), screen('Log In'), state('A04'), shot('A-04 登録後')],
    verify: [['Log In 画面へ', 'A04.title', 'Log In'], ['URL', 'A04.path', '/auth/login'], ['エラーなし', 'A04.alert', null]] },

  { id: 'A-05', screen: 'S03 Log In', kind: '異常系', title: '存在しないユーザーでログイン',
    steps: '1. Username「nobody」、Password「x」\n2. 〈Log In〉', expect: '「Incorrect username.」。Log In 画面のまま。',
    flow: [...go('/auth/login', 'Log In'), input('Username', 'nobody'), input('Password', 'x'), tap('Log In'),
      wait('「Incorrect username.」と表示されている'), state('A05'), shot('A-05 ユーザーなし')],
    verify: [['メッセージ', 'A05.alert', 'Incorrect username.'], ['Log In 画面のまま', 'A05.title', 'Log In']] },

  { id: 'A-06', screen: 'S03 Log In', kind: '異常系', title: 'パスワード誤り',
    steps: '1. Username「alice」、Password「wrong」\n2. 〈Log In〉', expect: '「Incorrect password.」。Log In 画面のまま。',
    flow: [...go('/auth/login', 'Log In'), input('Username', 'alice'), input('Password', 'wrong'), tap('Log In'),
      wait('「Incorrect password.」と表示されている'), state('A06'), shot('A-06 パスワード誤り')],
    verify: [['メッセージ', 'A06.alert', 'Incorrect password.'], ['Log In 画面のまま', 'A06.title', 'Log In']] },

  { id: 'A-07', screen: 'S03→S01', kind: '正常系', title: '正しいパスワードでログイン',
    steps: '1. Username「alice」、Password「alice-pw」\n2. 〈Log In〉', expect: 'Posts 画面へ。ナビにユーザー名「alice」と「Log Out」、「Register」はない。見出しの横に「New」。',
    flow: [...login('alice'), state('A07'), shot('A-07 ログイン後')],
    verify: [
      ['Posts 画面へ', 'A07.path', '/'],
      ['見出し', 'A07.title', 'Posts'],
      ['ユーザー名を表示', 'A07.text', includes('alice')],
      ['Log Out リンク', 'A07.links', includes('Log Out')],
      ['Register リンクはない', 'A07.links', not(includes('Register'))],
      ['New リンク', 'A07.links', includes('New')]] },

  { id: 'A-08', screen: 'S01', kind: 'ログアウト', title: '〈Log Out〉',
    steps: '1. （A-07 の続き）ナビの〈Log Out〉', expect: 'Posts 画面のまま未ログインに戻る。ナビに「Log In」、「Log Out」「New」はない。',
    flow: [link('Log Out'), screen('Posts'), state('A08'), shot('A-08 ログアウト後')],
    verify: [
      ['Posts 画面', 'A08.path', '/'],
      ['Log In リンクが戻る', 'A08.links', includes('Log In')],
      ['Log Out はない', 'A08.links', not(includes('Log Out'))],
      ['New はない', 'A08.links', not(includes('New'))]] },
  ] },
{
  file: '02-guard', title: '未ログインの権限', seed: { bobPost: 'Hello from bob' }, cases: [
  { id: 'G-01', screen: 'S04', kind: '認可', title: '未ログインで New Post を開く',
    steps: '1. 未ログインで /create を開く', expect: 'Log In 画面へ移る（login_required）。',
    flow: [...go('/create', 'Log In'), state('G01'), shot('G-01 /create')],
    verify: [['Log In 画面へ', 'G01.path', '/auth/login']] },

  { id: 'G-02', screen: 'S05', kind: '認可', title: '未ログインで Edit を開く',
    steps: '1. 未ログインで /1/update（bob の投稿）を開く', expect: 'Log In 画面へ移る。',
    flow: [...go('/1/update', 'Log In'), state('G02'), shot('G-02 /1/update')],
    verify: [['Log In 画面へ', 'G02.path', '/auth/login']] },

  { id: 'G-03', screen: 'S01 Posts', kind: '表示', title: '未ログインで一覧を見る',
    steps: '1. 未ログインで Posts を開く', expect: 'bob の投稿「Hello from bob」を「by bob on YYYY-MM-DD」付きで表示。Edit・New リンクはない。',
    flow: [...go('/', 'Posts'), posts('G03_posts'), state('G03'), shot('G-03 未ログインの一覧')],
    verify: [
      ['投稿 1 件', 'G03_posts', count(1)],
      ['タイトル', 'G03_posts.0.title', 'Hello from bob'],
      ['by 行（ユーザー名と日付）', 'G03_posts.0.about', matches(/^by bob on \d{4}-\d{2}-\d{2}$/)],
      ['Edit リンクはない', 'G03_posts.0.edit', false],
      ['New リンクはない', 'G03.links', not(includes('New'))]] },
  ] },
{
  file: '03-post', title: 'S04 New Post・S05 Edit', cases: [
  { id: 'P-01', screen: 'S04→S01', kind: '正常系', title: '投稿を作る',
    steps: '1. alice でログイン\n2. 〈New〉、Title「First」、Body「Hello」\n3. 〈Save〉', expect: 'Posts 画面へ。先頭の投稿がタイトル「First」、「by alice on YYYY-MM-DD」、本文「Hello」、Edit リンクあり。',
    flow: [...login('alice'), link('New'), screen('New Post'), input('Title', 'First'), { aiInput: 'Bodyの入力欄', value: 'Hello' }, tap('Save'),
      screen('Posts'), posts('P01_posts'), state('P01'), shot('P-01 投稿後')],
    verify: [
      ['Posts 画面へ', 'P01.path', '/'],
      ['投稿 1 件', 'P01_posts', count(1)],
      ['先頭の投稿', 'P01_posts.0.title', 'First'],
      ['by 行', 'P01_posts.0.about', matches(/^by alice on \d{4}-\d{2}-\d{2}$/)],
      ['本文', 'P01_posts.0.body', 'Hello'],
      ['自分の投稿には Edit', 'P01_posts.0.edit', true]] },

  { id: 'P-02', screen: 'S04 New Post', kind: '必須チェック', title: 'Title を空のまま〈Save〉',
    steps: '1. （P-01 の続き）〈New〉\n2. Title を空のまま〈Save〉', expect: 'ブラウザが送信させない（required）。New Post 画面のまま。',
    flow: [link('New'), screen('New Post'), tap('Save'), state('P02'), shot('P-02 Title 未入力')],
    verify: [['送信されず New Post のまま', 'P02.path', '/create'], ['Title は必須で NG', 'P02.fields.title.valid', false]] },

  { id: 'P-03', screen: 'S04 New Post', kind: 'サーバー側チェック', title: 'required を外して Title 空で送信',
    steps: '1. （P-02 の続き）Body「keep me」\n2. Title の required を外して〈Save〉（チュートリアル templates.rst の確かめ方）', expect: '画面上部に「Title is required.」。New Post 画面のまま、Body の入力値を保持。',
    flow: [{ aiInput: 'Bodyの入力欄', value: 'keep me' }, dropRequired('title'), tap('Save'), wait('「Title is required.」と表示されている'), state('P03'), shot('P-03 サーバー側チェック')],
    verify: [['メッセージ', 'P03.alert', 'Title is required.'], ['New Post 画面のまま', 'P03.title', 'New Post'], ['Body を保持', 'P03.fields.body.value', 'keep me']] },

  { id: 'P-04', screen: 'S04→S01', kind: '並び順', title: '2 件目は先頭に・Body は空でよい',
    steps: '1. （P-03 の続き）1 秒あけて Title「Second」、Body は空で〈Save〉', expect: '一覧は新しい順で「Second」「First」。Body が空でも保存できる。',
    // 作成日時は秒単位のため、1 秒以上あけないと並び順が決まらない
    flow: [...go('/create', 'New Post'), { sleep: 1100 }, input('Title', 'Second'), tap('Save'), screen('Posts'), posts('P04_posts'), shot('P-04 並び順')],
    verify: [
      ['新しい順', 'P04_posts', titles(['Second', 'First'])],
      ['Second の本文は空', 'P04_posts.0.body', '']] },

  { id: 'P-05', screen: 'S05 Edit', kind: '初期表示', title: 'Edit 画面の初期表示',
    steps: '1. （P-04 の続き）「First」の〈Edit〉', expect: '見出し「Edit "First"」。Title「First」、Body「Hello」が入っている。',
    flow: [{ aiTap: '「First」の投稿の「Edit」リンク' }, screen('Edit "First"'), state('P05'), shot('P-05 Edit 画面')],
    verify: [['見出し', 'P05.title', 'Edit "First"'], ['Title', 'P05.fields.title.value', 'First'], ['Body', 'P05.fields.body.value', 'Hello']] },

  { id: 'P-06', screen: 'S05→S01', kind: '更新', title: 'タイトルを変えて保存',
    steps: '1. （P-05 の続き）Title を「First v2」にして〈Save〉', expect: 'Posts 画面へ。一覧に「First v2」があり「First」はない。',
    flow: [input('Title', 'First v2'), tap('Save'), screen('Posts'), posts('P06_posts'), shot('P-06 更新後')],
    verify: [['タイトルの並び', 'P06_posts', titles(['Second', 'First v2'])]] },

  { id: 'P-07', screen: 'S05 Edit', kind: '削除キャンセル', title: '〈Delete〉の確認でキャンセル',
    steps: '1. （P-06 の続き）「First v2」の〈Edit〉\n2. 〈Delete〉、確認ダイアログでキャンセル', expect: '確認ダイアログ「Are you sure?」。キャンセルすると Edit 画面のまま。',
    flow: [{ aiTap: '「First v2」の投稿の「Edit」リンク' }, screen('Edit "First v2"'), answerDialog('cancel'), tap('Delete'), state('P07'), shot('P-07 削除キャンセル')],
    verify: [['確認ダイアログ', 'P07.dialogs', ['Are you sure?']], ['Edit 画面のまま', 'P07.title', 'Edit "First v2"']] },

  { id: 'P-08', screen: 'S05→S01', kind: '削除', title: '〈Delete〉で削除',
    steps: '1. （P-07 の続き）〈Delete〉、確認ダイアログで OK', expect: '確認ダイアログ「Are you sure?」のあと Posts 画面へ。「Second」だけが残る。',
    flow: [tap('Delete'), screen('Posts'), state('P08'), posts('P08_posts'), shot('P-08 削除後')],
    verify: [['確認ダイアログ', 'P08.dialogs', ['Are you sure?']], ['Posts 画面へ', 'P08.path', '/'], ['残りは Second だけ', 'P08_posts', titles(['Second'])]] },
  ] },
{
  file: '04-authz', title: '他人の投稿・存在しない投稿', seed: { bobPost: 'Hello from bob' }, cases: [
  { id: 'Z-01', screen: 'S01 Posts', kind: '表示', title: '他人の投稿には Edit がない',
    steps: '1. alice でログインして Posts を見る', expect: 'bob の投稿「Hello from bob」に Edit リンクがない。New リンクはある。',
    flow: [...login('alice'), posts('Z01_posts'), state('Z01'), shot('Z-01 他人の投稿')],
    verify: [['bob の投稿', 'Z01_posts.0.title', 'Hello from bob'], ['Edit リンクはない', 'Z01_posts.0.edit', false], ['New リンクはある', 'Z01.links', includes('New')]] },

  { id: 'Z-02', screen: 'S05', kind: '認可', title: '他人の投稿の Edit を直接開く',
    steps: '1. （Z-01 の続き）/1/update（bob の投稿）を開く', expect: '403 Forbidden。',
    flow: [...go('/1/update', 'Forbidden'), state('Z02'), shot('Z-02 403')],
    verify: [['403 Forbidden', 'Z02.title', 'Forbidden']] },

  { id: 'Z-03', screen: 'S05', kind: '存在チェック', title: '存在しない投稿の Edit を開く',
    steps: '1. /999/update を開く', expect: '404 Not Found。本文に「Post id 999 doesn\'t exist.」。',
    flow: [...go('/999/update', 'Not Found'), state('Z03'), shot('Z-03 404')],
    verify: [['404 Not Found', 'Z03.title', 'Not Found'], ['メッセージ', 'Z03.text', includes("Post id 999 doesn't exist.")]] },
  ] },
];
