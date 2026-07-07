import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import type { Block, PartialBlock } from '@blocknote/core'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { childrenOf, useEntityStore } from '@/stores/entity-store'
import { useUiStore } from '@/stores/ui-store'
import { syncHeadingBlocks } from '@/lib/doc-sync'
import { Button } from '@/components/ui/primitives'
import { FileText, Plus } from 'lucide-react'

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

  const [title, setTitle] = useState(doc?.name ?? '')
  const saveTimer = useRef<number | undefined>(undefined)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved')

  const initialContent = useMemo(() => {
    const content = doc?.data.content as PartialBlock[] | undefined
    return content && content.length > 0 ? content : undefined
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- マウント時のみ

  const editor = useCreateBlockNote({ initialContent })

  // デバウンス保存＋見出しツリー同期
  const scheduleSave = useCallback(() => {
    setSaveState('dirty')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      setSaveState('saving')
      const blocks = editor.document as Block[]
      try {
        await updateNode(docId, { data: { content: blocks } })
        await syncHeadingBlocks(docId, blocks)
        setSaveState('saved')
      } catch {
        setSaveState('dirty')
      }
    }, 800)
  }, [editor, docId, updateNode])

  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

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
          <span className="ml-auto">
            {saveState === 'saved' ? '保存済み' : saveState === 'saving' ? '保存中…' : '未保存の変更'}
          </span>
        </div>
        <input
          className="w-full bg-transparent text-3xl font-bold text-neutral-900 outline-none placeholder:text-neutral-300"
          placeholder="無題のドキュメント"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16">
        <BlockNoteView editor={editor} theme="light" onChange={scheduleSave} />
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
