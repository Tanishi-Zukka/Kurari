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

https://localhost:5173 を開く（自己署名証明書のため初回はブラウザの警告を許可する）。

### 全文検索・クイックスイッチャー

ヘッダーの検索ボタン、または `⌘K`（Windows/Linuxは `Ctrl+K`）で検索パレットを開けます。
ボード要素、ドキュメント本文、チャット、AI出力、タスクなどを横断検索し、選んだ場所へ直接移動します。

### LAN で共同作業する（オーナー承認制）

> [!NOTE]
> 現在の共同編集は、同じネットワーク内で試すためのプレビュー機能です。
> インターネット経由の利用や常時稼働するサービスとしての運用は想定していません。

**オーナー（この Mac）は必ず localhost で開いてください**（オーナー判定が localhost 基準のため）。

#### 起動するもの

- **オーナー** — DB、backend、frontend を起動し、`https://localhost:5173` をブラウザで開く
- **参加者** — Kurari のインストールやサーバー起動は不要。オーナーから届いた招待リンクをブラウザで開く
- **Agent** — AI機能を実機で使う場合のみ、オーナー側で起動する

共同編集している間は、オーナーの DB・backend・frontend と、各参加者のブラウザを開いたままにしてください。

1. オーナーがヘッダーの「LANのメンバーを招待」から招待リンクを発行してコピーし、相手に渡す
2. 参加者が LAN の別デバイスでリンク（`https://<ホストのIP>:5173/?invite=…`）を開き、
   表示名を入れて参加をリクエスト（初回は自己署名証明書の警告を許可）
3. オーナーの画面右上に通知が出るので「承認」する — 参加者のワークスペースが自動で開く

未承認のクライアントは API・WebSocket ともサーバ側で遮断されます。
承認状態はメモリ管理のため、backend を再起動すると全員再承認が必要です
（招待リンクの有効期限は1時間・再発行で旧リンクは失効）。

### Call Mode（通話）

ワークスペースのメンバーと **音声＋カメラで通話** できます（Call タブ →「通話に参加」）。

- 映像・音声は **LAN 内の P2P（WebRTC）** で直接やり取りされ、サーバを経由しません
  （backend はシグナリングと文字起こしテキストのみ受け取り、音声の録音・映像の録画はしません）
- ミュート / カメラOFF はタイル上のバッジで相手にも表示されます
- コントロールバーから画面共有を開始・停止でき、共有画面は参加者全員に別タイルで表示されます
- 通話中は対応ブラウザで発話を自動文字起こしし、最後の参加者が退出するとAI議事録を
  「通話議事録」ドキュメントとして自動保存します（ミュート中は文字起こしを停止します）
- 通話中に Board / Doc へ移動しても通話は継続し、右下のフローティングバーから戻れます
- Wi-Fi アクセスポイントの「クライアント間通信の禁止（アイソレーション）」が
  有効なネットワークでは P2P が確立できないことがあります

オーナーのPCを終了・スリープした場合やネットワークから切断した場合、参加者は利用できなくなります。
また、初回アクセス時は自己署名証明書の警告を参加者側でも許可する必要があります。

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

以下の56項目を検証します：
- ツリー同期・付箋編集・コメント・永続化
- UI モード切替（Board / Document / Tasks / AI Mode）
- Document Mode（見出し・インデント・テキストエディタ）
- AI 機能：ボード要約・選択要素の要約・ブレスト生成
- Chat タブ（ボード/ドキュメント文脈）＋プロジェクト横断チャット（AI Mode）
- AI Mode での分析（プロジェクト説明・矛盾検出・意思決定抽出）
- ドキュメント AI（下書き・続き生成・要約・録音メモ）
- 全文検索（ドキュメント本文・ボード要素へのジャンプ）
- LAN 共有（招待リンク→承認・拒否・未承認 401）と presence（アバター・カーソル・編集中）
- 通話（P2P 映像・画面共有・ミュート反映・他モード継続・AI議事録・退出。カメラは fake device で代替）

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
