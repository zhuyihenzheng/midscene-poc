# Flaskr：外部の実在アプリへの適用

このフレームワークの作者が書いたものではないアプリに、どこまでそのまま使えるかを確かめた記録。対象は Flask 3.1.3 の公式チュートリアルのブログアプリ「Flaskr」（登録・ログイン・投稿の作成・編集・削除）。

- 計画（対象アプリの選定・設計書の根拠・観点・ケース）：Fable 5.2
- 実装・実行・分析：Opus 5.5

## 準備と実行

アプリはリポジトリに含めず、`.ext/`（.gitignore 済み）に取得する。

```bash
git clone --depth 1 --branch 3.1.3 https://github.com/pallets/flask .ext/flask
python3 -m venv .ext/venv
.ext/venv/bin/pip install flask==3.1.3          # Windows：.ext\venv\Scripts\pip install flask==3.1.3
node sites/flaskr/tests/run.mjs --engine playwright
```

アプリは試験の実行時に自動で起動する（ポート 8096。`FLASKR_PORT` で変更）。スイートごとに `flask init-db` で DB を空にし、アプリ自身の画面（エンドポイント）から試験ユーザー alice・bob を登録する。

## 結果

- 設計書：`sites/flaskr/設計書.md`（期待値はすべてチュートリアルの本文とアプリのソースの行番号に基づく）
- 4 スイート・22 ケース、**22/22 OK**
- 観点カバレッジ：設計書の 10 項目中 8 項目。未対応の 2 項目（Username is required.／Password is required.）は、ブラウザの `required` が空の送信を止めるため画面からは出せない（チュートリアル templates.rst の説明どおり）。Title is required. は、チュートリアルが勧める「required を外して送る」方法で P-03 が確かめている

### 不具合を仕込んで検出できるかの確認

アプリのソースに 4 種類の不具合を入れて実行した（確認後に元に戻した）。

| 仕込んだ不具合 | 検出したケース | 判定 |
|---|---|---|
| 一覧を古い順にした（ORDER BY created ASC） | P-04、P-06 | NG（不一致） |
| エラー文言の句点を削った（Incorrect password） | A-06 | NG（不一致）期待「Incorrect password.」実測「Incorrect password」 |
| 他人の投稿の編集を許した（403 の判定を外した） | Z-02 | NG（不一致） |
| 削除の確認ダイアログを外した | P-07 | NG（不一致）、P-08 は連鎖して実行不能 |

4 件すべて検出し、それ以外のケースは OK のまま（誤検出なし）。

## 適用して分かったこと（フレームワークに反映済み）

| 見つかった問題 | 対応 |
|---|---|
| 画面採取（explore）がデータを用意できず、最初の画面が 500 エラー・ログインできない | `site.explore.setup` を追加（採取の前に 1 回呼ぶ） |
| 観点カバレッジが「。」で終わる日本語の文言しか拾わず、英語のメッセージを数えない | 設計書の表の「メッセージ」列も拾うようにした |
| ブラウザの `required` で送信が止められたことを判定できない | 画面状態の入力欄に `valid`（ブラウザの入力チェックの結果）を追加 |
| 期待したメッセージ・画面を待っている間に止まると、実際の画面を記録せず「実行不能」（試験側の問題）に分類され、アプリの不具合が見えなくなる | 待ちで止まったときは残りの記録だけ行い、実測値つきで「不一致」にする。`--retries` は待ちで止まったケースもやり直す |

## サイト固有の設定（site.mjs）

- 見出し：ナビの「Flaskr」と投稿タイトルも h1 のため、`state.titleSelector` と待ちの辞書を `section.content > header > h1`（エラー画面は `body > h1`）にした
- エラー表示：`div.flash` を `state.alertSelector` に指定
- ボタン：ナビの「Log In」「Register」リンクと同名のため、ボタンは画面本体の中だけを探す辞書を 1 行追加
- 投稿の一覧は表ではない（`article.post`）ため、一覧の記録は cases.mjs の `posts()` で行う

辞書の追加は 4 パターン。フレームワークの本体（core/）はサイト固有の変更なしで使えた。
