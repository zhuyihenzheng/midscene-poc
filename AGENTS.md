# Repository Guidelines

## Project Structure

This repository is a browser screen-testing framework built on Midscene and Playwright. `core/` holds the site-independent framework. `sites/<name>/` holds a site's `app/` (only for demo sites) and `tests/` (`site.mjs` config, `cases.mjs`, `run.mjs`, `baseline.json`, `inventory/`). `sites/coupon-demo/` is a self-contained demo: a points-coupon site with a design document and one deliberate bug. `test/` holds the framework's own tests. The root `crm.yaml` and `crm-bug.yaml` are minimal Midscene YAML demos; `site/` and `site-bug/` contain their HTML fixtures. `midscene_run/`, `sites/*/tests/out/`, `sites/*/tests/evidence/`, `report.html`, `.test-results/`, screenshots, and logs are runtime artifacts, not source.

| `core/` module | Role |
|---|---|
| `runner.mjs` | Build → run → judge → compare with baseline → write results. Its header comment lists every option and `site.mjs` field |
| `engine-playwright.mjs` | Runs the flows with fixed locators, no model |
| `locators.mjs` | Prompt-to-locator dictionary and `DEFAULTS` |
| `steps.mjs` | `go`, `makeState`, `shot` helpers and the generic page-state recorder |
| `check.mjs` | `verify` evaluation and matchers |
| `health.mjs` | Automatic checks run for every case in Playwright mode |
| `validate.mjs`, `coverage.mjs` | Static checks of case definitions; design-document coverage |
| `visual.mjs` | Screenshot comparison for `--visual` |
| `baseline.mjs`, `report.mjs` | Known-NG comparison; xlsx / md / html / JUnit / bug-draft output |
| `explore.mjs`, `new-site.mjs` | Page inventory crawler; scaffold for a new site |
| `paths.mjs`, `browser.mjs` | Cross-platform paths; browser launch and `.env` loading |

## Development Commands

- `npm install` installs the dependencies. Playwright uses the installed Chrome or Edge; run `npx playwright install chromium` only when neither is available.
- `npm test` runs the framework's own tests: unit tests, engine tests against `test/fixture/`, and the coupon-demo suites end to end (buggy and fixed app). It needs a browser and takes about a minute. `npm run test:unit` needs no browser.
- `npm run demo` (`node sites/coupon-demo/tests/run.mjs --engine playwright`) runs the demo suites without a model; the runner starts `sites/coupon-demo/app/server.mjs` (port 8090) if it is not already running. B-03 is NG and B-04 is ブロック because of the deliberate bug; both are listed in `baseline.json`, so the run exits with code 0. `npm run demo:fixed` runs against the fixed app and writes to `.test-results/fixed/`.
- Runner options for any site's `run.mjs` (`--help` prints them): `--build-only` regenerates suite YAML, `試験仕様書.xlsx`, and `観点カバレッジ.md`, and validates the cases, without a browser; `--only 01-login` limits suites; `--eval-only` re-judges existing output; `--retries N` re-runs suites that could not be executed; `--update-baseline` saves the current NG cases as known; `--results <dir>` writes all generated files elsewhere. `--engine midscene` runs the same flows with Midscene AI operations (needs a model). The default engine is `TEST_ENGINE` from `.env`, else `midscene`. `--visual` compares each evidence screenshot with `visual-baseline/` pixel by pixel and lists differences as 注意 (`--update-visual` accepts the current screens); the baseline images are per machine and are not committed. `--ai-assert` adds AI judgement of `aiAssert` steps and `--heal` lets AI operate a step whose locator failed; both need a model.
- `node core/explore.mjs sites/<name>/tests/site.mjs` logs in, crawls the site, and writes `inventory/inventory.{json,md}`: screens, fields, buttons, tables, messages, and prompt candidates already verified against the page.
- `node core/new-site.mjs <name> --url <start URL>` scaffolds `sites/<name>/tests/`.

## Execution Engines

Each site's `cases.mjs` is the single source for both engines; do not fork flows per engine or convert them to `.spec.ts` files. In Playwright mode, the site's locator dictionary (`site.locators`) resolves each `aiTap` / `aiInput` / `aiWaitFor` prompt to a fixed locator, and `core/engine-playwright.mjs` runs the steps. Sites with proper labels, `fieldset`/`legend`, and `h1` can use `DEFAULTS` from `core/locators.mjs` alone (coupon-demo does); other sites add their own patterns in `sites/<name>/tests/locators.mjs`. When a case uses a new prompt wording, add a matching pattern to the site's dictionary. `--build-only` lists any prompt the dictionary cannot resolve. Pass/fail must stay based on DOM values and backend journals (for example WireMock requests or coupon-demo's `/__test/ledger`), because Playwright mode records `aiAssert` as not run (`未実施`).

## Verdicts and Baseline

A case is OK, NG（不一致）(a recorded value differs from the design document: suspected defect), NG（実行不能）(the flow could not run: test fault or changed screen), or ブロック (it continues from a case that failed to execute). `sites/<name>/tests/baseline.json` lists the known NG cases; the runner exits with code 1 only when a result differs from it. Do not edit expected values, the baseline, or `health.ignore` to make a run pass: whether a failure is a known defect is a human decision.

## Adding a New Site

Follow `.github/prompts/new-site-tests.prompt.md`: site config, explorer inventory, coverage table (reviewed by the user), cases, Playwright run, and triage. The file-level contract for `sites/**/tests/` is in `.github/instructions/site-tests.instructions.md`, and the human-facing guide is `docs/new-site-guide.md`. Expected values come from the site's design document; the live page only shows how to operate a screen and where to read a value.

## Style and Naming

Use two-space indentation in YAML and JavaScript. Keep scenario files in YAML and reusable case definitions or orchestration in `.mjs` files. Name numbered suites with a stable prefix and short purpose, such as `01-input`; keep case IDs stable because results, evidence, and the baseline refer to them. Follow the existing Japanese labels where they describe the target application's UI. Build file paths with `core/paths.mjs` (`here`, `ROOT`, `rel`), never with `new URL(...).pathname`: the framework must run on Windows.

## Testing Guidance

For scenario changes, run `--build-only` first to check the case definitions, the generated YAML, and the coverage report. For changes under `core/`, run `npm test` and add a test under `test/` for new behaviour. Run a site's browser suite only when its app, any backend stubs, and required credentials are available. There is no lint command. `.github/workflows/screen-tests.yml` runs `npm test` on Linux and Windows.

## Commits and Pull Requests

Use short imperative commit subjects (the initial commit is `Initial project snapshot`). PRs should describe the affected workflow, list the command(s) used for verification, and include a report or screenshot when a UI behavior changes. Call out any required local services or configuration.

## Security and Local Configuration

Keep credentials in an untracked root `.env`; never put real secrets in YAML, scripts, reports, or commits. The `.env` file supplies the Midscene model settings, each site's login fields, `TEST_ENGINE`, `TEST_BROWSER_CHANNEL` (`chrome`, `msedge`, or `chromium` for the bundled browser), `TEST_BROWSER_PATH`, and `TEST_HEADED`; `.env.example` lists every key. Session cookies and generated run output belong under ignored output directories. `report.html` embeds screenshots, so treat it like the screenshots themselves. Check `git status` before committing to ensure secrets, logs, screenshots, and generated results are not staged.
