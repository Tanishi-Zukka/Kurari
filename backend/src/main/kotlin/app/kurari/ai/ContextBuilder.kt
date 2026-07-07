package app.kurari.ai

import app.kurari.node.NodeRepository
import app.kurari.node.NodeType
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.server.ResponseStatusException
import java.util.UUID

/**
 * ボードとその配下（付箋・コメント）を、AIに渡すMarkdownへ直列化する。
 * 文脈はジョブ作成時に確定・同梱されるため、Agentはアプリ内部構造を知らなくてよい。
 */
@Component
class ContextBuilder(private val repo: NodeRepository) {

    companion object {
        const val MAX_CHARS = 8000
    }

    fun buildBoardContext(boardId: UUID): String {
        val board = repo.findById(boardId).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "board not found: $boardId")
        }
        val stickies = repo.findByParentIdAndDeletedAtIsNull(boardId)
            .filter { it.type == NodeType.sticky }

        val sb = StringBuilder()
        sb.appendLine("# Board: ${board.name} (${stickies.size} stickies)")
        sb.appendLine()
        sb.appendLine("## Stickies")
        for (sticky in stickies) {
            val color = sticky.data["color"] ?: "yellow"
            val text = (sticky.data["text"] as? String ?: "").replace("\n", " / ")
            sb.append("- [$color] \"$text\"")
            val comments = repo.findByParentIdAndDeletedAtIsNull(sticky.id)
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
        val out = sb.toString()
        return if (out.length > MAX_CHARS) out.take(MAX_CHARS) + "\n…(truncated)" else out
    }
}
