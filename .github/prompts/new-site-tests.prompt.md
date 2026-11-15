---
name: new-site-tests
description: "Build screen tests for a new site from its design document: site config, page inventory, coverage table, cases, and a Playwright run"
argument-hint: "site=<folder name under sites/> design=<path to design document>"
agent: agent
---

# Build tests for a new site

Inputs:

- Site folder: `sites/${input:site:sites/ 配下のフォルダ名}/tests/`
- Design document: `${input:design:設計書のパス}`

Read these first:

- [AGENTS.md](../../AGENTS.md)
- [site test contract](../instructions/site-tests.instructions.md)
- The reference site: `sites/coupon-demo/tests/` (`site.mjs` and `cases.mjs`) and its design document `sites/coupon-demo/app/設計書.md`

The design document is the **oracle**. Every expected value in `expect`, `verify`, and `check` is quoted from it. The live page only tells you how to operate a screen and where to read a value. Run every command from the repository root. Always pass `--engine playwright`, because that engine needs no model and is the one that fails hard on unresolved prompts.

## 1. Site config

Run `node core/new-site.mjs <site> --url <start URL>` to create `site.mjs`, `run.mjs`, and `cases.mjs`, then adapt `site.mjs`:

- `url` and `viewport`.
- `login`, using credentials read from `process.env` inside the function. The scaffold adds the keys to `.env.example` with empty values; the user fills `.env`.
- `design`: the design document's path.
- `locators: createLocators(DEFAULTS)`.

Data reset and backend journals (`beforeSuite` / `afterSuite`) need endpoints only the team knows. Write them only when the design document or the user names such an endpoint; otherwise leave them out and note it for step 6.

**Done when** `node core/explore.mjs sites/<site>/tests/site.mjs` logs in and prints at least the first screen. If the login fails, stop and ask the user for the login screen details or credentials.

## 2. Inventory

Read `inventory/inventory.md` and compare it with the screen list in the design document. For each screen that links cannot reach (confirmation, completion, error states), add an `explore.flows` entry to `site.mjs` that drives the page there, then re-run the explorer.

**Done when** every screen in the design document appears in the inventory, or is listed in step 6 as unreachable with the reason.

If the inventory shows 解決できなかった候補, the page lacks labels or roles. Add patterns for them in `sites/<site>/tests/locators.mjs` and pass that file's table before `DEFAULTS` (see *Site dictionary* in the contract).

## 3. Coverage table

Write `観点表.md`: one row per testable item in the design document, with columns 設計書の箇所 | 観点 | 区分 | ケースID. Testable items include:

- every input field's rules (required, type, length, range);
- every message text;
- every business rule and its boundaries (equal, one over, one under);
- every screen transition and button;
- display formats;
- every backend message the design document defines.

Group cases into suites by screen or feature, and assign IDs.

**Done when** every row has a case ID, or a reason it is out of scope (for example, it needs data the site cannot reset).

**Stop here.** Show the table to the user and wait for their review before writing flows. Missing or misread items are cheapest to fix at this point.

## 4. Cases

Write `cases.mjs` following the contract:

- `makeState()` from `core/steps.mjs`, with `extra` selectors for site-specific values;
- every case from the coverage table, with `steps` and `expect` in Japanese and expected values quoted from the design document;
- flows that use only the inventory's verified prompts, or patterns you added to the site's `locators.mjs`;
- `verify` rows over recorded page state and journal entries (`check` functions only where `verify` cannot express the logic).

**Done when** `node sites/<site>/tests/run.mjs --engine playwright --build-only`

- prints `ロケーター辞書：全指示文を解決可` and no ケース定義の誤り;
- reports no 設計書に根拠のない期待値 in `観点カバレッジ.md`;
- leaves no 未対応の項目 in `観点カバレッジ.md` except items the coverage table marks out of scope;

and every value stated in a case's `expect` is asserted by a `verify` or `check` row.

## 5. Run and triage

Run `node sites/<site>/tests/run.mjs --engine playwright`, then read `結果一覧.md`. The runner classifies each failing case:

- **NG（実行不能）** and **ブロック** are test faults until proven otherwise: element not found, timeout, wrong start screen. Read `out/<suite>.log` and the failing screenshot in `evidence/`, fix the flow, the wait, or the dictionary, and re-run that suite with `--only <file>`. If the screen itself differs from the design document, treat it as a suspected defect.
- **NG（不一致）** is a suspected defect: the page shows a value that differs from the design document. Keep the expected value as written in the design document. The draft is in `不具合票ドラフト.md`.
- A **自動検査** NG (JS exception, HTTP 5xx, `undefined` on screen) is a suspected defect as well.

Never change an expected value, add a case to `baseline.json`, or add a `health.ignore` entry to make a run pass. Those are the user's decisions.

**Done when** every remaining NG case is a suspected defect, backed by its design-document value, the observed value, and the evidence screenshot.

## 6. Report

Reply with:

- the suite and case counts, and the OK / NG / ブロック result;
- each suspected defect, giving case ID, design-document value, observed value, and evidence path;
- 注意 items from the automatic checks;
- screens or rules left untested, with the reason;
- `.env` keys the user must fill;
- hooks the user should provide (data reset, backend journal);
- a reminder that the user can accept known defects with `--update-baseline` after filing them.
