import { useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps, type Node } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { useEntityStore } from '@/stores/entity-store'
import { useHistoryStore } from '@/stores/history-store'
import { useUiStore } from '@/stores/ui-store'
import type { ShapeKind, StickyColor } from '@/types/model'

export interface BoardItemFlowData {
  text: string
  color: StickyColor
  kind?: ShapeKind
  [key: string]: unknown
}

export type BoardItemFlowNode = Node<BoardItemFlowData>

/** 付箋: FigJam 風にベタ塗り（枠線なし・紙の影で立体感を出す） */
export const STICKY_FILL: Record<StickyColor, string> = {
  yellow: 'bg-amber-200',
  blue: 'bg-sky-200',
  pink: 'bg-pink-200',
  green: 'bg-emerald-200',
  gray: 'bg-neutral-300',
}

/** シェイプ: 薄い塗り + はっきりした色枠。付箋と一目で区別できるようにする */
export const SHAPE_CLASSES: Record<StickyColor, string> = {
  yellow: 'bg-amber-50 border-amber-400',
  blue: 'bg-sky-50 border-sky-400',
  pink: 'bg-pink-50 border-pink-400',
  green: 'bg-emerald-50 border-emerald-400',
  gray: 'bg-neutral-50 border-neutral-400',
}

/** 描画（ペン）・エッジの線色。塗りつぶしとは違う視認性重視のトーン */
export const STROKE_COLORS: Record<StickyColor, string> = {
  yellow: '#fbbf24',
  blue: '#38bdf8',
  pink: '#f472b6',
  green: '#34d399',
  gray: '#737373',
}

/** 要素本文の先頭行をツリー表示名に使う */
export function stickyNameFrom(text: string): string {
  return text.split('\n')[0]?.slice(0, 40) || '(empty sticky)'
}

/** 4辺の接続ハンドル（ConnectionMode.Loose 前提で source のみ配置） */
function ItemHandles() {
  const showHandles = useUiStore((s) => s.showHandles)
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
          className={cn(
            '!h-2.5 !w-2.5 !border-2 !border-white !bg-neutral-500 transition-opacity',
            showHandles ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100',
          )}
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
      const prevText = text
      const nextText = draft
      void updateNode(id, { name: stickyNameFrom(nextText), data: { text: nextText } })
      useHistoryStore.getState().push({
        undo: () => updateNode(id, { name: stickyNameFrom(prevText), data: { text: prevText } }),
        redo: () => updateNode(id, { name: stickyNameFrom(nextText), data: { text: nextText } }),
      })
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
function ItemResizer({
  id,
  selected,
  keepAspectRatio,
  minWidth = 100,
  minHeight = 60,
}: {
  id: string
  selected?: boolean
  keepAspectRatio?: boolean
  minWidth?: number
  minHeight?: number
}) {
  const updateNode = useEntityStore((s) => s.updateNode)
  const startRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  return (
    <NodeResizer
      isVisible={!!selected}
      keepAspectRatio={keepAspectRatio}
      minWidth={minWidth}
      minHeight={minHeight}
      lineClassName="!border-neutral-500"
      handleClassName="!h-2 !w-2 !bg-white !border-neutral-600"
      onResizeStart={(_e, params) => {
        startRef.current = { x: params.x, y: params.y, w: params.width, h: params.height }
      }}
      onResizeEnd={(_e, params) => {
        const next = { x: params.x, y: params.y, w: params.width, h: params.height }
        void updateNode(id, { data: next })
        const prev = startRef.current
        startRef.current = null
        if (prev) {
          useHistoryStore.getState().push({
            undo: () => updateNode(id, { data: prev }),
            redo: () => updateNode(id, { data: next }),
          })
        }
      }}
    />
  )
}

export function StickyNode({ id, data, selected }: NodeProps<BoardItemFlowNode>) {
  return (
    <div
      className={cn(
        // FigJam 風: 枠線なしのベタ塗り正方形 + 紙が浮いたような影、テキストは中央
        'group/item h-full w-full rounded-[2px] p-3 shadow-[2px_4px_10px_rgba(0,0,0,0.2)] transition-shadow',
        STICKY_FILL[data.color] ?? STICKY_FILL.yellow,
        selected && 'ring-2 ring-neutral-800/60 shadow-[2px_6px_14px_rgba(0,0,0,0.25)]',
      )}
    >
      <ItemResizer id={id} selected={selected} minWidth={80} minHeight={80} />
      <ItemHandles />
      <EditableText
        id={id}
        text={data.text}
        containerClassName="flex items-center justify-center"
        className="max-h-full w-full overflow-hidden text-center text-[13px] leading-snug text-neutral-800"
      />
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
          SHAPE_CLASSES[data.color] ?? SHAPE_CLASSES.yellow,
          ellipse ? 'rounded-full' : 'rounded-sm',
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

export interface DrawingFlowData {
  points: { x: number; y: number }[]
  color: StickyColor
  strokeWidth: number
  [key: string]: unknown
}

export type DrawingFlowNode = Node<DrawingFlowData>

/**
 * ペン描画ノード。points はノード原点（左上=0,0）を基準にした相対座標で、
 * viewBox はその点群のバウンディングボックスから毎回算出する。points 自体は
 * 作成後不変なので、ItemResizer によって w/h（コンテナの実サイズ）が変わっても
 * viewBox は元の座標系のまま保たれ、preserveAspectRatio="none" により
 * 内容がリサイズに追従して伸縮する。
 */
export function DrawingNode({ id, data, selected }: NodeProps<DrawingFlowNode>) {
  const points = data.points ?? []
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const vw = xs.length ? Math.max(...xs, 1) : 200
  const vh = ys.length ? Math.max(...ys, 1) : 200
  const d = points.length
    ? `M ${points[0].x} ${points[0].y} ` +
      points
        .slice(1)
        .map((p) => `L ${p.x} ${p.y}`)
        .join(' ')
    : ''
  return (
    <div className={cn('group/item h-full w-full rounded', selected && 'ring-2 ring-neutral-800/60')}>
      <ItemResizer id={id} selected={selected} />
      <ItemHandles />
      <svg className="h-full w-full" viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none">
        <path
          d={d}
          fill="none"
          stroke={STROKE_COLORS[data.color] ?? STROKE_COLORS.gray}
          strokeWidth={data.strokeWidth || 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

export interface ImageFlowData {
  url: string
  [key: string]: unknown
}

export type ImageFlowNode = Node<ImageFlowData>

export function ImageNode({ id, data, selected }: NodeProps<ImageFlowNode>) {
  return (
    <div className={cn('group/item h-full w-full rounded', selected && 'ring-2 ring-neutral-800/60')}>
      {/* 画像は原寸比率で配置されるので、リサイズも比率固定にして歪みを防ぐ */}
      <ItemResizer id={id} selected={selected} keepAspectRatio minWidth={40} minHeight={40} />
      <ItemHandles />
      {/* /api は vite.config.ts の dev proxy 経由でバックエンドに届くため相対URLのままでよい */}
      <img src={data.url} draggable={false} className="h-full w-full rounded object-contain" alt="" />
    </div>
  )
}
