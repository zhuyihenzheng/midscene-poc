# AI 引擎的真实模型运行记录

这份记录回答一个问题：框架里走 AI 的那条路（Midscene 引擎）在**真实的视觉模型**下能不能跑通。

`npm test` 里的 AI 路径测试用的是模拟模型（`test/fixture/mock-model.mjs`），回答是预先写好的，只能证明集成是对的。这里换成真实模型又跑了一次。

## 运行方式

- 日期：2026-11-10
- 对象：coupon-demo 的 `02-list`（S-01、S-02），`--engine midscene`
- 模型：Claude（Claude Code 会话里的助手本身），通过 `core/agent-model.mjs` 接入。这个桥接服务把 Midscene 的每次模型请求连同当时的截图写到磁盘，助手看截图后写下答案，Midscene 再按答案继续
- 助手作答时只看截图，没有读取 DOM
- 判定：和平时一样，按 `state()` 记录的 DOM 值判定，不依赖模型的说法

## 模型收到的请求和给出的回答

| # | 种类 | Midscene 的问题（来自 cases.mjs 的指示文） | 模型的回答 |
|---|---|---|---|
| 1 | 画面の判定 | 「マイページ」画面が表示されている | 成立：The page heading reads マイページ. |
| 2 | 位置特定 | 「クーポン一覧」リンク | bbox [300, 234, 388, 251] |
| 3 | 画面の判定 | 「クーポン一覧」画面が表示されている | 成立：The heading reads クーポン一覧 and the coupon table is shown. |
| 4 | 画面の判定 | 「ベーカリー 100円引き」の行に「在庫なし」と表示され、「交換する」リンクがない | 成立：In the ベーカリー 100円引き row the 操作 cell shows grey text 在庫なし and no 交換する link; the other three rows have the link. |
| 5 | 位置特定 | カテゴリの「飲食」ラジオボタン | bbox [351, 197, 364, 210] |
| 6 | 位置特定 | 「絞り込む」ボタン | bbox [261, 231, 366, 268] |
| 7 | 画面の判定 | 「クーポン 2 件」と表示されている | 成立：The caption above the table reads クーポン 2 件 and two rows (カフェ, ベーカリー) are listed. |

位置坐标是 1280×1000 截图上的像素。Midscene 按这些坐标做了真实的鼠标点击：#2 之后画面从"マイページ"跳到了"クーポン一覧"，#5 之后"飲食"被选中，#6 之后一览从 4 件变成 2 件。

## 结果

| 用例 | 判定 | 依据（DOM 记录值） |
|---|---|---|
| S-01 一覧の初期表示 | OK | 4 件、列见出し、各行の操作、カテゴリ初期値「すべて」、保有ポイント「1,200 pt」；AI 判定（aiAssert）也为 OK |
| S-02 カテゴリ「飲食」で絞り込み | OK | 表示 2 件（カフェ 200円引き、ベーカリー 100円引き）、选中状态「飲食」 |

## 这说明了什么，没说明什么

- 说明了：`cases.mjs` 里按标准写法写的指示文（`「クーポン一覧」リンク`、`カテゴリの「飲食」ラジオボタン` 等），真实的视觉模型看截图就能定位和判断；Midscene 引擎从 YAML 生成、CLI 执行、点击、记录到判定的整条链路在真实模型下是通的。
- 没说明：你自己用的模型（例如 LM Studio 里的 Qwen）在你的业务画面上的准确率。不同模型、不同画面差别很大，要在你的环境里实际跑一次。
- 这次只跑了 2 个用例、7 次模型调用，是可行性证据，不是准确率统计。

## 自己重现

```bash
node core/agent-model.mjs --port 8765          # 终端 1：启动桥接服务，按提示设置 4 个环境变量
node sites/coupon-demo/tests/run.mjs --engine midscene --only 02-list   # 终端 2
```

每来一个请求，`.agent-model/` 下会出现 `req-N.json` 和截图；让 Claude Code 或 Copilot（或你自己）看图后写 `ans-N.json` 即可。`aiWaitFor` 的 `timeout` 要调大，因为人工或助手作答比模型慢。
