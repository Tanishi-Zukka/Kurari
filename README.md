# Kurari

ホワイトボード、ドキュメント、チャット、AI出力を1つの画面に統合した、AI対応チームコンテキスト管理ワークスペース。

ボード・ドキュメント・チャット・AI出力を、すべて同一のエンティティツリー上のノードとして統一管理します。

Kurari is not affiliated with Figma, FigJam, Notion, GitHub, OpenAI, or their related companies.

## 紹介サイト

Kurariの紹介サイトはGitHub Pagesで公開します。

- 公開URL: https://tanishi-zukka.github.io/Kurari/
- ソース: `docs/`
- デプロイ: `main` ブランチの `docs/` 更新時にGitHub Actionsで自動実行

リポジトリの **Settings → Pages → Build and deployment → Source** は
**GitHub Actions** を選択してください。

## 構成

| ディレクトリ | 内容 |
|---|---|
| `frontend/` | Vite + React + TypeScript + Tailwind v4 + Zustand + React Flow |
| `backend/`  | Spring Boot 3.5 + Kotlin + PostgreSQL (JPA / Flyway) |
| `agent/`    | Kurari Agent — ローカルAI CLIを実行するAIジョブワーカー (Node.js + TS) |

## 起動方法（ローカル開発）

### 1. DB (PostgreSQL 16) — 2通り

```bash
# a) Docker がある場合
docker compose up -d
cd backend && ./gradlew bootRun

# b) Docker が使えない場合（Embedded PostgreSQL。backend/data/pg に永続化）
cd backend && ./gradlew bootRun --args='--spring.profiles.active=embedded'
```

### 2. frontend (:5173)

```bash
cd frontend && npm install && npm run dev
```

### 3. (任意) AI機能を実機で使う — Kurari Agent

ローカルAI CLI (`copilot`) がインストール・ログイン済みであること。

```bash
cd agent && npm install && npm start
```

Agent は起動時に使えるAIエンジンをすべて検出して公開します。
**ジョブごとに使用エンジンを切り替え可能です**（Agent の再起動は不要）。
選択肢はステータスバー / Chat タブ / AI Mode 内の RunnerSelect から操作：

- **Copilot CLI** — `copilot` がインストール・ログイン済みのとき
- **Apple Intelligence** — macOS 26+ / Apple Silicon。初回起動時に Swift ラッパー
  （`agent/apple/`）を自動ビルド（Xcode Command Line Tools が必要）。
  オンデバイスモデルはコンテキストが小さいため、長い入力は自動で中間を省略します。
  ネットワーク不要・無料で動くのが利点です
- **Ollama** — `http://localhost:11434` で起動中のとき。モデルは
  `--ollama-model <name>`（既定はインストール済みの先頭）、URLは `--ollama-url` で変更可能

http://localhost:5173 を開く。

- Agent 起動中: AI機能はローカルAI CLIで実行され、ステータスバーに `AI Agent: online` と表示されます
- Agent 未起動: AI機能はバックエンドの Mock 応答になります（`kurari.ai.mock=true` のとき）

## AIの仕組み（ジョブキュー＋ローカルAgent）

バックエンドはLLMを実行しません。Webアプリが AIジョブを登録すると、
あなたのPCで動く Kurari Agent が外向きポーリングでジョブを取得し、
`copilot -p <prompt> -s` を実行して結果を書き戻します。
種別ごとのプロンプト（instruction）はバックエンドがジョブに同梱するため、
Agent はジョブ種別を知りません（種別追加で Agent の更新は不要）。
この分離により、バックエンドを将来AWSへデプロイしてもAI機能はそのまま動きます。

### AI機能一覧

#### AIチャット
- **Chat タブ**（右パネル） — 開いているボード/ドキュメントが自動的に文脈として含まれます
- **AI Mode 内チャット** — プロジェクト全体を横断的に検索・質問できます
- 履歴は `chat_room`/`message` ノードとしてツリーに保存され、
  AI応答はサーバー側で書き込まれるためブラウザを閉じても履歴が欠けません

#### AI Mode（/ai）
プロジェクト全体を分析する専用画面。以下の3つの分析タイプから選択：

- **プロジェクト説明** — 新規参加者向けにボード・ドキュメント全体を要約
- **矛盾検出** — ボード・ドキュメント・チャット間の矛盾や齟齬を検出し、修正提案を表示
- **意思決定抽出** — 決定事項・未解決事項・TODOを自動抽出。
  `decision`/`open_question` ノードとして「意思決定ログ」に保存可能

#### ボードAI
- **ボード要約** — 付箋・テキストカードの内容を要約（カード・ツリー保存が可能）
- **選択要素の要約→配置** — 選択した複数要素を要約し、新しい付箋として自動配置
- **ブレスト生成** — テーマキーワード入力で関連付箋を一括生成（いずれも Undo 対応、AI付箋は青色）

#### ドキュメントAI
- **AI下書き** — 指示文を入力してカーソル位置に挿入（インラインで継続生成も可）
- **続きの生成** — テキスト選択後に「続きを生成」で段落を拡張
- **要約** — ドキュメント全体またはセクションを要約（文末挿入またはツリー保存）
- **録音メモ** — マイクで音声録音 → 自動文字起こし（Web Speech API） + AI要約 →
  音声ブロック＋テキスト+要約を本文に挿入（手ぶらで思考をキャプチャ可能）

## E2Eスモークテスト

backend / frontend / (任意で agent) を起動した状態で:

```bash
cd frontend && node e2e/smoke.mjs
```

以下の約30項目を検証します：
- ツリー同期・付箋編集・コメント・永続化
- UI モード切替（Board / Document / AI Mode）
- Document Mode（見出し・インデント・テキストエディタ）
- AI 機能：ボード要約・選択要素の要約・ブレスト生成
- Chat タブ（ボード/ドキュメント文脈）＋プロジェクト横断チャット（AI Mode）
- AI Mode での分析（プロジェクト説明・矛盾検出・意思決定抽出）
- ドキュメント AI（下書き・続き生成・要約・録音メモ）

Agent 未起動でも Mock 応答で全項目が通ります。

## Document Mode

Doc モードは BlockNote ベースのブロックエディタです（`# ` や `## ` のMarkdown記法で見出し）。

- 本文は document ノードの `data.content` に自動保存（800msデバウンス）
- **見出し(h1-h3)は block ノードとして左の構造ツリーに同期**され、
  ツリーの見出しクリックで該当ドキュメントの該当位置へジャンプできます
- ドキュメント選択中は Context Panel のコメントがそのドキュメントに紐づきます

## License

Kurari is released under the MIT License. See [LICENSE](LICENSE).

Third-party dependency notices are summarized in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
