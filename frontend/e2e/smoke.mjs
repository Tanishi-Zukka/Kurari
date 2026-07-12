import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
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
    if (n.type === 'section') continue
    // チャット履歴・AI Mode の保存物は毎回積み増しになるので消す
    if (
      n.type === 'chat_room' ||
      (n.type === 'group' && n.name === '意思決定ログ') ||
      (n.type === 'group' && n.name === 'タスク') ||
      (n.type === 'ai_summary' && n.name.includes('プロジェクト説明')) ||
      n.data?.aiGenerated === true ||
      junkNames.includes(n.name) ||
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

const browser = await chromium.launch()
const page = await browser.newPage()
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
  ok('コメント投稿')

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

  // 20. エッジの永続化（リロード後も残る）
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
  await page.getByRole('button', { name: 'Chat' }).click()
  await page.getByTestId('chat-msg-user').first().hover()
  await page.getByTestId('msg-action-task').first().click()
  await page.getByTestId('task-item').first().waitFor()
  await page.locator('[data-tree-id]', { hasText: /^タスク$/ }).first().waitFor()
  ok('メッセージ→タスク化（Decisionsタブ・ツリーに出現）')

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
} catch (e) {
  ng('スモークテスト', e.message?.split('\n')[0])
  await page.screenshot({ path: new URL('./smoke-failure.png', import.meta.url).pathname })
}

await browser.close()
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
