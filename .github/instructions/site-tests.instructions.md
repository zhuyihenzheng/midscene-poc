---
applyTo: "sites/**/tests/**"
description: "Contract for writing site test files (site.mjs, cases.mjs, locators.mjs) for the core/ runner: case shape, step vocabulary, prompt wording, checks."
---

# Writing site tests

A site's tests live in `sites/<name>/tests/`. `cases.mjs` is the single source for the test specification (`試験仕様書.xlsx`), the Midscene YAML, the Playwright run, and the verdicts. `sites/coupon-demo/tests/` is the reference implementation, so copy its patterns. `core/runner.mjs` documents every `site.mjs` field in its header comment.

## Files

| File | Role |
|---|---|
| `site.mjs` | `export default { name, dir, url, viewport, cookieFile, login, locators, ... }`. Optional fields: `startApp`, `beforeSuite`/`afterSuite`, `emptyJournal`, `explore.flows`, `report` |
| `cases.mjs` | `export const SUITES = [...]` |
| `run.mjs` | `await runTests({ ...site, suites: SUITES })` (3 lines, copy from coupon-demo) |
| `locators.mjs` | Only when the inventory lists 解決できなかった候補: site patterns placed before `DEFAULTS` (see *Site dictionary* below) |
| `観点表.md` | Coverage table: design-document item → case IDs |

`login(browser, { viewport })` returns `{ context, page }`. It reads credentials from `process.env` inside the function, and every new key goes into `.env.example` with an empty value.

## Suite and case shape

```js
{ file: '03-input', title: 'S04 クーポン交換（入力チェック）', cases: [
  { id: 'E-04', screen: 'S04 クーポン交換', kind: '必須チェック', title: '未入力のまま〈確認〉',
    steps: '1. 何も入力せず〈確認〉', expect: '枚数の下に「枚数を入力してください。」。',
    flow: [...go('/coupons/1/exchange', 'クーポン交換'), { aiTap: '「確認」ボタン' },
      { aiWaitFor: '「枚数を入力してください。」と表示されている', timeout: 15000 }, state('E04'), shot('E-04 必須エラー')],
    check: o => { const e = o.E04?.errors ?? {}; return [
      ['枚数の必須エラー', e.qty === '枚数を入力してください。', e.qty]]; } },
] }
```

- `file`: `NN-purpose`, a stable 2-digit prefix. `id`: `<letter>-NN`, stable once written, because results refer to it.
- `screen`, `kind`, `title`, `steps`, and `expect` are written in Japanese and appear verbatim in `試験仕様書.xlsx`. `expect` states the concrete values from the design document: exact message text, formats such as `1,200 pt`, and counts.
- Cases in a suite run in order on one page, and a failing case stops at that case while the next case still runs. Each case either opens its start screen with `go()`, or says in `steps` that it continues from the previous case, as in `（L-03 の続き）`.

## Step vocabulary (`flow`)

| Step | Use |
|---|---|
| `{ javascript: STATE, name: 'X01' }` | Record DOM values into `o.X01` for `check`. Write it with the `state('X01')` helper |
| `{ aiTap: '<prompt>' }` | Click |
| `{ aiInput: '<prompt>', value: '...' }` | Clear and type |
| `{ aiWaitFor: '<prompt>', timeout: 15000 }` | Wait until a screen or message appears |
| `{ aiAssert: '<prompt>', name: 'X01_ai' }` | AI visual judgement, for reference only. Feed it to `check` through `ai(o.X01_ai)` |
| `{ sleep: ms }` | Only inside `go()` |
| `{ recordToReport: '<ID 説明>' }` | Evidence screenshot. Write it with the `shot()` helper |

Copy the `go`, `state`, and `shot` helpers from `sites/coupon-demo/tests/cases.mjs`.

## Prompt wording

In Playwright mode, `core/locators.mjs` `DEFAULTS` resolves prompts by regex, so the wording is fixed. Prefer the 指示文候補 lines in `inventory/inventory.md`: they are already verified to hit exactly one element.

| Kind | Wording | Resolves to |
|---|---|---|
| aiTap | `「確認」ボタン` / `「交換履歴」リンク` | button or link with that exact name |
| aiTap | `画面下部の「戻る」ボタン` | last of several same-named buttons |
| aiTap | `「カフェ 200円引き」の行の「交換する」リンク` | that element inside the table row containing the text |
| aiTap | `受取方法の「メール」ラジオボタン` / `…チェックボックス` | option inside the `fieldset` whose `legend` is 受取方法 |
| aiInput | `枚数の入力欄` | field whose label is exactly 枚数 |
| aiWaitFor | `「クーポン交換」画面が表示されている` | `h1` with that exact text |
| aiWaitFor | `「枚数を入力してください。」と表示されている` | visible text |

## Site dictionary

Use a site dictionary when a screen lacks labels, `fieldset`/`legend`, or an `h1`. Each entry pairs a regex for one prompt wording with a function `(page, match) => Locator`. `aiWaitFor` entries may return a function instead of a Locator. The site table is checked first; anything it does not match falls through to `DEFAULTS`:

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

## Snapshot function (`pageState`)

Every site needs its own `pageState()` in `cases.mjs`, because selectors differ between sites. Build it from the inventory:

- input `id`s from the 入力項目 table, giving `fields[id].value` and `visible`;
- radio `name`s, giving the checked value;
- the selector of each message, shown as `` `#qty-error` `` or `` `[role=alert]` `` on the メッセージ lines;
- `dl` label/value pairs (the 表示項目 lines);
- table rows;
- the `h1` text.

When the inventory lacks a value the design document expects, read the app's templates (if they are in the workspace), or add a `explore.flows` entry and re-run the explorer.

## Checks

`check(o, ctx)` returns `[[観点, pass, actual], ...]`.

- `o` is the suite's recorded values.
- `ctx.journal` is what `site.afterSuite` returned: backend requests or the ledger.
- `pass` is a boolean computed from recorded DOM values or journal entries, compared with design-document values.
- `actual` is the value shown in the result sheet when the check fails.
- Use `eq` and `eqObj` from `core/check.mjs` for arrays and objects.

A case is OK when it has at least one non-AI check and all of them pass. `['AI：…', ai(o.X01_ai)]` rows are informational. Read every expected value from the design document; the current page is only the source for where to read a value.
