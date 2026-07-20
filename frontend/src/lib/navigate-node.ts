import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { boardAncestorId, useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { BOARD_ITEM_TYPES, type KNode } from '@/types/model'

/**
 * ノード種別に応じた画面遷移＋選択。
 * ツリークリックと「派生元へジャンプ」（derivedFrom）で共用する。
 */
export function useNavigateToNode(): (node: KNode) => void {
  const navigate = useNavigate()

  return useCallback(
    (node: KNode) => {
      const nodes = useEntityStore.getState().nodes
      const { setActiveBoard, setActiveDoc, setSelected, setPanelTab, requestDocScroll } =
        useUiStore.getState()

      if (node.type === 'board') {
        setActiveBoard(node.id)
        setSelected([node.id])
        navigate('/board')
        return
      }
      if ((BOARD_ITEM_TYPES.includes(node.type) || node.type === 'section') && node.parentId) {
        // 付箋等: 所属ボード（セクション配下なら祖父）を開き、選択＋パン
        const boardId = boardAncestorId(nodes, node.parentId)
        if (boardId) setActiveBoard(boardId)
        setSelected([node.id], { pan: true })
        navigate('/board')
        return
      }
      if (node.type === 'document') {
        setActiveDoc(node.id)
        setSelected([node.id])
        navigate('/doc')
        return
      }
      if (node.type === 'block' && node.parentId) {
        // ドキュメント見出し: 親ドキュメントを開き、該当ブロックへスクロール
        setActiveDoc(node.parentId)
        setSelected([node.parentId])
        navigate('/doc')
        const blockId = node.data.blockId
        if (typeof blockId === 'string') {
          // エディタのマウントを待ってからスクロール要求
          window.setTimeout(() => requestDocScroll(blockId), 150)
        }
        return
      }
      if (node.type === 'comment') {
        if (node.parentId) setSelected([node.parentId], { pan: true })
        setPanelTab('comments')
        return
      }
      if (node.type === 'chat_room' || node.type === 'message') {
        // チャットの文脈対象（chat_room の親: board / document / project）まで開いてから
        // chat タブと選択を合わせる。project のチャットは AI Mode 内蔵ビューに表示される
        const room = node.type === 'chat_room' ? node : node.parentId ? nodes[node.parentId] : undefined
        const target = room?.parentId ? nodes[room.parentId] : undefined
        if (target?.type === 'board') {
          setActiveBoard(target.id)
          navigate('/board')
          setPanelTab('chat')
        } else if (target?.type === 'document') {
          setActiveDoc(target.id)
          navigate('/doc')
          setPanelTab('chat')
        } else if (target?.type === 'project') {
          navigate('/ai')
        } else {
          setPanelTab('chat')
        }
        setSelected([node.id])
        return
      }
      if (node.type === 'task') {
        setSelected([node.id])
        navigate('/tasks')
        return
      }
      if (node.type === 'decision' || node.type === 'open_question') {
        setPanelTab('decisions')
        setSelected([node.id])
        return
      }
      setSelected([node.id])
    },
    [navigate],
  )
}
