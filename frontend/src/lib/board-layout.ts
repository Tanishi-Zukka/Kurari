import { absoluteXY, BOARD_ITEM_TYPES, type KNode } from '@/types/model'

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 指定ノード群（セクション含む）の絶対座標バウンディングボックス */
export function bboxOf(nodes: Record<string, KNode>, ids: string[]): BBox | null {
  let box: BBox | null = null
  for (const id of ids) {
    const n = nodes[id]
    if (!n) continue
    const { x, y } = absoluteXY(nodes, n)
    const w = typeof n.data.w === 'number' ? n.data.w : 220
    const h = typeof n.data.h === 'number' ? n.data.h : 120
    if (!box) box = { minX: x, minY: y, maxX: x + w, maxY: y + h }
    else {
      box.minX = Math.min(box.minX, x)
      box.minY = Math.min(box.minY, y)
      box.maxX = Math.max(box.maxX, x + w)
      box.maxY = Math.max(box.maxY, y + h)
    }
  }
  return box
}

/** ボード直下＋セクション内の全ボード要素のID（AI付箋の空き場所計算用） */
export function boardItemIds(nodes: Record<string, KNode>, boardId: string): string[] {
  const result: string[] = []
  const walk = (parentId: string) => {
    for (const n of Object.values(nodes)) {
      if (n.parentId !== parentId) continue
      if (BOARD_ITEM_TYPES.includes(n.type) || n.type === 'section') {
        result.push(n.id)
        if (n.type === 'section') walk(n.id)
      }
    }
  }
  walk(boardId)
  return result
}

/**
 * ブレスト付箋の配置座標。ボード既存要素のbbox下に3列グリッドで並べる。
 * 空ボードなら原点付近から。
 */
export function gridBelowBoard(
  nodes: Record<string, KNode>,
  boardId: string,
  count: number,
  cell = { w: 240, h: 200 },
): { x: number; y: number }[] {
  const box = bboxOf(nodes, boardItemIds(nodes, boardId))
  const startX = box ? box.minX : 100
  const startY = box ? box.maxY + 80 : 100
  return Array.from({ length: count }, (_, i) => ({
    x: startX + (i % 3) * cell.w,
    y: startY + Math.floor(i / 3) * cell.h,
  }))
}
