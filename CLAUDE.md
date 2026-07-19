# CLAUDE.md

Kurari — ボード(FigJam風)・ドキュメント・チャット・AI出力を単一のエンティティツリーで統合するワークスペース。
セットアップ手順・構成の全体像は [README.md](README.md) を参照。

## 構成

- `frontend/` — Vite + React + TS + Tailwind v4 + Zustand + React Flow (@xyflow/react v12)
- `backend/` — Spring Boot 3.5 + Kotlin + PostgreSQL (JPA + Flyway、`ddl-auto: validate`)
- `agent/` — AIジョブワーカー（バックエンドはLLMを実行しない）。起動時に
  copilot / Apple Intelligence（`agent/apple/` の Swift ラッパーを自動ビルド、長文は中間省略）/
  Ollama を全部チェックし、使えるものを heartbeat でページに公開。
  **実行エンジンはページ上のセレクタでジョブごとに選択**（`payload.runner`、agent再起動不要）

## 起動・検証コマンド

```bash
# backend (:8080) — Docker PG がある場合は docker compose up -d を先に
cd backend && ./gradlew bootRun
# Docker なし: embedded PG（backend/data/pg に永続化。Docker側とはデータ別物）
cd backend && ./gradlew bootRun --args='--spring.profiles.active=embedded'

# frontend (:5173) — 自己署名 HTTPS（https://localhost:5173）。LAN にも公開される
cd frontend && npm run dev

# 検証
cd frontend && npx tsc -b          # 型チェック（lint は oxlint）
cd backend && ./gradlew compileKotlin
cd frontend && node e2e/smoke.mjs  # E2Eスモーク(50項目)。両サーバ起動が前提。mockなら約3分、実agent接続時はAI待ちが増える
```

- スキーマ変更は Flyway マイグレーション必須（`backend/src/main/resources/db/migration/V*.sql`）。
  適用にはバックエンド再起動が必要（gradle daemon が温まっていれば数秒で起動する）。
- E2Eスモークは冒頭でシードワークスペースの残骸（`スモーク*`・`(empty sticky)` 等と全エッジ）を
  API 経由で掃除してから走る。要素はビューポート中央に作られて積み重なるため、
  掃除なしで繰り返すとクリック横取りでフレークする。

## データモデル（重要）

- ほぼ全エンティティが `nodes` テーブル1本の **KNode ツリー**（workspace/board/sticky/document/…）。
  種別ごとの属性は `data` JSONB に持つ（例: ボード要素は `x,y,w,h`、色、テキスト）。
- ボードの矢印だけは `edges` テーブル（KEdge）。描画属性（線種 shape・色・太さ・
  接続アンカー sourceAnchor/targetAnchor・曲げ bend）は `edges.data` JSONB。
- 開発シードのワークスペース ID は `00000000-0000-0000-0000-000000000001`、
  First Board は `...0003`。E2E やデバッグスクリプトはこれを直接叩く。
- 変更は REST（`/api/nodes`, `/api/edges`）＋ WebSocket ブロードキャストで全クライアント同期。
- 全文検索は全ノードを保持するフロントの `lib/search.ts` がクライアント側で線形走査する。
  検索結果からの画面遷移は `useNavigateToNode` を再利用する。
- **presence（オンライン一覧・カーソル・編集中）は DB に持たずメモリ管理**（`ws/PresenceRegistry`）。
  WS `/ws` は双方向で、クライアントが `presence.join` / `presence.update` を送る（他は従来どおり受信専用）。
  ユーザー識別はローカル（localStorage `kurari.identity`、users テーブルなし）。
  フロントは `stores/presence-store.ts` が peers（低頻度）/ cursors（20Hz）を分割保持
  — Header 等は peers だけ購読し、カーソル毎の再レンダーを避ける。
- **LAN 共有はオーナー承認制**（`access/` パッケージ、メモリ管理）。オーナー = 実効 IP が
  loopback。実効 IP は「Vite プロキシ（xfwd）が付ける X-Forwarded-For の**末尾要素**」で判定
  （先頭は偽装可能なので使わない。`access/ClientIp.kt`）。localhost 直叩き（agent・E2E・curl）
  は XFF なし = オーナー扱いなので**認可の追加対応は不要**。メンバーは REST が
  `Authorization: Bearer`、WS が `?token=`（`lib/access-token.ts` が保管ハブ）。
  API を新設したら自動的にゲート配下に入る（認可前に呼ばせたい場合のみ
  `AccessInterceptor.isPreAuth` の許可リストへ追加）。
- **通話（Call Mode）は WebRTC P2P メッシュ**。backend はシグナリング中継のみ
  （`ws/CallRegistry` メモリ管理、`EventBroadcaster` が `call.join/leave/media/signal` を処理。
  `call.signal` は宛先 sessionId へ不透過中継）。フロントは `stores/call-store.ts` が
  RTCPeerConnection を sessionId ごとに管理 — glare は perfect negotiation（polite = sessionId
  の小さい側）。**シグナル処理はピアごとに直列化 + remoteDescription 確定前の candidate は
  キュー必須**（並行処理すると candidate が捨てられ ICE が `new` のまま繋がらない）。
  `iceServers: []`（LAN の host candidate 直結、STUN なし）。WS 再接続 = sessionId が変わる =
  全 PeerConnection 破棄して `call.join` 再送で張り直し。メディア資産は store のモジュール変数
  持ちなので `/call` を離れても通話は継続する（CallMode の unmount で cleanup しないこと）。
  画面共有は `call.media` の `screenStreamId` と、参加者ごとに保持した複数 MediaStream の id を
  突き合わせてカメラ映像と識別する。
  E2E のカメラは fake device フラグ（`--use-fake-device-for-media-stream` — **`-capture` ではない**）
  + mDNS 匿名化の無効化が必要（smoke.mjs の launch 参照）。

## AIジョブの約束事

- ジョブ種別は `backend/.../ai/AiJobType.kt` に集約（11種）。**instruction（システムプロンプト）は
  backend がジョブの payload に同梱**し、agent は instruction + context + prompt を結合して
  `copilot` を実行するだけ。**種別を追加しても agent の改修は不要**
  （AiJobType に enum 追加 + `AiJobService.buildContext` の分岐 + `mockResult` の3点だけ）。
- 構造化出力（brainstorm / detect_conflicts / extract_decisions）はJSONを指示し、
  **パースはフロント**（`lib/ai-json.ts` の `parseAiJson` → 失敗時 `fallbackLines`）。
  mock モードでもJSON系は妥当なJSONを返すので、E2E は mock（agent 停止）で全経路が通る。
- `chat_reply` と `call_minutes` は backend が complete 時に、それぞれ AI の `message` ノードと
  「通話議事録」document ノードを作る（`AiJobService.finalizeJob`。ブラウザが閉じていても成果物が欠けない）。
  チャット履歴は対象ノード直下の `chat_room` / `message` ノード。
- フロントのジョブ追跡は `lib/use-ai-job.ts`（WS `ai_job.updated` → ai-job-store + ポーリング併用）。
  **前回ジョブの結果を挿入系UIで再利用しないよう、待機はジョブIDと紐づける**（DocAiToolbar 参照）。
- AIが作ったボード付箋は `data.aiGenerated: true`（色は blue）。E2Eの掃除対象。

## React Flow の運用ルール（controlled）

`BoardMode.tsx` は nodes/edges を完全 controlled で渡す。ハマりどころ:

- **flowNodes には `measured: {width, height}` を必ず渡す**。渡さないと React Flow の
  `nodesInitialized` が永遠に false になり、パン（ツリークリックでのジャンプ）等が黙って死ぬ。
  寸法は store の `w/h` で自前管理しているのでそのまま渡してよい。
- `onNodesChange` はユーザー操作由来の position（ドラッグ中）/ dimensions（リサイズ中）/
  select だけを store に反映する。全変更を書き戻すと store↔ReactFlow の無限ループになる。
- 永続化はドラッグ/リサイズ終了時（`onNodeDragStop` / `onResizeEnd`）に行い、
  undo/redo を `history-store` に push する。ボード操作を追加したら必ず undo 対応を入れる。
- エッジの選択状態は React Flow が持たないため `BoardMode` のローカル state で管理
  （`onEdgesChange` の select 変更を拾う）。
- `EdgeLabelRenderer` の中身はノードレイヤーより下に描画される。クリック可能な UI
  （エッジのツールバーやハンドル）には `zIndex: 1100` と `pointerEvents: 'all'` を付ける。

## 分業ワークフロー（Claude = プラン / Codex = 実装）

- プランは Claude が `plans/NNN-スラッグ.md` に書く（git 管理外。プロトコルの詳細と
  テンプレートは `plans/README.md` / `plans/_template.md`）。
- **Codex（実装エージェント）へ**: AGENTS.md（= このファイル）の約束事はすべて適用される。
  指定されたプランを実装ステップの順に進め、各ステップで検証コマンドを green に保ち、
  完了時にプラン末尾の「## 実装報告」の記入と status 更新まで完遂すること。コミットはしない。
- **Claude へ**: 実装レビューは plans/ の実装報告 + `git diff` を起点に行う。
  プランには必ず「検証」節と「制約・注意」節（このファイルの該当節への参照）を含める。

## その他の約束事

- コミットに `Co-Authored-By: Claude` を入れない（ユーザー指示）。
- **モデルの使い分け**: Sonnet で十分なタスク（機械的な一括修正、定型的な調査・検索、
  単純なスクリプト作成など）は subagent に `model: sonnet` を指定して委譲する。
  設計判断・複雑なデバッグ・レビューなど判断力が要る作業はメインモデルで行う。
- UI 文言・コメントは日本語。
- Playwright はグローバルに無いので、検証スクリプトは `frontend/` 配下から実行する
  （`node e2e/xxx.mjs`）。使い捨てスクリプトは `e2e/_*.mjs` に置き、終わったら消す。
