# Kurari

ホワイトボード、ドキュメント、チャット、AI出力を1つの画面に統合した、AI対応チームコンテキスト管理ワークスペース。

ボード・ドキュメント・チャット・AI出力を、すべて同一のエンティティツリー上のノードとして統一管理します。
設計・実装計画の全体は [docs/PLAN.md](docs/PLAN.md) を参照してください。

## 構成

| ディレクトリ | 内容 |
|---|---|
| `frontend/` | Vite + React + TypeScript + Tailwind v4 + Zustand + React Flow |
| `backend/`  | Spring Boot 3.5 + Kotlin + PostgreSQL (JPA / Flyway) |
| `agent/`    | Kurari Agent — ローカルAI CLIを実行するAIジョブワーカー (Node.js + TS) |
| `docs/`     | 設計ドキュメント |

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

ツリー同期・付箋編集・コメント・AI要約・永続化・モード切替の10項目を検証します。
