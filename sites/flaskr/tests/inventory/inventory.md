# 画面一覧（自動採取）

採取日：2026-11-12　対象：http://127.0.0.1:8096/　5 画面

> ケース起草の入力用。期待値は必ず設計書から取ること（この一覧は「どう操作し、どこから値を読むか」の根拠）。

## Posts（/）

- リンク：Flaskr（/）／Register（/auth/register）／Log In（/auth/login）

指示文候補（標準辞書で解決を確認済み）：

- `aiWaitFor` 「Posts」画面が表示されている
- `aiTap` 「Flaskr」リンク
- `aiTap` 「Register」リンク
- `aiTap` 「Log In」リンク

## Register（/auth/register）

| 入力項目 | 型 | name / id | 必須 | 補足 | 表示 |
|---|---|---|---|---|---|
| Username | text | username / username | ○ |  |  |
| Password | password | password / password | ○ |  |  |

- ボタン：Register
- リンク：Flaskr（/）／Register（/auth/register）／Log In（/auth/login）

指示文候補（標準辞書で解決を確認済み）：

- `aiWaitFor` 「Register」画面が表示されている
- `aiInput` Usernameの入力欄
- `aiInput` Passwordの入力欄
- `aiTap` 「Register」ボタン
- `aiTap` 「Flaskr」リンク
- `aiTap` 「Register」リンク
- `aiTap` 「Log In」リンク

## Log In（/auth/login）

| 入力項目 | 型 | name / id | 必須 | 補足 | 表示 |
|---|---|---|---|---|---|
| Username | text | username / username | ○ |  |  |
| Password | password | password / password | ○ |  |  |

- ボタン：Log In
- リンク：Flaskr（/）／Register（/auth/register）／Log In（/auth/login）

指示文候補（標準辞書で解決を確認済み）：

- `aiWaitFor` 「Log In」画面が表示されている
- `aiInput` Usernameの入力欄
- `aiInput` Passwordの入力欄
- `aiTap` 「Log In」ボタン
- `aiTap` 「Flaskr」リンク
- `aiTap` 「Register」リンク
- `aiTap` 「Log In」リンク

## Log In（操作：Log In 画面）

| 入力項目 | 型 | name / id | 必須 | 補足 | 表示 |
|---|---|---|---|---|---|
| Username | text | username / username | ○ |  |  |
| Password | password | password / password | ○ |  |  |

- ボタン：Log In
- リンク：Flaskr（/）／Register（/auth/register）／Log In（/auth/login）

指示文候補（標準辞書で解決を確認済み）：

- `aiWaitFor` 「Log In」画面が表示されている
- `aiInput` Usernameの入力欄
- `aiInput` Passwordの入力欄
- `aiTap` 「Log In」ボタン
- `aiTap` 「Flaskr」リンク
- `aiTap` 「Register」リンク
- `aiTap` 「Log In」リンク

## New Post（操作：alice でログインして New Post）

| 入力項目 | 型 | name / id | 必須 | 補足 | 表示 |
|---|---|---|---|---|---|
| Title | text | title / title | ○ |  |  |
| Body | textarea | body / body |  |  |  |

- ボタン：Save
- リンク：Flaskr（/）／Log Out（/auth/logout）

指示文候補（標準辞書で解決を確認済み）：

- `aiWaitFor` 「New Post」画面が表示されている
- `aiInput` Titleの入力欄
- `aiInput` Bodyの入力欄
- `aiTap` 「Save」ボタン
- `aiTap` 「Flaskr」リンク
- `aiTap` 「Log Out」リンク

