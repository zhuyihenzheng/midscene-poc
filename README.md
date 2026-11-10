# 画面自动测试框架（Midscene + Playwright）

根据设计书编写一份用例（`cases.mjs`），自动完成：操作浏览器、判定结果、和上次结果比较、输出試験仕様書、試験結果、证跡截图和缺陷票草稿。

- **不需要大模型**：默认用 Playwright 引擎，按固定定位器操作，按 DOM 值和后端记录判定。
- **也能用 AI**：同一份用例可以用 Midscene 引擎跑（由 AI 看画面操作），或者只在定位器失效时让 AI 接手（`--heal`）。
- **人只看有变化的地方**：已知的 NG 记在 `baseline.json` 里，只有和它不同的结果才算失败。

## 快速开始（Windows / macOS / Linux）

需要 [Node.js](https://nodejs.org) 20 以上，以及 Chrome 或 Edge。

```bash
git clone https://github.com/zhuyihenzheng/midscene-poc.git
cd midscene-poc
npm install
copy .env.example .env      # macOS / Linux：cp .env.example .env
npm run demo
```

`npm run demo` 会启动自带的演示站点（积分兑换优惠券，端口 8090）并执行 23 个用例，约 40 秒。演示站点故意埋了一个缺陷，所以结果是 21 OK、1 NG（B-03）、1 ブロック（B-04）；这两个已登记在基准里，命令正常结束。

执行后打开 `sites/coupon-demo/tests/report.html` 看结果。

没有 Chrome 和 Edge 时，执行 `npx playwright install chromium`，并把 `.env` 里的 `TEST_BROWSER_CHANNEL` 改成 `chromium`。

## 输出

都在 `sites/<站点>/tests/` 下：

| 文件 | 内容 |
|---|---|
| `report.html` | 单文件报告，内嵌截图。想定外、NG 排在最前面 |
| `試験仕様書.xlsx` | 用例一览（操作手順、期待結果） |
| `試験結果.xlsx` | 判定、各观点的期待值和实测值、证跡 |
| `結果一覧.md` | 结果摘要 |
| `不具合票ドラフト.md` | 每个疑似缺陷的手顺、期待、实际、证跡 |
| `観点カバレッジ.md` | 设计书的画面、消息有没有对应用例；期待值在设计书里有没有依据 |
| `evidence/`、`out/` | 截图、Playwright Trace、JUnit XML、日志 |

## 判定结果怎么读

| 判定 | 含义 | 该做什么 |
|---|---|---|
| OK | 全部观点一致 | — |
| NG（不一致） | 读到了值，但和设计书不同 | 疑似缺陷，看缺陷票草稿后起票 |
| NG（実行不能） | 操作不了，没读到值 | 画面改了，或者测试本身有问题，修用例或辞典 |
| ブロック | 前一个用例中断，没有执行 | 先解决前一个 |

每个用例还会自动检查：JS 异常、HTTP 5xx、画面上出现 `undefined` / `NaN`、图片加载失败（算 NG）；横向滚动条、文字被截断、输入框没有 label（只提示）。

加上 `--visual` 后，每张证跡截图会和 `visual-baseline/` 里的基准图片比较，不同的地方以"注意"列出并附差分图。第一次执行会自动登记基准；有意的界面改动用 `--update-visual` 接受。图片会因系统和字体而不同，所以基准保存在各自的电脑上，不进仓库。

确认某个 NG 是已知缺陷后，执行 `node sites/<站点>/tests/run.mjs --update-baseline` 登记到 `baseline.json`，并在 `note` 里写上票号。之后只有新出现的 NG、内容变了的 NG 才会让命令以失败结束。

## 常用命令

```bash
npm run demo                                        # 执行演示站点
npm run demo:fixed                                  # 用修好缺陷的演示站点执行（结果在 .test-results/fixed/）
node sites/<站点>/tests/run.mjs --help              # 所有选项
node sites/<站点>/tests/run.mjs --build-only        # 不开浏览器：检查用例写法、生成仕様書和覆盖率
node sites/<站点>/tests/run.mjs --only 03-input     # 只跑一个 suite
node sites/<站点>/tests/run.mjs --retries 1         # 操作失败的 suite 重跑一次
node sites/<站点>/tests/run.mjs --visual            # 把截图和基准图片逐像素比较，发现布局、颜色的变化
node core/new-site.mjs <站点> --url <起始URL>       # 生成新站点的模板
node core/explore.mjs sites/<站点>/tests/site.mjs   # 采集画面（输入项、按钮、消息）
npm test                                            # 框架自身的测试
```

## 给新网站建测试

见 [docs/new-site-guide.md](docs/new-site-guide.md)。用 GitHub Copilot 时输入 `/new-site-tests site=<站点> design=<设计书路径>`；用 Claude Code 时让它按 `.github/prompts/new-site-tests.prompt.md` 的流程做。

## 用 AI 模型（可选）

在 `.env` 里填 `MIDSCENE_MODEL_*`（OpenAI 兼容接口，本地 LM Studio 或云端 API 都可以），然后：

- `--engine midscene`：全部操作由 AI 完成；
- `--engine playwright --ai-assert`：操作用 Playwright，只有 `aiAssert` 的目视判断交给 AI；
- `--engine playwright --heal`：定位器失效的步骤由 AI 代为操作，并在结果里列出需要修改的辞典条目。

## CI

`.github/workflows/screen-tests.yml` 在 Linux 和 Windows 上执行 `npm test`，并把演示站点的报告存为 artifact。要定期测试实际站点，复制这个文件，把最后一步换成该站点的 `run.mjs`，账号用仓库的 Secrets 传入。
