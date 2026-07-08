package app.kurari.ai

import app.kurari.edge.EdgeRepository
import app.kurari.node.NodeEntity
import app.kurari.node.NodeRepository
import app.kurari.node.NodeType
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.server.ResponseStatusException
import java.util.UUID

/**
 * ボードとその配下（付箋・テキストカード・図形・コメント）＋要素間の接続を、
 * AIに渡すMarkdownへ直列化する。
 * 文脈はジョブ作成時に確定・同梱されるため、Agentはアプリ内部構造を知らなくてよい。
 */
@Component
class ContextBuilder(
    private val repo: NodeRepository,
    private val edgeRepo: EdgeRepository,
) {

    companion object {
        const val MAX_CHARS = 8000
    }

    fun buildBoardContext(boardId: UUID): String {
        val board = repo.findById(boardId).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "board not found: $boardId")
        }
        val items = repo.findByParentIdAndDeletedAtIsNull(boardId)
            .filter { it.type in setOf(NodeType.sticky, NodeType.text_card, NodeType.shape) }
        val byId = items.associateBy { it.id }

        val sb = StringBuilder()
        sb.appendLine("# Board: ${board.name} (${items.size} items)")
        sb.appendLine()
        sb.appendLine("## Items")
        for (item in items) {
            sb.append("- ${describe(item)}")
            val comments = repo.findByParentIdAndDeletedAtIsNull(item.id)
                .filter { it.type == NodeType.comment }
            if (comments.isNotEmpty()) {
                val joined = comments.joinToString("; ") { c ->
                    val author = c.data["author"] ?: "?"
                    val body = (c.data["text"] as? String ?: "").replace("\n", " ")
                    "$author: $body"
                }
                sb.append(" (コメント${comments.size}件: $joined)")
            }
            sb.appendLine()
        }

        val edges = edgeRepo.findByBoardIdAndDeletedAtIsNull(boardId)
        if (edges.isNotEmpty()) {
            sb.appendLine()
            sb.appendLine("## Connections（矢印: 要素間の関係）")
            for (e in edges) {
                val src = byId[e.sourceNodeId]?.let { shortText(it) } ?: "?"
                val dst = byId[e.targetNodeId]?.let { shortText(it) } ?: "?"
                val label = if (e.label.isNotBlank()) " [${e.label}]" else ""
                sb.appendLine("- \"$src\" →$label \"$dst\"")
            }
        }

        val out = sb.toString()
        return if (out.length > MAX_CHARS) out.take(MAX_CHARS) + "\n…(truncated)" else out
    }

    private fun describe(item: NodeEntity): String {
        val text = (item.data["text"] as? String ?: "").replace("\n", " / ")
        return when (item.type) {
            NodeType.sticky -> "[付箋:${item.data["color"] ?: "yellow"}] \"$text\""
            NodeType.text_card -> "[テキスト] \"$text\""
            NodeType.shape -> "[図形:${item.data["kind"] ?: "rect"}] \"$text\""
            else -> "\"$text\""
        }
    }

    private fun shortText(item: NodeEntity): String =
        ((item.data["text"] as? String)?.replace("\n", " ") ?: "").take(30).ifBlank { item.name }
}
