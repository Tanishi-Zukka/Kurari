/**
 * AI出力のJSONパース。instruction でJSONのみを指示していても、
 * LLMがコードフェンスや前置きを付けることがあるため寛容に抽出する。
 */
export function parseAiJson<T>(raw: string): T | null {
  let text = raw.trim()
  // ```json ... ``` フェンス除去
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  // 最初の [ または { から、対応する閉じ括弧までを抽出
  const start = text.search(/[[{]/)
  if (start < 0) return null
  const open = text[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === open) {
      // 同種の括弧だけ数えれば対応が取れる（異種括弧は必ず内側で完結するため）
      depth++
    } else if (c === close) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  // 括弧が閉じていない場合は全体を試す
  try {
    return JSON.parse(text.slice(start)) as T
  } catch {
    return null
  }
}

/** JSONパース失敗時のフォールバック: 箇条書き・番号付き・行分割で文字列配列化 */
export function fallbackLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-・*]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 0 && !/^```/.test(l))
}
