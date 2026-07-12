import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from '@blocknote/core'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { usePresenceStore } from '@/stores/presence-store'
import { STROKE_COLORS } from '@/components/board/BoardNodes'
import { syncHeadingBlocks, type LooseBlock } from '@/lib/doc-sync'
import { StickyRefBlockSpec, insertStickyRefItem } from './StickyRefBlock'
import { DocAiToolbar, type DocEditorHandle } from './DocAiToolbar'
import { Button } from '@/components/ui/primitives'
import { FileText, Plus } from 'lucide-react'

/** stickyRef カスタムブロックを含む Kurari のドキュメントスキーマ */
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    stickyRef: StickyRefBlockSpec(),
  },
})


/** ドキュメント一覧（未選択時の画面） */
function DocList() {
  const nodes = useEntityStore((s) => s.nodes)
  const createNode = useEntityStore((s) => s.createNode)
  const setActiveDoc = useUiStore((s) => s.setActiveDoc)
  const setSelected = useUiStore((s) => s.setSelected)

  const project = useMemo(
    () => Object.values(nodes).find((n) => n.type === 'project'),
    [nodes],
  )
  const docs = useMemo(
    () => (project ? childrenOf(nodes, project.id).filter((n) => n.type === 'document') : []),
    [nodes, project],
  )

  const createDoc = async () => {
    if (!project) return
    const doc = await createNode({
      parentId: project.id,
      type: 'document',
      name: '無題のドキュメント',
      data: { content: [] },
    })
    setActiveDoc(doc.id)
    setSelected([doc.id])
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-md p-8">
        <h2 className="mb-1 text-base font-semibold text-neutral-800">Documents</h2>
        <p className="mb-4 text-xs text-neutral-400">
          Notionのようにブロックで書けます。見出しは左のツリーに反映されます。
        </p>
        <div className="mb-4 space-y-1">
          {docs.map((d) => (
            <button
              key={d.id}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
              onClick={() => {
                setActiveDoc(d.id)
                setSelected([d.id])
              }}
            >
              <FileText size={14} className="text-neutral-400" />
              {d.name || '(untitled)'}
            </button>
          ))}
          {docs.length === 0 && (
            <p className="px-3 py-2 text-xs text-neutral-400">まだドキュメントがありません</p>
          )}
        </div>
        <Button variant="primary" onClick={() => void createDoc()}>
          <Plus size={14} />
          新規ドキュメント
        </Button>
      </div>
    </div>
  )
}

/** エディタ本体。document ノード1つにつき1マウント（key=docId で強制再マウント） */
function DocEditor({ docId }: { docId: string }) {
  const doc = useEntityStore((s) => s.nodes[docId])
  const updateNode = useEntityStore((s) => s.updateNode)
  const setActiveDoc = useUiStore((s) => s.setActiveDoc)
  const docScrollBlockId = useUiStore((s) => s.docScrollBlockId)
  const clearDocScroll = useUiStore((s) => s.clearDocScroll)

  const peers = usePresenceStore((s) => s.peers)
  const selfClientId = usePresenceStore((s) => s.identity.clientId)

  const [title, setTitle] = useState(doc?.name ?? '')
  const titleRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const [saveState, setSaveStateRaw] = useState<'saved' | 'saving' | 'dirty'>('saved')
  const saveStateRef = useRef(saveState)
  const setSaveState = useCallback((s: 'saved' | 'saving' | 'dirty') => {
    saveStateRef.current = s
    setSaveStateRaw(s)
  }, [])

  const initialContent = useMemo(() => {
    const content = doc?.data.content as LooseBlock[] | undefined
    return content && content.length > 0 ? content : undefined
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- マウント時のみ

  const editor = useCreateBlockNote({
    schema,
    // JSONから復元するため型は緩く扱う（スキーマ検証はBlockNote側が行う）
    initialContent: initialContent as never,
  })

  // 自分が最後に保存/適用した内容。リモート更新（WS の node.updated）との差分判定に使う
  const contentJsonRef = useRef(JSON.stringify(initialContent ?? []))
  // リモート反映中の onChange で保存を走らせないためのフラグ
  const applyingRemoteRef = useRef(false)
  const editingTimer = useRef<number | undefined>(undefined)

  // 保存本体（デバウンスから、またはアンマウント時のフラッシュから呼ばれる）
  const doSave = useCallback(async () => {
    setSaveState('saving')
    const blocks = editor.document as unknown as LooseBlock[]
    try {
      await updateNode(docId, { data: { content: blocks } })
      contentJsonRef.current = JSON.stringify(blocks)
      await syncHeadingBlocks(docId, blocks)
      setSaveState('saved')
    } catch {
      setSaveState('dirty')
    }
  }, [editor, docId, updateNode, setSaveState])

  // 「編集中」をプレゼンスに知らせる（3秒アイドルで解除）
  const markEditing = useCallback(() => {
    usePresenceStore.getState().setEditingDoc(docId)
    window.clearTimeout(editingTimer.current)
    editingTimer.current = window.setTimeout(
      () => usePresenceStore.getState().setEditingDoc(null),
      3000,
    )
  }, [docId])

  // デバウンス保存＋見出しツリー同期
  const scheduleSave = useCallback(() => {
    if (applyingRemoteRef.current) return // リモート反映による onChange は保存しない（無限ループ防止）
    setSaveState('dirty')
    markEditing()
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void doSave(), 800)
  }, [doSave, setSaveState, markEditing])

  // 他クライアントの保存をエディタへ反映する。自分が編集中（フォーカス中 or 未保存あり）は
  // 上書きしない = ローカルカーソルが飛ばない。次の blur かリモート更新で再試行される
  const maybeApplyRemote = useCallback(() => {
    const current = useEntityStore.getState().nodes[docId]
    const content = (current?.data.content as LooseBlock[] | undefined) ?? []
    if (content.length === 0) return
    const incoming = JSON.stringify(content)
    if (incoming === contentJsonRef.current) return // 自分の保存の跳ね返り・適用済み
    if (editor.isFocused() || saveStateRef.current !== 'saved') return
    applyingRemoteRef.current = true
    try {
      editor.replaceBlocks(editor.document, content as never)
      contentJsonRef.current = incoming
    } finally {
      applyingRemoteRef.current = false
    }
  }, [docId, editor])

  useEffect(() => {
    maybeApplyRemote()
  }, [doc?.data.content, maybeApplyRemote])

  // アンマウント時に「編集中」を解除
  useEffect(
    () => () => {
      window.clearTimeout(editingTimer.current)
      usePresenceStore.getState().setEditingDoc(null)
    },
    [],
  )

  // アンマウント時: 保留中の変更を破棄せず即時フラッシュ（SPA内のドキュメント切替用）
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current)
      if (saveStateRef.current !== 'saved') void doSave()
    },
    [doSave],
  )

  // 同じドキュメントを編集中の他メンバー（clientId で重複排除）
  const editingPeers = useMemo(() => {
    const seen = new Set<string>()
    return Object.values(peers).filter((p) => {
      if (p.clientId === selfClientId || seen.has(p.clientId)) return false
      if (!(p.location.mode === 'doc' && p.location.docId === docId && p.location.editing)) {
        return false
      }
      seen.add(p.clientId)
      return true
    })
  }, [peers, selfClientId, docId])

  // 他クライアントのタイトル変更を反映（自分が入力中は触らない）
  useEffect(() => {
    if (document.activeElement === titleRef.current) return
    setTitle(doc?.name ?? '')
  }, [doc?.name])

  // ツリーの見出しクリック → 該当ブロックへスクロール
  useEffect(() => {
    if (!docScrollBlockId) return
    const el = document.querySelector(`[data-id="${docScrollBlockId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    clearDocScroll()
  }, [docScrollBlockId, clearDocScroll])

  if (!doc) {
    return <DocList />
  }

  const commitTitle = () => {
    const name = title.trim() || '無題のドキュメント'
    if (name !== doc.name) void updateNode(docId, { name })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="mx-auto w-full max-w-3xl px-10 pt-8 pb-2">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-neutral-400">
          <button className="hover:text-neutral-600" onClick={() => setActiveDoc(null)}>
            Documents
          </button>
          <span>/</span>
          <span>{doc.name}</span>
          {editingPeers.map((p) => (
            <span
              key={p.clientId}
              data-testid="doc-editing-badge"
              className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: STROKE_COLORS[p.color] ?? STROKE_COLORS.gray }}
            >
              ✏ {p.name}さんが編集中
            </span>
          ))}
          <span className="ml-auto">
            {saveState === 'saved' ? '保存済み' : saveState === 'saving' ? '保存中…' : '未保存の変更'}
          </span>
        </div>
        <input
          ref={titleRef}
          className="w-full bg-transparent text-3xl font-bold text-neutral-900 outline-none placeholder:text-neutral-300"
          placeholder="無題のドキュメント"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <div className="mt-2">
          <DocAiToolbar
            docId={docId}
            editor={editor as unknown as DocEditorHandle}
            doSave={doSave}
          />
        </div>
      </div>
      <div
        className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16"
        onBlur={() => {
          // 編集終了扱いにして、フォーカス中に保留していたリモート更新を適用する
          window.clearTimeout(editingTimer.current)
          usePresenceStore.getState().setEditingDoc(null)
          maybeApplyRemote()
        }}
      >
        <BlockNoteView editor={editor} theme="light" onChange={scheduleSave} slashMenu={false}>
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterSuggestionItems(
                [...getDefaultReactSlashMenuItems(editor), insertStickyRefItem(editor)],
                query,
              )
            }
          />
        </BlockNoteView>
      </div>
    </div>
  )
}

export function DocumentMode() {
  const activeDocId = useUiStore((s) => s.activeDocId)
  const docExists = useEntityStore((s) => (activeDocId ? !!s.nodes[activeDocId] : false))

  if (!activeDocId || !docExists) return <DocList />
  return <DocEditor key={activeDocId} docId={activeDocId} />
}
