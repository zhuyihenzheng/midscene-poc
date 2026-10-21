# Repository Guidelines

## Project Structure

This repository is a browser screen-testing framework built on Midscene and Playwright. The root `crm.yaml` and `crm-bug.yaml` are minimal Midscene YAML demos; `site/` and `site-bug/` contain their HTML fixtures. `core/` holds the site-independent test framework: runner, Playwright engine, locator dictionary, page explorer, and check helpers. `sites/<name>/` holds a site's `app/` (only for demo sites) and `tests/` (`site.mjs` config, `cases.mjs`, `run.mjs`, `inventory/`). `sites/coupon-demo/` is a self-contained demo: a points-coupon site with a design document and one deliberate bug. `midscene_run/`, `sites/*/tests/out/`, screenshots, and logs are runtime artifacts, not source.

## Development Commands

- `npm install` installs the Midscene, Playwright, and ExcelJS dependencies.
- `npx midscene crm.yaml` runs the CRM demo against its local fixture.
- `node sites/coupon-demo/tests/run.mjs --engine playwright` runs the demo site suites without a model; the runner starts `sites/coupon-demo/app/server.mjs` (port 8090) if it is not already running. B-03/B-04 are expected NG because of the deliberate bug; `COUPON_DEMO_FIXED=1` runs against the fixed app.
- Runner options for any site's `run.mjs`: `--build-only` regenerates suite YAML and `試験仕様書.xlsx` without a browser; `--only 01-login` limits suites; `--eval-only` re-judges existing output. `--engine midscene` runs the same flows with Midscene AI operations (needs the local LM). The default engine is `TEST_ENGINE` from `.env`, else `midscene`. `--ai-assert` adds AI judgement of `aiAssert` steps to a Playwright run.
- `node core/explore.mjs sites/<name>/tests/site.mjs` logs in, crawls the site, and writes `inventory/inventory.{json,md}`: screens, fields, buttons, tables, messages, and prompt candidates already verified against the page.

## Execution Engines

Each site's `cases.mjs` is the single source for both engines; do not fork flows per engine or convert them to `.spec.ts` files. In Playwright mode, the site's locator dictionary (`site.locators`) resolves each `aiTap` / `aiInput` / `aiWaitFor` prompt to a fixed locator, and `core/engine-playwright.mjs` runs the steps. Sites with proper labels, `fieldset`/`legend`, and `h1` can use `DEFAULTS` from `core/locators.mjs` alone (coupon-demo does); other sites add their own patterns in `sites/<name>/tests/locators.mjs`. When a case uses a new prompt wording, add a matching pattern to the site's dictionary. `--build-only` lists any prompt the dictionary cannot resolve. Pass/fail must stay based on DOM values and backend journals (for example WireMock requests or coupon-demo's `/__test/ledger`), because Playwright mode records `aiAssert` as not run (`未実施`).

## Adding a New Site

Follow `.github/prompts/new-site-tests.prompt.md`: site config, explorer inventory, coverage table (reviewed by the user), cases, Playwright run, and triage. The file-level contract for `sites/**/tests/` is in `.github/instructions/site-tests.instructions.md`, and the human-facing guide is `docs/new-site-guide.md`. Expected values come from the site's design document; the live page only shows how to operate a screen and where to read a value.

`npm test` is currently a placeholder that exits with an error; there is no configured automated unit-test suite. Do not treat it as a passing verification command.

## Style and Naming

Use two-space indentation in YAML and JavaScript. Keep scenario files in YAML and reusable case definitions or orchestration in `.mjs` files. Name numbered suites with a stable prefix and short purpose, such as `01-input.yaml`; keep case IDs stable because result evaluation refers to them. Follow the existing Japanese labels where they describe the target application's UI.

## Testing Guidance

For scenario changes, run `--build-only` first to check generated YAML and specification output. Run a browser suite only when its app, any backend stubs, and required credentials are available. Review generated reports manually; this repository has no test coverage threshold or lint command.

## Commits and Pull Requests

Use short imperative commit subjects (the initial commit is `Initial project snapshot`). PRs should describe the affected workflow, list the command(s) used for verification, and include a report or screenshot when a UI behavior changes. Call out any required local services or configuration.

## Security and Local Configuration

Keep credentials in an untracked root `.env`; never put real secrets in YAML, scripts, reports, or commits. The `.env` file supplies the Midscene model settings, each site's login fields, `TEST_ENGINE`, `TEST_BROWSER_CHANNEL` (`chrome`, `msedge`, or empty for bundled Chromium), and `TEST_HEADED`; `.env.example` lists every key. Session cookies and generated run output belong under ignored output directories. Check `git status` before committing to ensure secrets, logs, screenshots, and generated results are not staged.
