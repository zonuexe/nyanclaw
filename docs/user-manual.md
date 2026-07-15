# nyanclaw ユーザーマニュアル

nyanclaw は Logseq（Org ファイル）を Source of Truth にした、個人向け TUI エージェントです。タスク・予定の整理に加え、会話から**決定・教訓などの durable Record**を、提案（Proposal）経由で安全に残せます。

---

## 1. 起動と基本操作

```bash
bun run start
# または
bun run dev
```

- 設定: `~/.config/nyanclaw/config.yaml`（`logseq_graph` など）
- API キー: macOS Keychain（初回利用時に対話で登録）
- 会話は自然言語。定型操作は **`/` で始まるスラッシュコマンド**
- 終了: 通常は Ctrl+C。Record の下書きオファー付き終了は `/bye`（後述）

TUI 内で `/help` を打つと、登録済みコマンドの一覧が出ます。

---

## 2. 二系統の書き込み（覚えておくこと）

| 系統 | 何をするか | いつグラフに効くか |
|------|------------|--------------------|
| **タスク / journal トラック** | TODO、メモ、引用をページや journal に直接追記 | ツール実行・コマンドの**その場** |
| **Record 学習トラック** | 決定・教訓などを **Proposal（下書き）** にしてから正本化 | **`/apply` するまで正本は増えない** |

学習トラックは Hermes 型の「勝手に memory を書き換える」ではなく、**draft → 人間が apply / reject** です。

---

## 3. スラッシュコマンド一覧

### 3.1 Record 学習（今回中心）

#### `/capture` — 下書き Proposal を作る

```text
/capture <type> <title> [| 本文...]
```

| 引数 | 説明 |
|------|------|
| `type` | `decision` / `lesson` / `preference` / `quote` / `note`（Tab 補完あり） |
| `title` | 見出し。必須 |
| `\|` 以降 | 任意の本文。複数段落は `\|` で区切るか、改行を含む文字列をそのまま |

**例**

```text
/capture decision Use Logseq as SoT | We keep one graph. No dual vault.
/capture lesson Do not free-form Org
/capture preference Prefer Japanese replies | Default language is Japanese.
```

**結果**

- ページ: `nyanclaw/proposals/<id>`（`state: pending`）
- 一覧: `nyanclaw/inbox` に 1 行追加
- **人向けの正本ページはまだ作らない**
- アクティブな TUI セッションがある場合、Proposal に **source session id** が付く（`nyanclaw/sessions/<id>` への証拠リンク）

成功メッセージに `id` と path が出ます。その `id` を `/apply` / `/reject` に使います。

---

#### `/inbox` — pending 一覧

```text
/inbox
```

pending の Proposal を `id`・type・title で列挙します。空ならその旨を表示します。

---

#### `/apply` — 正本 Record にする

```text
/apply <proposal-id>
```

| 処理 | 内容 |
|------|------|
| 正本 | `Records/<type>/<title>` 形式の論理ページを作成 |
| Proposal | `state` を `applied` に更新 |
| inbox | 当該 id の行を除去 |
| audit | `nyanclaw/audit` に 1 行 |

既に `applied` / `rejected` の id はエラーになります。二重 apply はしません。

---

#### `/reject` — 下書きを捨てる

```text
/reject <proposal-id>
```

- Proposal の `state` を `rejected`
- inbox から除去
- audit に記録
- **正本は作らない**（ページ自体はグラフに残り、物理削除はしない）

---

#### `/bye` — セッション終了オファー

黙って Proposal は作りません。**確認付き**の一度きりの案内です。

| 入力 | 動作 |
|------|------|
| `/bye` | 会話のメッセージ数を示し、draft するかどうかを案内するだけ |
| `/bye yes` または `/bye -y` | **直近のユーザー発話最大 5 件**を雑に `decision` 候補として Proposal 化 |
| 会話が空 | 何も書かず終了メッセージ |

`/bye yes` の抽出はヒューリスティックです。種別やタイトルをきちんと付けたいときは `/capture` を使ってください。

**推奨フロー**

```text
/bye
→ 内容を確認
/bye yes          # または手で /capture ...
/inbox
/apply <id>       # or /reject <id>
```

---

### 3.2 その他のコマンド

| コマンド | 説明 |
|----------|------|
| `/help` | コマンド一覧 |
| `/journal` | 今日の Logseq journal をエージェントに読ませる |
| `/model` / `/model list` | プロファイル一覧 |
| `/model <name>` | プロファイル切替（次ターンから） |
| `/sync-gh` / `/gh-sync-all` | GitHub watched / maintained を Logseq に同期 |
| `/clear` | 会話履歴をクリア（グラフ上の Session 証拠は別途残っている場合あり） |
| `/onboard` | USER.md / SOUL.md のオンボーディングを再実行 |
| `/reset-key` / `/reset-key <provider>` | Keychain の API キー削除（再起動で再入力） |

---

## 4. 典型的な使い方

### 4.1 決定を残す

```text
/capture decision Prefer structured Org writes | Free-form content broke event pages.
/inbox
/apply decision_2026-07-16T...   # inbox に出た id
```

Logseq で `Records/decision/...` と `nyanclaw/proposals/...` を確認できます。

### 4.2 会話のあとまとめて候補を出す

```text
（普段どおり会話）
/bye
/bye yes
/inbox
/reject ...    # 不要なもの
/apply ...     # 残すもの
```

### 4.3 タスクを journal に足す（学習トラックではない）

自然言語で「今日の journal に TODO を…」と頼むと、エージェントは **`logseq_append_block`** などを使います（即時書き込み）。`/capture` は使いません。

### 4.4 長文を引用・記録する（即時）

「この概要をイベントページに引用して」→ エージェントは **`logseq_append_quote`** を使います。  
`#+BEGIN_QUOTE` / `#+END_QUOTE` はツール側が付けます。モデルに Org 構文を書かせません。

後から学習トラックに載せたい場合は、同じ内容を `/capture quote ...` して `/apply` しても構いません。

---

## 5. Logseq 上の置き場

設定の `logseq_graph` 配下（ファイルベース Org）です。

| 論理ページ | 用途 |
|------------|------|
| 通常の `pages/` / `journals/` | タスク、人向けメモ、正本 Record |
| `Records/<type>/<title>` | `/apply` 後の正本 |
| `nyanclaw/inbox` | pending 一覧 |
| `nyanclaw/proposals/<id>` | Proposal 本体 |
| `nyanclaw/sessions/<id>` | 会話の証拠（Session）。自動では正本にならない |
| `nyanclaw/audit` | apply / reject の追記ログ |

`nyanclaw/` 配下は機械向けですが、Logseq から開いて読んでも問題ありません。  
グラフ外に別の「長期 memory ツリー」は作りません。

---

## 6. エージェントが使う Logseq ツール（参考）

ユーザーが直接叩くコマンドではありません。会話から呼ばれます。

| ツール | 用途 |
|--------|------|
| `logseq_read_journal` | journal の構造化読み取り（TODO / WAITING / DONE など） |
| `logseq_search` | グラフ内検索 |
| `logseq_append_block` | 見出し・TODO などの構造化追記 |
| `logseq_append_note` | 短いプレーン行メモ |
| `logseq_append_quote` | 複数段落の引用（BEGIN/END_QUOTE はツールが付与） |
| `logseq_set_todo` | 既存タスクの TODO/DONE/WAITING をタイトル一致で変更 |

**やってはいけないこと（エージェント側）**

- ツール引数に `*` や `-` の Org マーカー、`#+BEGIN_QUOTE` を自分で書くこと
- 自由形式の生 Org をそのまま append すること（旧 `logseq_write_block` はデフォルト無効）

緊急時のみ環境変数 `NYANCLAW_ORG_LEGACY_WRITE=1` で旧経路が残りますが、通常は使いません。

---

## 7. トラブルシュート

| 症状 | 確認すること |
|------|----------------|
| `/capture` が失敗する | `logseq_graph` が設定されているか。タイトルが空でないか |
| `/inbox` が空なのに Proposal ページがある | inbox 行が消えただけかも。`pages` の `nyanclaw/proposals` を直接見る |
| `/apply` が already applied | その id は処理済み。inbox の別 id を使う |
| journal の Org が壊れる | 構造化ツール経由か確認。手編集と競合していないか |
| Session が残らない | ターン完了（`agent_end`）後に書かれる。失敗時は stderr に `[nyanclaw session]` が出ることがある（会話自体は落ちない） |

---

## 8. 関連ドキュメント

| 文書 | 内容 |
|------|------|
| [`CONTEXT.md`](../CONTEXT.md) | 用語（Session / Record / Proposal など） |
| [`docs/adr/0004-logseq-as-universal-store.md`](adr/0004-logseq-as-universal-store.md) | Logseq 一本化の決定 |
| [`docs/design/safe-deterministic-org-mode-writes.md`](design/safe-deterministic-org-mode-writes.md) | 構造化 Org 書き込みの設計 |

実装の詳細や issue 履歴より、**日常の操作**はこのマニュアルを優先してください。
