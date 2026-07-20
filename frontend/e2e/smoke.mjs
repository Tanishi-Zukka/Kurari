import { chromium } from 'playwright'
import os from 'node:os'

const BASE = 'https://localhost:5173' // dev サーバは自己署名 HTTPS（ignoreHTTPSErrors で許可）
let failed = 0
const ok = (name) => console.log(`  ✅ ${name}`)
const ng = (name, e) => { failed++; console.log(`  ❌ ${name}: ${e}`) }

// 前回実行の残骸を掃除する。スモークが作る要素はビューポート中央＝シード付箋の
// 真上に積み重なっていき、次回実行時のホバー/クリックを横取りしてしまうため。
const WS = '00000000-0000-0000-0000-000000000001'
const FIRST_BOARD = '00000000-0000-0000-0000-000000000003'
{
  const nodes = await (await fetch(`http://localhost:8080/api/nodes?workspaceId=${WS}`)).json()
  // セクションが残っていると、シード付箋が取り込まれたまま消される事故につながる。
  // 中身をボード直下（絶対座標）へ救出してからセクションごと削除する
  for (const s of nodes.filter((n) => n.type === 'section')) {
    const sx = s.data.x ?? 0
    const sy = s.data.y ?? 0
    for (const c of nodes.filter((n) => n.parentId === s.id)) {
      await fetch(`http://localhost:8080/api/nodes/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: FIRST_BOARD, data: { x: (c.data.x ?? 0) + sx, y: (c.data.y ?? 0) + sy } }),
      })
    }
    await fetch(`http://localhost:8080/api/nodes/${s.id}`, { method: 'DELETE' })
  }
  const junkNames = ['スモークテキスト', '(empty sticky)', '(image)', '新しいボード']
  for (const n of nodes) {
    if (n.data?.reactions || n.data?.votes || n.data?.voteSession) {
      await fetch(`http://localhost:8080/api/nodes/${n.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { reactions: null, votes: null, voteSession: null } }),
      })
    }
    if (n.type === 'section') continue
    // チャット履歴・AI Mode の保存物は毎回積み増しになるので消す
    if (
      n.type === 'chat_room' ||
      n.type === 'comment_pin' ||
      (n.type === 'group' && n.name === '意思決定ログ') ||
      (n.type === 'group' && n.name === 'タスク') ||
      (n.type === 'ai_summary' && n.name.includes('プロジェクト説明')) ||
      n.data?.aiGenerated === true ||
      junkNames.includes(n.name) ||
      n.name.startsWith('通話議事録') ||
      n.name.startsWith('スモーク')
    ) {
      await fetch(`http://localhost:8080/api/nodes/${n.id}`, { method: 'DELETE' })
    }
  }
  // シード付箋の位置を正規化する（過去の実行でドラッグされていると、
  // パン後に画面外/サイドバー下に隠れて接続テストが失敗するため）
  const seedPos = [
    { match: 'Kurariへようこそ', x: 120, y: 160 },
    { match: '付箋を選択すると', x: 480, y: 330 },
  ]
  for (const { match, x, y } of seedPos) {
    const seed = nodes.find((n) => n.type === 'sticky' && String(n.data.text ?? '').includes(match))
    if (seed) {
      await fetch(`http://localhost:8080/api/nodes/${seed.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: FIRST_BOARD, data: { x, y } }),
      })
    }
  }
  const edges = await (await fetch(`http://localhost:8080/api/edges?workspaceId=${WS}`)).json()
  for (const e of edges) await fetch(`http://localhost:8080/api/edges/${e.id}`, { method: 'DELETE' })
}

const browser = await chromium.launch({
  // 通話テスト用: 実カメラなしで getUserMedia を通す（緑のテストパターン映像 + ビープ音）。
  // mDNS 匿名化はテスト環境では解決できず ICE が繋がらないため無効化する
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
  ],
})
// メインページは identity を事前シードして初回の名前入力モーダルをスキップする
// （既存項目をプレゼンス導入前と同じ手順のまま走らせるため）
const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
await ctx.addInitScript(() => {
  // headless の SpeechRecognition は実認識できず fake マイクと競合するため、議事録は後段でWS直叩きする
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined })
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined })
  localStorage.setItem(
    'kurari.identity',
    JSON.stringify({ clientId: 'e2e-main-client-0001', name: 'スモーク太郎', color: 'blue' }),
  )
})
const page = await ctx.newPage()
page.setDefaultTimeout(15000)

try {
  // 1. 初期表示: ツリーとボード
  await page.goto(BASE)
  await page.getByText('My Workspace').first().waitFor()
  await page.getByText('First Board').first().waitFor()
  await page.getByText('Kurariへようこそ 👋', { exact: false }).first().waitFor()
  ok('初期表示: ツリー + シード付箋がボードに表示')

  // 2. ツールバーから付箋作成（ツール選択 → カーソルで配置場所をクリック）→ ツリーに出現
  const treeRows = () => page.locator('[data-tree-id]').count()
  const before = await treeRows()
  await page.getByTitle('付箋を追加').click()
  await page.getByTestId('place-overlay').click() // 中央に配置
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-tree-id]').length > n,
    before,
  )
  ok('付箋作成（配置モード） → 左ツリーに即時反映')

  // 3. 付箋を編集（ダブルクリック → 入力 → blur）— 作成直後は選択状態になるのでそれを狙う
  const sticky = page.locator('.react-flow__node.selected').first()
  await sticky.dblclick()
  await page.keyboard.type('スモークテスト付箋')
  // ツールバー（選択時は派生ボタンで幅が広がる）を避けて、その下の空きキャンバスをクリック
  await page.locator('.react-flow__pane').click({ position: { x: 40, y: 200 } })
  await page.getByText('スモークテスト付箋').first().waitFor()
  ok('付箋のインライン編集')

  // 4. ツリー側にも名前が反映される
  await page.locator('[data-tree-id]', { hasText: 'スモークテスト付箋' }).first().waitFor()
  ok('付箋名がツリーに同期')

  // 5. ツリーから選択 → Context Panel が追従
  await page.locator('[data-tree-id]', { hasText: 'スモークテスト付箋' }).first().click()
  await page.locator('aside').last().getByText('スモークテスト付箋').first().waitFor()
  ok('ツリー選択 → Context Panel 追従')

  // 6. コメント投稿 → 一覧とツリーに出現
  await page.getByPlaceholder(/コメントを書く/).fill('スモークコメント')
  await page.getByRole('button', { name: '送信' }).click()
  await page.getByText('スモークコメント').first().waitFor()
  await page.getByText('スモーク太郎').first().waitFor()
  ok('コメント投稿')

  // 永続リアクション: 追加 → トグルで削除 → 再追加
  const selectedSticky = page.locator('.react-flow__node.selected', { hasText: 'スモークテスト付箋' })
  await selectedSticky.hover()
  await selectedSticky.getByTestId('reaction-add').click()
  await selectedSticky.getByTestId('reaction-emoji-👍').click()
  const thumbsChip = selectedSticky.locator('[data-testid="reaction-chip"][data-emoji="👍"]')
  await thumbsChip.getByText('1', { exact: false }).waitFor()
  await thumbsChip.click()
  await thumbsChip.waitFor({ state: 'detached' })
  await selectedSticky.hover()
  await selectedSticky.getByTestId('reaction-add').click()
  await selectedSticky.getByTestId('reaction-emoji-👍').click()
  await thumbsChip.waitFor()
  ok('永続リアクション（追加・トグル）')

  // 付箋投票: budget 3で開始し、同じ付箋へ2票
  await page.getByTestId('vote-toggle').click()
  await page.getByTestId('vote-start').click()
  await selectedSticky.click({ position: { x: 80, y: 80 } })
  await selectedSticky.click({ position: { x: 80, y: 80 } })
  await selectedSticky.getByTestId('vote-badge-own').getByText('2票').waitFor()
  ok('付箋投票セッションで自分の2票を表示')

  // 終了で合計票を公開し、票と終了状態を永続化
  await page.getByTestId('vote-toggle').click()
  await page.getByTestId('vote-end').click()
  await selectedSticky.getByTestId('vote-badge-total').getByText('2', { exact: false }).waitFor()
  const voteNodes = await (await fetch(`http://localhost:8080/api/nodes?workspaceId=${WS}`)).json()
  const votedSticky = voteNodes.find((n) => n.type === 'sticky' && String(n.data.text ?? '').includes('スモークテスト付箋'))
  const votedBoard = voteNodes.find((n) => n.id === FIRST_BOARD)
  if (votedSticky?.data.votes?.['e2e-main-client-0001'] === 2 && votedBoard?.data.voteSession?.active === false) ok('投票結果とセッション終了がAPIに永続化')
  else ng('付箋投票永続化', `votes=${JSON.stringify(votedSticky?.data.votes)}, active=${votedBoard?.data.voteSession?.active}`)

  // 7. AIタブ → 要約実行（Agent経由の実要約。最大120秒待つ）
  await page.getByRole('button', { name: 'AI' }).click()
  await page.getByRole('button', { name: /このボードを要約/ }).click()
  await page.getByText(/status:/).waitFor()
  await page.locator('main, aside').last().getByText('done', { exact: true }).waitFor({ timeout: 120000 })
  ok('AI要約ジョブが done になる（Copilot CLI 実行）')

  // 8. ツリーに保存 → AI Outputs 配下にノード出現
  await page.getByRole('button', { name: /ツリーに保存/ }).click()
  await page.locator('[data-tree-id]', { hasText: 'AI Outputs' }).first().waitFor()
  await page.locator('[data-tree-id]', { hasText: /要約/ }).first().waitFor()
  ok('要約をツリー（AI Outputs）に保存')

  // 9. リロードして永続化確認
  await page.reload()
  await page.getByText('スモークテスト付箋').first().waitFor()
  await page.locator('[data-tree-id]', { hasText: 'AI Outputs' }).first().waitFor()
  await page.locator('[data-testid="reaction-chip"][data-emoji="👍"]').first().waitFor()
  ok('リロード後もデータが残る（永続化）')

  // 10. モード切替（Callプレースホルダー表示）
  await page.getByRole('link', { name: /Call/ }).click()
  await page.getByText('Call Mode').first().waitFor()
  await page.getByRole('link', { name: /Board/ }).click()
  await page.getByText('スモークテスト付箋').first().waitFor()
  ok('モード切替トグル（Call プレースホルダー → Board復帰）')

  // 11. Document Mode: ドキュメント作成 → タイトル変更
  await page.getByRole('link', { name: /Doc/ }).click()
  await page.getByRole('button', { name: /新規ドキュメント/ }).click()
  await page.getByPlaceholder('無題のドキュメント').fill('スモーク設計メモ')
  await page.keyboard.press('Enter')
  await page.locator('[data-tree-id]', { hasText: 'スモーク設計メモ' }).first().waitFor()
  ok('ドキュメント作成 → タイトルがツリーに反映')

  // 12. 見出し入力 → ツリーに見出しが出る
  await page.locator('.bn-editor').click()
  await page.keyboard.type('# 設計方針')
  await page.keyboard.press('Enter')
  await page.keyboard.type('本文のテキストです')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## 決定事項')
  await page.locator('[data-tree-id]', { hasText: '設計方針' }).first().waitFor({ timeout: 10000 })
  await page.locator('[data-tree-id]', { hasText: '決定事項' }).first().waitFor()
  ok('見出し(h1/h2)が左ツリーに同期')

  // 13. リロード → 本文・見出しツリーが残る（永続化）
  await page.reload()
  await page.getByRole('link', { name: /Doc/ }).click()
  await page.getByRole('button', { name: 'スモーク設計メモ' }).first().click()
  await page.getByText('本文のテキストです').first().waitFor()
  await page.locator('[data-tree-id]', { hasText: '決定事項' }).first().waitFor()
  ok('ドキュメント本文と見出しツリーがリロード後も残る')

  // 14. ツリーの見出しクリック → 該当ドキュメントが開く
  await page.locator('[data-tree-id]', { hasText: '設計方針' }).first().click()
  await page.getByText('本文のテキストです').first().waitFor()
  ok('ツリーの見出しクリック → 該当ドキュメントを表示')

  // 15. スラッシュメニューから付箋参照ブロックを挿入
  await page.getByText('決定事項', { exact: true }).last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/付箋')
  await page.getByText('付箋を埋め込む').first().click()
  await page.getByText('埋め込む付箋を選択').first().waitFor()
  await page.getByRole('button', { name: /Kurariへようこそ/ }).first().click()
  await page.locator('.bn-editor').getByText('付箋の参照', { exact: false }).first().waitFor()
  await page.locator('.bn-editor').getByText('Kurariへようこそ', { exact: false }).first().waitFor()
  ok('スラッシュメニュー → 付箋参照ブロック挿入（ピッカーで選択）')

  // 16. ライブ参照: 付箋をAPI経由で編集 → ドキュメント内の表示が追従
  const all = await (await fetch('http://localhost:8080/api/nodes?workspaceId=00000000-0000-0000-0000-000000000001')).json()
  const welcome = all.find((n) => n.type === 'sticky' && n.name.includes('Kurariへようこそ'))
  await fetch(`http://localhost:8080/api/nodes/${welcome.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { text: welcome.data.text + '（ライブ更新）' } }),
  })
  await page.locator('.bn-editor').getByText('（ライブ更新）').first().waitFor({ timeout: 10000 })
  // 元に戻す
  await fetch(`http://localhost:8080/api/nodes/${welcome.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { text: welcome.data.text } }),
  })
  ok('付箋参照はライブ（ボード側の編集がWS経由でドキュメントに反映）')

  // 17. リロード後も参照ブロックが残り、クリックでボードの該当付箋へ移動
  await page.getByText('保存済み', { exact: true }).waitFor({ timeout: 10000 }) // 自動保存の完了を待つ
  await page.reload()
  await page.getByRole('link', { name: /Doc/ }).click()
  await page.getByRole('button', { name: 'スモーク設計メモ' }).first().click()
  const refBlock = page.locator('.bn-editor').getByText('付箋の参照', { exact: false }).first()
  await refBlock.waitFor()
  await refBlock.click()
  await page.locator('.react-flow__node', { hasText: 'Kurariへようこそ' }).first().waitFor()
  ok('参照ブロックの永続化とクリックでボードへジャンプ')
  // 18. エッジ接続: 付箋の縁のハンドルからドラッグして別要素に接続
  // （テスト17のパンで付箋が画面中央にいるうちに行う。後続のテキストカード等は
  //   画面中央=付箋の真上に作られるため、先に接続しないとホバーが遮られる）
  await page.getByRole('link', { name: /Board/ }).click()
  const nodeA = page.locator('.react-flow__node', { hasText: 'Kurariへようこそ' }).first()
  const nodeB = page.locator('.react-flow__node', { hasText: '付箋を選択すると' }).first()
  await nodeA.hover()
  const handleR = nodeA.locator('.react-flow__handle-right').first()
  const hb0 = await handleR.boundingBox()
  const boxB = await nodeB.boundingBox()
  await page.mouse.move(hb0.x + hb0.width / 2, hb0.y + hb0.height / 2)
  await page.mouse.down()
  // ドロップはターゲットのハンドル近傍（左辺中央）に置く必要がある
  await page.mouse.move(boxB.x + 2, boxB.y + boxB.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.locator('.react-flow__edge').first().waitFor({ timeout: 5000 })
  ok('要素間のドラッグ接続（矢印エッジ）')

  // 19. テキストカードと図形（楕円）の作成（配置モード） → ツリー反映
  await page.getByTitle('テキストカードを追加').click()
  await page.getByTestId('place-overlay').click()
  await page.locator('.react-flow__node.selected').first().dblclick()
  await page.keyboard.type('スモークテキスト')
  // ツールバー（選択時は派生ボタンで幅が広がる）を避けて、その下の空きキャンバスをクリック
  await page.locator('.react-flow__pane').click({ position: { x: 40, y: 200 } })
  await page.locator('[data-tree-id]', { hasText: 'スモークテキスト' }).first().waitFor()
  await page.getByTitle('楕円を追加').click()
  await page.getByTestId('place-overlay').click()
  await page.waitForTimeout(300)
  ok('テキストカード・図形の作成（配置モード） → ツリー同期')

  // 20. コメントピン配置 → 作成直後のスレッドへ実名で投稿
  await page.getByTitle('コメントピンを追加').click()
  await page.getByTestId('place-overlay').click()
  await page.getByTestId('pin-popover').waitFor()
  await page.getByTestId('pin-comment-input').fill('スモークピンコメント')
  await page.getByTestId('pin-comment-send').click()
  // getByText は入力に使った textarea（text content に値が残る）にもマッチするため <p> に絞る
  await page.getByTestId('pin-popover').locator('p', { hasText: 'スモークピンコメント' }).waitFor()
  await page.getByTestId('pin-popover').getByText('スモーク太郎').waitFor()
  ok('コメントピン（配置 → 実名コメント投稿）')

  // 21. エッジの永続化（リロード後も残る）
  await page.reload()
  await page.locator('.react-flow__edge').first().waitFor({ timeout: 10000 })
  ok('エッジがリロード後も残る（永続化）')

  // 21. リサイズ: 図形(楕円)を選択 → 右下ハンドルをドラッグ → サイズがAPIに永続化
  const findEllipse = (list) => list.find((n) => n.type === 'shape' && n.data.kind === 'ellipse')
  const nodesBefore = await (await fetch('http://localhost:8080/api/nodes?workspaceId=00000000-0000-0000-0000-000000000001')).json()
  const shapeBefore = findEllipse(nodesBefore)
  // 中央に要素が積み重なるとクリックが横取りされるため、APIで空き座標へ移動し
  // ツリー行クリックのパン（該当ノードを画面中央へ）で確実に単独表示にする
  await fetch(`http://localhost:8080/api/nodes/${shapeBefore.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { x: -600, y: 800 } }),
  })
  await page.waitForTimeout(600) // WS経由で新座標がストアに反映されるのを待つ
  await page.locator(`[data-tree-id="${shapeBefore.id}"]`).click()
  await page.waitForTimeout(800) // パンアニメーション待ち
  const handle = page.locator('.react-flow__resize-control.bottom.right').first()
  const hb = await handle.boundingBox()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + 80, hb.y + 50, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  const nodesAfter = await (await fetch('http://localhost:8080/api/nodes?workspaceId=00000000-0000-0000-0000-000000000001')).json()
  const shapeAfter = nodesAfter.find((n) => n.id === shapeBefore.id)
  if (shapeAfter.data.w > shapeBefore.data.w) ok('リサイズがAPIに永続化')
  else ng('リサイズ', `w: ${shapeBefore.data.w} -> ${shapeAfter.data.w}`)

  // 22. 複数ボード: プロジェクト行の＋ボタンで新規ボード → 空キャンバスに切替
  await page.locator('[data-tree-id]', { hasText: 'Getting Started' }).first().hover()
  await page.getByTitle('ボードを追加').click()
  await page.locator('[data-tree-id]', { hasText: '新しいボード' }).first().waitFor()
  await page.waitForTimeout(500)
  const nodesOnNewBoard = await page.locator('.react-flow__node').count()
  if (nodesOnNewBoard === 0) ok('新規ボード作成 → 空のキャンバスに切替')
  else ng('新規ボード', `新ボードに ${nodesOnNewBoard} 要素が見える`)
  // 元のボードに戻れる
  await page.locator('[data-tree-id]', { hasText: /^First Board$/ }).first().click()
  await page.locator('.react-flow__node', { hasText: 'Kurariへようこそ' }).first().waitFor()
  ok('ボード切替（ツリーから）')

  // 23. AIチャット: Chatタブ → 送信 → AI応答（サーバー作成のmessageノード）→ ツリーに部屋
  await page.getByRole('button', { name: 'Chat' }).click()
  await page.getByTestId('chat-input').fill('このボードには何がありますか?')
  await page.getByTestId('chat-send').click()
  await page.getByTestId('chat-msg-user').first().waitFor()
  await page.getByTestId('chat-msg-ai').first().waitFor({ timeout: 120000 })
  await page.locator('[data-tree-id]', { hasText: 'AIチャット' }).first().waitFor()
  ok('AIチャット（送信 → AI応答 → ツリーに chat_room）')

  // 24. AI Mode: プロジェクト説明の生成 → ツリー保存
  await page.getByRole('link', { name: /^AI$/ }).click()
  await page.getByRole('button', { name: '説明を生成' }).click()
  await page.locator('main').getByText('done', { exact: true }).waitFor({ timeout: 120000 })
  await page.getByRole('button', { name: 'ツリーに保存' }).first().click()
  await page.locator('[data-tree-id]', { hasText: 'プロジェクト説明' }).first().waitFor()
  ok('AI Mode（プロジェクト説明の生成 → ツリー保存）')

  // 25. ボードAI: ブレスト生成 → 配置 → undo で複数枚が一度に消える
  await page.getByRole('link', { name: /Board/ }).click()
  await page.locator('.react-flow__node', { hasText: 'Kurariへようこそ' }).first().waitFor()
  await page.getByRole('button', { name: 'AI', exact: true }).click()
  await page.getByRole('button', { name: 'アイデアを生成' }).click()
  const placeIdeasBtn = page.getByRole('button', { name: /ボードに配置（\d+枚）/ })
  await placeIdeasBtn.waitFor({ timeout: 120000 })
  const flowCountBefore = await page.locator('.react-flow__node').count()
  await placeIdeasBtn.click()
  await page.waitForFunction(
    (n) => document.querySelectorAll('.react-flow__node').length > n,
    flowCountBefore,
  )
  await page.getByTitle('元に戻す').click()
  await page.waitForFunction(
    (n) => document.querySelectorAll('.react-flow__node').length === n,
    flowCountBefore,
  )
  ok('ボードAIブレスト（生成 → 配置 → undoで一括削除）')

  // 26. ドキュメントAI: 要約 → 文末に挿入 → リロード後も残る
  await page.getByRole('link', { name: /Doc/ }).click()
  await page.getByRole('button', { name: 'スモーク設計メモ' }).first().click()
  await page.getByRole('button', { name: '要約', exact: true }).click()
  await page.getByRole('button', { name: '文末に挿入' }).waitFor({ timeout: 120000 })
  await page.getByRole('button', { name: '文末に挿入' }).click()
  await page.locator('.bn-editor').getByText('要約', { exact: true }).first().waitFor()
  await page.getByText('保存済み', { exact: true }).waitFor({ timeout: 10000 })
  await page.reload()
  await page.getByRole('link', { name: /Doc/ }).click()
  await page.getByRole('button', { name: 'スモーク設計メモ' }).first().click()
  await page.locator('.bn-editor').getByText('要約', { exact: true }).first().waitFor()
  ok('ドキュメントAI要約（文末に挿入 → 永続化）')

  // 27. 派生: チャットメッセージ→タスク化 → Decisionsタブとツリーに出現
  await page.getByRole('link', { name: /Board/ }).click()
  await page.locator('[data-tree-id]', { hasText: /^First Board$/ }).first().click()
  await page.locator('.react-flow__node', { hasText: 'Kurariへようこそ' }).first().waitFor()
  await page.getByRole('button', { name: 'Chat' }).click()
  await page.getByTestId('chat-msg-user').first().hover()
  await page.getByTestId('msg-action-task').first().click()
  await page.getByTestId('task-item').first().waitFor()
  await page.locator('[data-tree-id]', { hasText: /^タスク$/ }).first().waitFor()
  ok('メッセージ→タスク化（Decisionsタブ・ツリーに出現）')

  // 27a. 期限設定 → API永続化 + 未完了の期限切れ表示
  await page.getByTestId('task-due-input').first().fill('2020-01-02')
  await page.waitForTimeout(600)
  let taskMetaNodes = await (await fetch(`http://localhost:8080/api/nodes?workspaceId=${WS}`)).json()
  let taskMeta = taskMetaNodes.find((n) => n.type === 'task')
  if (taskMeta?.data.dueDate === '2020-01-02' && await page.locator('[data-testid="task-item"][data-overdue="true"]').count() > 0) ok('タスク期限がAPIに永続化され期限切れ表示')
  else ng('タスク期限', `dueDate=${taskMeta?.data.dueDate}`)

  // 27b. 自分を担当者に設定 → identityスナップショットをAPIへ永続化
  await page.getByTestId('task-assignee-select').first().selectOption('e2e-main-client-0001')
  await page.waitForTimeout(600)
  taskMetaNodes = await (await fetch(`http://localhost:8080/api/nodes?workspaceId=${WS}`)).json()
  taskMeta = taskMetaNodes.find((n) => n.type === 'task')
  if (taskMeta?.data.assignee?.name === 'スモーク太郎') ok('タスク担当者がAPIに永続化')
  else ng('タスク担当者', `assignee=${JSON.stringify(taskMeta?.data.assignee)}`)

  // 28. タスクの完了チェック → data.done がAPIに永続化
  await page.getByTestId('task-toggle').first().check()
  await page.waitForTimeout(600)
  const nodesWithTask = await (await fetch(`http://localhost:8080/api/nodes?workspaceId=${WS}`)).json()
  const task = nodesWithTask.find((n) => n.type === 'task')
  if (task?.data.done === true) ok('タスク完了チェックがAPIに永続化')
  else ng('タスク完了チェック', `done=${task?.data.done}`)

  // 29. 派生元へジャンプ: タスク → chatタブが開き元メッセージが見える
  await page.getByTestId('task-item').first().hover()
  await page.getByTestId('jump-source').first().click()
  await page.getByTestId('chat-view').waitFor()
  await page.getByTestId('chat-msg-user').first().waitFor()
  ok('派生元へジャンプ（タスク → チャットの元メッセージ）')

  // 29a. かんばん: 3列 + 完了タスクの期限・担当表示
  await page.getByRole('link', { name: /Tasks/ }).click()
  await page.getByTestId('kanban-col-todo').waitFor()
  const doneCard = page.getByTestId('kanban-col-done').getByTestId('kanban-card').first()
  await doneCard.waitFor()
  await doneCard.getByText('スモーク太郎').waitFor()
  await doneCard.getByText('2020-01-02', { exact: false }).waitFor()
  ok('かんばん3列に完了タスク・期限・担当を表示')

  // 29b. 完了→進行中へドラッグ → status/done を同時永続化
  await doneCard.dragTo(page.getByTestId('kanban-col-doing'))
  await page.getByTestId('kanban-col-doing').getByTestId('kanban-card').first().waitFor()
  await page.waitForTimeout(600)
  const kanbanNodes = await (await fetch(`http://localhost:8080/api/nodes?workspaceId=${WS}`)).json()
  const kanbanTask = kanbanNodes.find((n) => n.type === 'task')
  if (kanbanTask?.data.status === 'doing' && kanbanTask?.data.done === false) ok('かんばん列移動がstatus/doneをAPIへ永続化')
  else ng('かんばん列移動', `status=${kanbanTask?.data.status}, done=${kanbanTask?.data.done}`)

  // 29c. リロード後も進行中列に残る
  await page.reload()
  await page.getByTestId('kanban-col-doing').getByTestId('kanban-card').first().waitFor()
  ok('かんばん列がリロード後も維持')
  await page.getByRole('link', { name: /Board/ }).click()

  // 30. 派生: 付箋→意思決定ログ化 → undoで取り消し
  await page.locator('[data-tree-id]', { hasText: 'スモークテスト付箋' }).first().click()
  await page.getByTestId('board-derive-decision').click()
  await page.getByTestId('decision-item').first().waitFor()
  await page.locator('[data-tree-id]', { hasText: '意思決定ログ' }).first().waitFor()
  await page.getByTitle('元に戻す').click()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="decision-item"]').length === 0,
  )
  ok('付箋→意思決定ログ化 → undoで一括取り消し')

  // 31. search: Cmd+K でドキュメント本文を検索し、該当ブロックへ移動
  await page.keyboard.press('Meta+k')
  await page.getByTestId('search-input').fill('本文のテキスト')
  await page.keyboard.press('Enter')
  await page.locator('.bn-editor').getByText('本文のテキストです').first().waitFor()
  await page.locator('[data-tree-id]', { hasText: 'スモーク設計メモ' }).first().waitFor()
  ok('search: Cmd+Kでドキュメント本文を検索してDocへ移動')

  // 32. search: 付箋名を検索し、ボード上の該当ノードを選択
  await page.getByTestId('search-open').click()
  await page.getByTestId('search-input').fill('スモークテスト付箋')
  await page
    .locator('[data-testid="search-result"][data-node-name="スモークテスト付箋"]')
    .click()
  await page.locator('.react-flow__node.selected', { hasText: 'スモークテスト付箋' }).waitFor()
  ok('search: 付箋を検索してボード上の該当ノードへ移動')

  // ---- 以降のマルチクライアント項目は LAN IP が必要（メンバーは LAN 経由でだけゲートを通る） ----
  const lanIp = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address
  if (!lanIp) throw new Error('LAN IP が見つからないため access/presence 項目を実行できません')

  // 33. access: オーナーが招待リンクを発行 → LAN の参加者がリクエスト → 承認で入室
  await page.getByTitle('LANのメンバーを招待').click()
  const inviteUrl = await page.getByTestId('invite-url').inputValue()
  await page.getByTitle('LANのメンバーを招待').click() // ポップオーバーを閉じる
  if (!inviteUrl.startsWith('https://')) throw new Error(`招待URLが不正: ${inviteUrl}`)
  const ctxB = await browser.newContext({ ignoreHTTPSErrors: true })
  await ctxB.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined })
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined })
  })
  const pageB = await ctxB.newPage()
  pageB.setDefaultTimeout(15000)
  await pageB.goto(inviteUrl)
  await pageB.getByTestId('join-name-input').fill('スモーク花子')
  await pageB.getByTestId('join-submit').click()
  await pageB.getByTestId('join-waiting').waitFor()
  await page.getByTestId('access-request-banner').waitFor()
  await page.getByTestId('access-approve').click()
  await pageB.getByText('First Board').first().waitFor({ timeout: 10000 }) // 承認後アプリ本体が開く
  ok('access: 招待リンク → 参加リクエスト → 承認で入室')

  // 34. presence: ヘッダーのアバターが相互に見える
  await page.locator('[data-testid="presence-avatar"][data-peer-name="スモーク花子"]').waitFor()
  await pageB.locator('[data-testid="presence-avatar"][data-peer-name="スモーク太郎"]').waitFor()
  ok('presence: オンラインメンバーが相互に表示')

  // 35. presence: 相手のボードにリモートカーソルが出る
  await page.getByRole('link', { name: /Board/ }).click()
  await pageB.getByRole('link', { name: /Board/ }).click()
  await pageB.locator('.react-flow__pane').first().waitFor()
  // エフェメラルリアクション: WS経由で相手側へ表示
  await page.getByTitle('絵文字リアクション').click()
  await page.getByTestId('reaction-palette').getByTestId('reaction-emoji-👍').click()
  const remoteReaction = pageB.locator('[data-testid="reaction-ping"][data-emoji="👍"]')
  for (let i = 0; i < 8 && (await remoteReaction.count()) === 0; i++) {
    await page.getByTestId('reaction-overlay').click({ position: { x: 350 + i * 8, y: 300 } })
    await page.waitForTimeout(300)
  }
  await remoteReaction.first().waitFor()
  await page.keyboard.press('Escape')
  ok('エフェメラルリアクション（2クライアント同期）')

  // 共有タイマー: 開始が両クライアントへ同期
  await page.getByTestId('timer-open').click()
  await page.getByTestId('timer-preset-1').click()
  await page.getByTestId('timer-countdown').filter({ hasText: /0:[45]\d/ }).waitFor()
  await pageB.getByTestId('timer-countdown').filter({ hasText: /0:[45]\d/ }).waitFor()
  ok('共有タイマー開始が2クライアントへ同期')

  // 停止も両クライアントへ同期
  await page.getByTestId('timer-countdown').click()
  await page.getByTestId('timer-stop').click()
  await page.getByTestId('timer-countdown').waitFor({ state: 'detached' })
  await pageB.getByTestId('timer-countdown').waitFor({ state: 'detached' })
  ok('共有タイマー停止が2クライアントへ同期')
  // 送信は 50ms throttle なので、出るまで動かし続けながら待つ
  const remoteCursor = page.locator('[data-testid="remote-cursor"][data-peer-name="スモーク花子"]')
  for (let i = 0; i < 50 && (await remoteCursor.count()) === 0; i++) {
    await pageB.mouse.move(400 + (i % 10) * 20, 250 + (i % 7) * 15)
    await pageB.waitForTimeout(100)
  }
  await remoteCursor.first().waitFor()
  ok('presence: リモートカーソルが相手のボードに表示')

  // 36. presence: 同じドキュメントで編集中バッジ + 非編集側へのリモート反映
  // Doc 一覧経由だと activeDocId が残っている側でボタンが出ないため、ツリーから開く
  await page.locator('[data-tree-id]', { hasText: 'スモーク設計メモ' }).first().click()
  await page.locator('.bn-editor').waitFor()
  await pageB.locator('[data-tree-id]', { hasText: 'スモーク設計メモ' }).first().click()
  await pageB.locator('.bn-editor').waitFor()
  // 本文の段落にカーソルを置いてから追記する
  await pageB.locator('.bn-editor').getByText('本文のテキストです').first().click()
  await pageB.keyboard.press('End')
  await pageB.keyboard.type('リモート編集テスト')
  await page.getByTestId('doc-editing-badge').waitFor()
  await page.locator('.bn-editor').getByText('リモート編集テスト').first().waitFor({ timeout: 10000 })
  ok('presence: 編集中バッジ + リモート更新が非編集側に反映')

  // 単一ホスト上で LAN IP を自分自身へ向けると macOS が WebRTC のUDP候補収集を止めるため、
  // access/presence の LAN 検証後は2人目も localhost へ移して通話のP2P経路を検証する
  await ctxB.addInitScript(() => {
    localStorage.setItem(
      'kurari.identity',
      JSON.stringify({ clientId: 'e2e-remote-client-0002', name: 'スモーク花子', color: 'pink' }),
    )
  })
  await pageB.goto(BASE)
  await pageB.getByText('First Board').first().waitFor()

  // 37. call: 参加すると自分のカメラ映像タイルが出る（fake device）
  await page.getByRole('link', { name: /Call/ }).click()
  await page.getByTestId('call-join').click()
  await page.waitForFunction(() => {
    const v = document.querySelector('[data-testid="call-tile-self"] video')
    return v && v.videoWidth > 0
  })
  ok('call: 参加で自分のカメラ映像タイルが表示')

  // 38. call: 2人目の参加で P2P 接続が確立し、リモート映像が相互に届く
  await pageB.getByRole('link', { name: /Call/ }).click()
  await pageB.getByTestId('call-join').click()
  const remoteVideoHasFrames = (name) => {
    const v = document.querySelector(`[data-testid="call-tile"][data-peer-name="${name}"] video`)
    return v && v.videoWidth > 0
  }
  await page.waitForFunction(remoteVideoHasFrames, 'スモーク花子', { timeout: 20000 })
  await pageB.waitForFunction(remoteVideoHasFrames, 'スモーク太郎', { timeout: 20000 })
  ok('call: P2P 接続でリモート映像が相互に表示')

  // 39. call: ミュートが相手のタイルに反映される
  await page.getByTestId('call-mic').click()
  await pageB
    .locator('[data-testid="call-tile"][data-peer-name="スモーク太郎"][data-muted="true"]')
    .waitFor()
  ok('call: ミュート状態が相手に反映')

  // 40. call: 画面共有の開始・停止が相手の画面タイルに反映される
  await page.getByTestId('call-screen').click()
  await pageB.waitForFunction(() => {
    const v = document.querySelector(
      '[data-testid="call-tile-screen"][data-peer-name="スモーク太郎"] video',
    )
    return v && v.videoWidth > 0
  }, undefined, { timeout: 20000 })
  await page.getByTestId('call-screen').click()
  await pageB
    .locator('[data-testid="call-tile-screen"][data-peer-name="スモーク太郎"]')
    .waitFor({ state: 'detached' })
  ok('call: 画面共有の開始・停止が相手に反映')

  // 41. call: 他モードへ移っても通話が継続する（フローティングバー）
  await page.getByRole('link', { name: /Board/ }).click()
  await page.getByTestId('floating-call-bar').waitFor()
  // 相手側からは引き続き接続されたまま（タイルが消えない）
  await pageB.locator('[data-testid="call-tile"][data-peer-name="スモーク太郎"]').waitFor()
  await page.getByRole('button', { name: '通話に戻る' }).click()
  await page.getByTestId('call-leave').waitFor()
  ok('call: 他モードでも通話継続（フローティングバー）')

  // 42. call: 途中までの文字起こしを手動でライブ要約し、全参加者へ配信
  await page.evaluate(() => new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${location.host}/ws`)
    const timeout = window.setTimeout(() => reject(new Error('ライブ要約テスト用WSがタイムアウト')), 10000)
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'presence.join', payload: { clientId: 'e2e-live-summary', name: '要約テスト太郎', color: 'green', location: { mode: 'call' }, selectedIds: [] } }))
      ws.send(JSON.stringify({ type: 'call.join', payload: { muted: false, cameraOff: false, screenStreamId: null } }))
      for (const text of ['今日の進捗を共有します。', '設計案を確認しました。', '次回までに試作します。']) {
        ws.send(JSON.stringify({ type: 'call.transcript', payload: { text } }))
      }
      window.setTimeout(() => ws.close(), 100)
    }
    ws.onerror = () => reject(new Error('ライブ要約テスト用WSに接続できません'))
    ws.onclose = () => { window.clearTimeout(timeout); resolve() }
  }))
  await page.getByTestId('call-summary-toggle').click()
  await page.getByTestId('call-summary-refresh').click()
  await page.getByTestId('call-summary-point').first().waitFor({ timeout: 120000 })
  await pageB.getByTestId('call-summary-toggle').click()
  await pageB.getByTestId('call-summary-point').first().waitFor({ timeout: 120000 })
  ok('call: ライブ要約が「今すぐ更新」でパネルに表示・全員に配信')

  // 43. call: 退出で相手のタイルが消え、参加ボタンに戻る
  await pageB.getByTestId('call-leave').click()
  await page
    .locator('[data-testid="call-tile"][data-peer-name="スモーク花子"]')
    .waitFor({ state: 'detached' })
  await page.getByTestId('call-leave').click()
  await page.getByTestId('call-join').waitFor()
  ok('call: 退出でタイルが消え参加前の画面に戻る')

  // 43. call: 文字起こし蓄積 → 最後の退出でAI議事録ドキュメントを自動生成
  await page.evaluate(() => new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${location.host}/ws`)
    const timeout = window.setTimeout(() => reject(new Error('議事録テスト用WSがタイムアウト')), 10000)
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'presence.join',
        payload: {
          clientId: 'e2e-call-minutes-client',
          name: '議事録テスト太郎',
          color: 'blue',
          location: { mode: 'call' },
          selectedIds: [],
        },
      }))
      ws.send(JSON.stringify({
        type: 'call.join',
        payload: { muted: false, cameraOff: false, screenStreamId: null },
      }))
      const lines = [
        '本日の会議では通話議事録機能の動作確認を行い、文字起こしの保存方法について詳しく話し合いました。',
        '決定事項として最後の参加者が退出した時点で議事録を自動生成し、ワークスペース直下へ保存します。',
        'TODOとして生成されたドキュメントを開き、見出しと箇条書きが正しく表示されることを確認します。',
      ]
      for (const text of lines) {
        ws.send(JSON.stringify({ type: 'call.transcript', payload: { text } }))
      }
      window.setTimeout(() => ws.close(), 100)
    }
    ws.onerror = () => reject(new Error('議事録テスト用WSに接続できません'))
    ws.onclose = () => {
      window.clearTimeout(timeout)
      resolve()
    }
  }))
  const minutesNode = page.locator('[data-tree-id]', { hasText: '通話議事録' }).first()
  await minutesNode.waitFor({ timeout: 20000 })
  await minutesNode.click()
  await page.locator('.bn-editor').waitFor()
  ok('call: 最後の退出でAI議事録を生成しDocモードで表示')

  // 44. presence: タブを閉じるとオンライン一覧から即時退室
  await ctxB.close()
  await page
    .locator('[data-testid="presence-avatar"][data-peer-name="スモーク花子"]')
    .waitFor({ state: 'detached' })
  ok('presence: 切断でオンライン一覧から退室')

  // 45. access: 拒否 → 参加者に拒否が伝わる
  const ctxC = await browser.newContext({ ignoreHTTPSErrors: true })
  const pageC = await ctxC.newPage()
  pageC.setDefaultTimeout(15000)
  await pageC.goto(inviteUrl) // 招待リンクは期限内マルチユース
  await pageC.getByTestId('join-name-input').fill('スモーク次郎')
  await pageC.getByTestId('join-submit').click()
  await page.getByTestId('access-request-banner').waitFor()
  await page.getByTestId('access-deny').click()
  await pageC.getByTestId('join-denied').waitFor({ timeout: 10000 }) // 結果は2秒ポーリングで届く
  ok('access: 拒否が参加者に伝わる')

  // 46. access: 未承認クライアントの API はサーバ側で 401 遮断
  const resp = await ctxC.request.get(`https://${lanIp}:5173/api/workspace`)
  if (resp.status() === 401) ok('access: 未承認クライアントのAPIは401で遮断')
  else ng('access: 未承認API遮断', `status=${resp.status()}`)
  await ctxC.close()
} catch (e) {
  ng('スモークテスト', e.message?.split('\n')[0])
  await page.screenshot({ path: new URL('./smoke-failure.png', import.meta.url).pathname })
}

await browser.close()
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
