---
applyTo: "sites/**/tests/**"
description: "Contract for writing site test files (site.mjs, cases.mjs, locators.mjs) for the core/ runner: case shape, step vocabulary, prompt wording, checks, verdicts."
---

# Writing site tests

A site's tests live in `sites/<name>/tests/`. `cases.mjs` is the single source for the test specification (`試験仕様書.xlsx`), the Midscene YAML, the Playwright run, and the verdicts. Copy the patterns of the reference implementations: `sites/coupon-demo/tests/` for screens with labels, `fieldset`/`legend`, and `h1`; `sites/legacy-demo/tests/` for older screens (table-layout forms without labels, no `h1`, `alert`/`confirm` dialogs, results rendered asynchronously). `core/runner.mjs` documents every `site.mjs` field and every runner option in its header comment.

## Files

| File | Role |
|---|---|
| `site.mjs` | `export default { name, dir, url, viewport, cookieFile, login, locators, ... }`. Optional fields: `design`, `state`, `dialogs`, `startApp`, `beforeSuite`/`afterSuite`, `emptyJournal`, `settle`, `health`, `visual`, `explore.flows`, `report` |
| `cases.mjs` | `export const SUITES = [...]` |
| `run.mjs` | `await runTests({ ...site, suites: SUITES })` (3 lines) |
| `baseline.json` | Known NG cases. Written by `run.mjs --update-baseline`; a human adds the `note` (ticket number, reason) |
| `locators.mjs` | Only when the inventory lists 解決できなかった候補: site patterns placed before `DEFAULTS` (see *Site dictionary* below) |
| `観点表.md` | Coverage table written for human review: design-document item → case IDs |

`node core/new-site.mjs <name> --url <start URL>` creates `site.mjs`, `run.mjs`, and `cases.mjs` from a template.

In `site.mjs`, build paths with `here(import.meta.url)` from `core/paths.mjs` (never `new URL(...).pathname`, which breaks on Windows). `login(browser, { viewport })` returns `{ context, page }`. It reads credentials from `process.env` inside the function, and every new key goes into `.env.example` with an empty value. Set `design` to the design document's path so the runner can check coverage.

## Suite and case shape

```js
import { makeState, go, shot } from '../../../core/steps.mjs';
import { AI, absent, count, includes, partial } from '../../../core/check.mjs';
const state = makeState({ extra: { balance: '#balance' } });

{ file: '03-input', title: 'S04 クーポン交換（入力チェック）', cases: [
  { id: 'E-04', screen: 'S04 クーポン交換', kind: '必須チェック', title: '未入力のまま〈確認〉',
    steps: '1. 何も入力せず〈確認〉', expect: '枚数の下に「枚数を入力してください。」。交換画面のまま。',
    flow: [...go('/coupons/1/exchange', 'クーポン交換'), { aiTap: '「確認」ボタン' },
      { aiWaitFor: '「枚数を入力してください。」と表示されている', timeout: 15000 }, state('E04'), shot('E-04 必須エラー')],
    verify: [
      ['枚数の必須エラー', 'E04.errors.qty', '枚数を入力してください。'],
      ['交換画面のまま', 'E04.title', 'クーポン交換']] },
] }
```

- `file`: `NN-purpose`, a stable 2-digit prefix. `id`: uppercase letters, a hyphen, digits (`E-04`); stable once written, because results, evidence files, and `baseline.json` refer to it.
- `screen`, `kind`, `title`, `steps`, and `expect` are written in Japanese and appear verbatim in `試験仕様書.xlsx`. Put the design document's screen ID in `screen` (`S04 クーポン交換`, `S05→S06`); the coverage report matches on it. `expect` states the concrete values from the design document: exact message text, formats such as `1,200 pt`, and counts.
- Cases in a suite run in order on one page. A case whose `flow` starts with `go()` is independent. A case whose `flow` does not start with `go()` continues from the previous case's screen; say so in `steps`, as in `（L-03 の続き）`. When a case fails to execute, the cases that continue from it are reported as ブロック and are not run, and the next independent case runs normally.

## Step vocabulary (`flow`)

| Step | Use |
|---|---|
| `...go('/path', '画面名')` | Open a URL (relative to `site.url`) and wait for the `h1`. Becomes `page.goto` in Playwright and `javascript` + `sleep` in the Midscene YAML |
| `state('X01')` | Record the page state into `X01` for `verify`. From `makeState()` |
| `{ aiTap: '<prompt>' }` | Click |
| `{ aiHover: '<prompt>' }` | Hover (resolved with the `aiTap` dictionary) |
| `{ aiInput: '<prompt>', value: '...' }` | Clear and type. When the target is a `select`, `value` is the option's visible text |
| `{ aiKeyboardPress: 'Enter' }` | Press a key |
| `{ aiWaitFor: '<prompt>', timeout: 15000 }` | Wait until a screen or message appears (or disappears) |
| `{ aiAssert: '<prompt>', name: 'X01_ai' }` | AI visual judgement, for reference only. Verify it with `['AI：…', 'X01_ai', AI]` |
| `{ sleep: ms }` | Only when a value must be recorded before a wait that may fail (see B-03 in coupon-demo) |
| `answerDialog('cancel')` | Answer the next `confirm` / `prompt` with cancel (or pass a string to type into a `prompt`). Applies to one dialog. Needs `site.dialogs = true` |
| `shot('<ID 説明>')` | Evidence screenshot. The label starts with the case ID |

`{ javascript: '…', name: 'X01' }` is available for values `state()` does not cover. Every recorded `name` is unique within a suite.

## Recorded page state

`state('X01')` records one object. Read the paths below in `verify`:

| Path | Value |
|---|---|
| `X01.title` / `X01.path` | `h1` text / URL path |
| `X01.fields.<id or name>` | `{ value, visible, disabled, readonly, invalid, text }` for inputs, textareas, and selects (`text` is the selected option's label) |
| `X01.checks.<id or name>` / `X01.radios.<name>` | checkbox state / checked radio value (or `null`) |
| `X01.errors.<field>` | visible field error text. The key is the error element's `id` without `-error`, or the field that points to it with `aria-describedby` |
| `X01.alert` / `X01.status` | first visible `[role=alert]` / `[role=status]` text, or `null` |
| `X01.dl.<item name>` | the value beside it: a `dt`/`dd` pair, or a two-cell row of `th` + `td` (table-style detail screens) |
| `X01.dialogs` | messages of the `alert` / `confirm` / `prompt` dialogs shown since the previous `state()`. Needs `site.dialogs = true` |
| `X01.headers` / `X01.table` / `X01.caption` | header texts / body rows as arrays of cell texts / caption, of the first table that has a header row |
| `X01.rows.<first cell text>` | that row's cells. `X01.rowActions.<first cell text>` lists the row's link and button texts |
| `X01.text` | visible text of `main` (or `body`), for `includes('…')` |
| `X01.buttons` / `X01.links` | visible button / link texts |

Pass site-specific selectors to `makeState({ titleSelector, errorSelector, alertSelector, statusSelector, extra: { name: '<css selector>' } })`. `titleSelector` names the heading element on screens without an `h1`. An `extra` entry appears at the top level (`X01.balance`). Take the selectors from the inventory's メッセージ and 入力項目 lines. Keep the options in `site.state` and write `makeState(site.state)`, so the explorer reads headings the same way.

### Dialogs

Older screens report input errors and ask for confirmation with browser dialogs, which are not in the DOM. With `dialogs: true` in `site.mjs`, the runner replaces `alert` / `confirm` / `prompt` in the page: each message is recorded, and the dialog is answered OK unless an `answerDialog('cancel')` step precedes the operation. Verify the messages with `['ダイアログ', 'X01.dialogs', ['登録します。よろしいですか？']]`. Put `answerDialog('cancel')` before an operation that must not go through if a defect lets a confirm dialog appear (see T-05 in legacy-demo).

## Checks

`verify` is a list of `[観点, path, expected]`. The path's first segment is a recorded name, or `journal` for what `site.afterSuite` returned (backend requests or the ledger). Use an array path when a key contains a dot.

`expected` is a literal (strings, numbers, arrays, and objects compare for exact equality) or a matcher from `core/check.mjs`:

| Matcher | Passes when |
|---|---|
| `absent` / `present` | the value is empty (`undefined`, `null`, `''`, `false`) / not empty |
| `count(n)` | the array or object has `n` entries |
| `includes('…')` | the string or array contains it |
| `matches(/…/)` | the string matches |
| `partial({ … })` | the listed keys match; other keys are ignored |
| `every(x)` / `not(x)` / `oneOf(a, b)` | every element matches / the value does not match / the value matches one of them |
| `AI` | the `aiAssert` result is OK (reference only; 未実施 in Playwright mode) |

For logic that does not fit, add `check: (o, ctx) => [[観点, pass, actual], ...]` beside or instead of `verify`. `o` is the suite's recorded values and `ctx.journal` the journal.

Read every expected value from the design document; the current page is only the source for where to read a value. `--build-only` lists message-like expected values that do not appear in the design document (設計書に根拠のない期待値); fix those by checking the design document, never by trusting the page.

## Verdicts

| Verdict | Meaning | What to do |
|---|---|---|
| OK | every non-AI check passed and the flow ran to the end | — |
| NG（不一致） | a value was read and differs from the expected value | Suspected defect. A draft is written to `不具合票ドラフト.md` |
| NG（実行不能） | the flow could not run, so values are missing | Test fault or changed screen: fix the flow, the dictionary, or the wait |
| ブロック | the case continues from a case that failed to execute | Resolve the earlier case, then re-run |

In Playwright mode every case also gets automatic checks (`core/health.mjs`): an uncaught JS exception, an HTTP 5xx response, a broken image, or visible `undefined` / `NaN` / `[object Object]` text makes the case NG; horizontal overflow, clipped text, unlabeled inputs, duplicate ids, `console.error`, and same-origin 4xx responses are listed as 注意 without changing the verdict. Exclude a known false positive with `site.health = { ignore: [/regex on "種別：内容"/] }`.

With `--visual`, each `shot()` is also compared with the image in `visual-baseline/` (registered on the first run, per machine, not committed). A difference is a 注意 with a diff image, not an NG. Mask elements that change on every run with `site.visual = { mask: ['#clock'], threshold: 0.001 }`.

`baseline.json` holds the known NG cases. The runner exits with code 1 only for results that differ from it (新規NG, NG内容の変化). Never add a case to the baseline to make a run pass: a human decides that a failure is a known defect and writes the `note`.

## Prompt wording

In Playwright mode, `core/locators.mjs` `DEFAULTS` resolves prompts by regex, so the wording is fixed. Prefer the 指示文候補 lines in `inventory/inventory.md`: they are already verified to hit exactly one element.

| Kind | Wording | Resolves to |
|---|---|---|
| aiTap | `「確認」ボタン` / `「交換履歴」リンク` | button or link with that exact name |
| aiTap | `画面下部の「戻る」ボタン` | last of several same-named buttons |
| aiTap | `「カフェ 200円引き」の行の「交換する」リンク` | that element inside the table row containing the text |
| aiTap | `受取方法の「メール」ラジオボタン` / `…チェックボックス` | option inside the `fieldset` whose `legend` is 受取方法 |
| aiTap | `「同意する」チェックボックス` / `「明細」タブ` / `「設定」メニュー` | checkbox, radio, tab, or menu item with that exact name |
| aiInput | `枚数の入力欄` / `都道府県の選択欄` | field whose label is exactly that text |
| aiInput | `「山田 太郎」の行の数量の入力欄` | labeled field inside that table row |
| aiInput | `顧客名の入力欄` with `TABLE_FORM` | the control in the same table row as the cell that starts with 顧客名 (forms without labels) |
| aiTap | `至急のチェックボックス` with `TABLE_FORM` | the checkbox in that row |
| aiWaitFor | `「クーポン交換」画面が表示されている` | `h1` with that exact text |
| aiWaitFor | `「枚数を入力してください。」と表示されている` | visible text |
| aiWaitFor | `「読み込み中」が表示されていない` | waits until the text is gone |

## Site dictionary

For table-layout forms without labels, start with the ready-made `TABLE_FORM` table: `createLocators(SITE, TABLE_FORM, DEFAULTS)`. It resolves `<項目名>の入力欄` / `の選択欄` / `のチェックボックス` to the control beside the item-name cell, and still prefers a real label when one exists.

Use a site dictionary for what remains: a screen without an `h1`, an input with neither label nor item-name cell. Each entry pairs a regex for one prompt wording with a function `(page, match) => Locator`. `aiWaitFor` entries may also return a function (a condition evaluated in the page) or `{ locator, state: 'hidden' }`. The site table is checked first; anything it does not match falls through to `DEFAULTS`:

```js
// sites/<name>/tests/locators.mjs
import { createLocators, DEFAULTS } from '../../../core/locators.mjs';
const SITE = {
  aiInput: [[/^検索キーワードの入力欄$/, page => page.locator('#q')]],                          // input without a label
  aiWaitFor: [[/^「メニュー」画面が表示されている$/, page => page.getByRole('button', { name: '新規申請' })]], // screen without an h1
};
export const locators = createLocators(SITE, DEFAULTS);
```

Use this file's `locators` as `site.locators`. Keep the prompt wording in the same 「…」 style so Midscene reads it naturally.

## Before running

`node sites/<name>/tests/run.mjs --engine playwright --build-only` needs no browser. It must print `ロケーター辞書：全指示文を解決可` and report no ケース定義の誤り (duplicate IDs, a `verify` path whose name no step records, an evidence label without the case ID, a case without checks). With `site.design` set, it also writes `観点カバレッジ.md`: design-document screens and messages without a case, and expected values without a basis in the design document.
