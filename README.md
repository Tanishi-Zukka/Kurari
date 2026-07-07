# Kurari

ホワイトボード、ドキュメント、チャット、AI出力を1つの画面に統合した、AI対応チームコンテキスト管理ワークスペース。

ボード・ドキュメント・チャット・AI出力を、すべて同一のエンティティツリー上のノードとして統一管理します。
設計・実装計画の全体は [docs/PLAN.md](docs/PLAN.md) を参照してください。

## 構成

| ディレクトリ | 内容 |
|---|---|
| `frontend/` | Vite + React + TypeScript + Tailwind + Zustand + React Flow |
| `backend/`  | Spring Boot 3 + Kotlin + PostgreSQL (JPA / Flyway) |
| `agent/`    | Kurari Agent — ローカルAI CLIを実行するAIジョブワーカー (Node.js + TS) |
| `docs/`     | 設計ドキュメント |

## 起動方法（ローカル開発）

```bash
# 1. DB (PostgreSQL 16)
docker compose up -d

# 2. backend (:8080)
cd backend && ./gradlew bootRun

# 3. frontend (:5173)
cd frontend && npm install && npm run dev

# 4. (任意) AI要約を実機で使う場合: Kurari Agent
#    ローカルAI CLI (`copilot`) がインストール・ログイン済みであること
cd agent && npm install && npm start
```

http://localhost:5173 を開く。

Agent を起動しない場合、AI要約はバックエンドの Mock 応答（`kurari.ai.mock=true` 時）になります。
