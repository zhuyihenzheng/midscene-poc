# 新网站测试指南

本文说明怎样为一个新网站建立画面测试：要准备什么、怎么生成用例、哪些交给 GitHub Copilot、哪些必须由人来做。完整示例是 `sites/coupon-demo/`，包括设计书、站点配置、21 个用例，以及一个故意埋入的缺陷。

## 总体流程

| 步骤 | 谁来做 | 产出 |
|---|---|---|
| 0. 准备设计书、测试账号、数据重置方法 | 人 | 设计书（期望值的唯一依据）、`.env` |
| 1. 站点配置 `site.mjs` | Copilot 起草，人确认登录 | `sites/<name>/tests/site.mjs`、`run.mjs` |
| 2. 画面采集 | 脚本自动 | `inventory/inventory.md`（画面、输入项、按钮、消息、已验证的指示文） |
| 3. 观点表 | Copilot 起草，**人审查** | `観点表.md`（设计书条目对应到用例 ID） |
| 4. 用例 `cases.mjs` | Copilot | `試験仕様書.xlsx`、YAML |
| 5. 执行与分类 | Copilot 执行，**人判断缺陷** | `試験結果.xlsx`、`結果一覧.md`、证跡截图 |

第 3 步和第 5 步是人必须参与的两个关卡。Copilot 会在第 3 步停下来，等你审查观点表。

## 0. 人要准备的东西

1. **设计书**：期望值只能来自设计书，不能拿现在画面上显示的值当期望值，否则 Bug 会被当成"正确"。设计书里至少要有：
   - 画面一览；
   - 各输入项的规则（必须、类型、长度、范围）；
   - 消息原文；
   - 业务规则及其边界（例如"余额相等时可以兑换"）；
   - 后端电文的格式（如果有）。

   格式可以参考 `sites/coupon-demo/app/設計書.md`。写得越具体，Copilot 生成的用例越准。
2. **测试账号**：写在仓库根目录的 `.env`（不提交到 git），键名同步添加到 `.env.example`，值留空。
3. **数据重置与后端记录（可选，但强烈建议）**：
   - 每个 suite 开始前把数据恢复到初始状态（coupon-demo 用 `POST /__test/reset`）；
   - 能取得后端收到的请求（例如 WireMock 的请求记录；coupon-demo 用 `/__test/ledger`）。

   没有这些，就只能做画面层面的判定，而且用例之间会互相影响数据。这部分 Copilot 无法凭空写出来，需要开发方提供接口。
4. **画面的可访问性**：如果输入框有 `<label>`、单选/复选框放在 `fieldset` + `legend` 里、每个画面有 `h1`，就可以直接使用标准辞典（`core/locators.mjs` 的 `DEFAULTS`），不必写站点专用的辞典。缺少这些的画面，需要在 `sites/<name>/tests/locators.mjs` 里补充规则（写法见 `.github/instructions/site-tests.instructions.md` 的 *Site dictionary*）。

## 1〜5 的命令

以下命令都在仓库根目录执行：

```bash
node core/explore.mjs sites/<name>/tests/site.mjs                     # 2. 画面采集
node sites/<name>/tests/run.mjs --engine playwright --build-only     # 4. 生成仕様書・YAML，检查指示文能否全部解析
node sites/<name>/tests/run.mjs --engine playwright                  # 5. 执行（不需要模型）
node sites/<name>/tests/run.mjs --engine playwright --only 03-input  # 只重跑一个 suite
node sites/<name>/tests/run.mjs --engine midscene                    # 有本地模型时：用 AI 操作跑一遍
```

`--build-only` 要加上 `--engine playwright`。原因是 midscene 模式下，遇到未登录的指示文只会提示；playwright 模式下才会报错退出。`--build-only` 的成功标志是输出 `ロケーター辞書：全指示文を解決可`。

画面采集只能沿着链接（GET）进入画面。确认画面、完成画面、错误状态这类需要操作才能到达的画面，要在 `site.mjs` 的 `explore.flows` 里写好操作步骤再采集，写法参照 coupon-demo。

## 用 Copilot 自动生成用例

### VS Code 设置

- Copilot Chat 选择 **Agent** 模式，并允许它执行终端命令。
- 下列设置要开启（新版本默认开启）：
  - `chat.useAgentsMdFile`：读取 AGENTS.md；
  - `github.copilot.chat.codeGeneration.useInstructionFiles`：读取 `.github/copilot-instructions.md`；
  - `chat.includeApplyingInstructions`：编辑 `sites/**/tests/**` 时自动附加用例规范。
- 本机要有 Node 和 Chrome，并已执行 `npm install`。不需要 AI 模型。

### 使用方法

把设计书放进仓库（例如 `sites/<name>/設計書.md`），然后在 Copilot Chat 中输入：

```
/new-site-tests site=<name> design=sites/<name>/設計書.md
```

Copilot 会按 `.github/prompts/new-site-tests.prompt.md` 的顺序工作：

1. 写 `site.mjs`；
2. 运行采集；
3. 写观点表，然后**停下来等你审查**；
4. 写 `cases.mjs`；
5. 执行，并把 NG 分成"测试本身的问题"和"疑似缺陷"两类；
6. 汇报结果。

### 给 Copilot 的文件

| 文件 | 何时被读取 | 内容 |
|---|---|---|
| `AGENTS.md` | 一直（Copilot、Codex 等通用） | 仓库结构、命令、引擎说明 |
| `.github/copilot-instructions.md` | 一直 | 入口说明，以及两条原则 |
| `.github/instructions/site-tests.instructions.md` | 编辑 `sites/**/tests/**` 时自动附加 | 用例的写法规范：结构、步骤、指示文写法、判定 |
| `.github/prompts/new-site-tests.prompt.md` | 输入 `/new-site-tests` 时 | 6 步工作流程，每一步都有完成条件 |

## 审查要点

**第 3 步（观点表）**

- 设计书的每条消息、每个边界值、每条业务规则是否都有对应的用例 ID；
- 标为"不测"的项目，理由是否站得住。

**第 4 步（試験仕様書.xlsx）**

- `期待結果` 是否和设计书原文一致：数值、格式、消息文字。

**第 5 步（試験結果.xlsx）**

- 对 Copilot 标为"疑似缺陷"的用例，看证跡截图，确认是应用的问题；
- Copilot **不能**为了让用例变成 OK 去改期待值。如果发现它这样做了，直接退回。

## Copilot 做不到或做不好的事

- 没有设计书，就没有判定依据。只看画面写出来的用例只能证明"画面和现在一样"，查不出 Bug。
- 账号、数据重置接口、后端日志的取得方法，需要人提供。
- 第一次登录失败、或者登录需要 OTP、验证码时，需要人介入。
- 画面缺少 `label`、`h1` 的站点，第一次需要人确认辞典规则写得对不对。
- 公司环境的 Copilot 如果不能用 Agent 模式执行终端命令，就只能分工：Copilot 写代码，人来执行命令，再把输出贴回给 Copilot。
