# Kurari

ホワイトボード、ドキュメント、チャット、AI出力を1つの画面に統合した、AI対応チームコンテキスト管理ワークスペース。

ボード・ドキュメント・チャット・AI出力を、すべて同一のエンティティツリー上のノードとして統一管理します。

Kurari is not affiliated with Figma, FigJam, Notion, GitHub, OpenAI, or their related companies.

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

### 3. (任意) AI要約を実機で使う — Kurari Agent

ローカルAI CLI (`copilot`) がインストール・ログイン済みであること。

```bash
cd agent && npm install && npm start
```

http://localhost:5173 を開く。

- Agent 起動中: AI要約はローカルAI CLIで実行され、ステータスバーに `AI Agent: online` と表示されます
- Agent 未起動: AI要約はバックエンドの Mock 応答になります（`kurari.ai.mock=true` のとき）

## AIの仕組み（ジョブキュー＋ローカルAgent）

バックエンドはLLMを実行しません。Webアプリが AIジョブを登録すると、
あなたのPCで動く Kurari Agent が外向きポーリングでジョブを取得し、
`copilot -p <prompt> -s` を実行して結果を書き戻します。
この分離により、バックエンドを将来AWSへデプロイしてもAI機能はそのまま動きます。

## E2Eスモークテスト

backend / frontend / (任意で agent) を起動した状態で:

```bash
cd frontend && node e2e/smoke.mjs
```

ツリー同期・付箋編集・コメント・AI要約・永続化・モード切替・Document Mode
（作成・見出しのツリー同期・永続化）の14項目を検証します。

## Document Mode

Doc モードは BlockNote ベースのブロックエディタです（`# ` や `## ` のMarkdown記法で見出し）。

- 本文は document ノードの `data.content` に自動保存（800msデバウンス）
- **見出し(h1-h3)は block ノードとして左の構造ツリーに同期**され、
  ツリーの見出しクリックで該当ドキュメントの該当位置へジャンプできます
- ドキュメント選択中は Context Panel のコメントがそのドキュメントに紐づきます

## License

Kurari is released under the MIT License. See [LICENSE](LICENSE).

Third-party dependency notices are summarized in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
