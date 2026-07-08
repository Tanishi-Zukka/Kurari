import { useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { useEntityStore } from '@/stores/entity-store'
import type { ShapeKind, StickyColor } from '@/types/model'

export interface BoardItemFlowData {
  text: string
  color: StickyColor
  kind?: ShapeKind
  [key: string]: unknown
}

export type BoardItemFlowNode = Node<BoardItemFlowData>

export const COLOR_CLASSES: Record<StickyColor, string> = {
  yellow: 'bg-amber-100 border-amber-300',
  blue: 'bg-sky-100 border-sky-300',
  pink: 'bg-pink-100 border-pink-300',
  green: 'bg-emerald-100 border-emerald-300',
}

/** 要素本文の先頭行をツリー表示名に使う */
export function stickyNameFrom(text: string): string {
  return text.split('\n')[0]?.slice(0, 40) || '(empty sticky)'
}

/** 4辺の接続ハンドル（ConnectionMode.Loose 前提で source のみ配置） */
function ItemHandles() {
  return (
    <>
      {(
        [
          [Position.Top, 't'],
          [Position.Right, 'r'],
          [Position.Bottom, 'b'],
          [Position.Left, 'l'],
        ] as const
      ).map(([pos, id]) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={pos}
          className="!h-2.5 !w-2.5 !border-2 !border-white !bg-neutral-500 opacity-0 transition-opacity group-hover/item:opacity-100"
        />
      ))}
    </>
  )
}

/**
 * インライン編集つき本文。ノード全域のダブルクリックで textarea に切り替わる。
 * ルート要素で stopPropagation するのが重要: 伝播すると ReactFlow の
 * onDoubleClick（キャンバス上での新規作成）が発火してしまう。
 */
function EditableText({
  id,
  text,
  className,
  containerClassName,
  placeholder,
}: {
  id: string
  text: string
  className?: string
  containerClassName?: string
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const updateNode = useEntityStore((s) => s.updateNode)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== text) {
      void updateNode(id, { name: stickyNameFrom(draft), data: { text: draft } })
    }
  }

  return (
    <div
      className={cn('h-full w-full', containerClassName)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!editing) {
          setDraft(text)
          setEditing(true)
        }
      }}
    >
      {editing ? (
        <textarea
          ref={ref}
          className={cn('nodrag h-full w-full resize-none bg-transparent outline-none', className)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
            if (e.key === 'Escape') {
              setDraft(text)
              setEditing(false)
            }
          }}
        />
      ) : (
        <p className={cn('whitespace-pre-wrap', className)}>
          {text || <span className="text-neutral-400">{placeholder ?? 'ダブルクリックで編集'}</span>}
        </p>
      )}
    </div>
  )
}

/** 選択時のリサイズハンドル。終了時にサイズと位置を永続化する */
function ItemResizer({ id, selected }: { id: string; selected?: boolean }) {
  const updateNode = useEntityStore((s) => s.updateNode)
  return (
    <NodeResizer
      isVisible={!!selected}
      minWidth={100}
      minHeight={60}
      lineClassName="!border-neutral-500"
      handleClassName="!h-2 !w-2 !bg-white !border-neutral-600"
      onResizeEnd={(_e, params) =>
        void updateNode(id, {
          data: { x: params.x, y: params.y, w: params.width, h: params.height },
        })
      }
    />
  )
}

export function StickyNode({ id, data, selected }: NodeProps<BoardItemFlowNode>) {
  return (
    <div
      className={cn(
        'group/item h-full w-full rounded-lg border-2 p-2.5 shadow-sm transition-shadow',
        COLOR_CLASSES[data.color] ?? COLOR_CLASSES.yellow,
        selected && 'ring-2 ring-neutral-800/60 shadow-md',
      )}
    >
      <ItemResizer id={id} selected={selected} />
      <ItemHandles />
      <EditableText id={id} text={data.text} className="text-[13px] leading-snug text-neutral-800" />
    </div>
  )
}

export function TextCardNode({ id, data, selected }: NodeProps<BoardItemFlowNode>) {
  return (
    <div
      className={cn(
        'group/item h-full w-full rounded-md p-1.5',
        selected ? 'ring-2 ring-neutral-800/60' : 'hover:ring-1 hover:ring-neutral-300',
      )}
    >
      <ItemResizer id={id} selected={selected} />
      <ItemHandles />
      <EditableText
        id={id}
        text={data.text}
        placeholder="テキスト"
        className="text-[15px] font-medium leading-snug text-neutral-800"
      />
    </div>
  )
}

export function ShapeNode({ id, data, selected }: NodeProps<BoardItemFlowNode>) {
  const ellipse = data.kind === 'ellipse'
  return (
    <div className="group/item h-full w-full">
      <ItemResizer id={id} selected={selected} />
      <ItemHandles />
      <div
        className={cn(
          'flex h-full w-full items-center justify-center border-2 p-2 text-center',
          COLOR_CLASSES[data.color] ?? COLOR_CLASSES.yellow,
          ellipse ? 'rounded-full' : 'rounded-lg',
          selected && 'ring-2 ring-neutral-800/60',
        )}
      >
        <EditableText
          id={id}
          text={data.text}
          placeholder="ラベル"
          containerClassName="flex items-center justify-center"
          className="max-h-full w-full overflow-hidden text-center text-[13px] leading-snug text-neutral-800"
        />
      </div>
    </div>
  )
}
