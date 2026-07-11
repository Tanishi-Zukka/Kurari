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
        private val TEXT_TYPES = setOf(NodeType.sticky, NodeType.text_card, NodeType.shape)
    }

    /** セクションを再帰的に出力する。入れ子は「親 > 子」のパス表記 */
    private fun appendSectionTree(sb: StringBuilder, section: NodeEntity, path: String) {
        val name = if (path.isEmpty()) section.name else "$path > ${section.name}"
        sb.appendLine()
        sb.appendLine("## Section: $name")
        val children = repo.findByParentIdAndDeletedAtIsNull(section.id)
        val items = children.filter { it.type in TEXT_TYPES }
        val subSections = children.filter { it.type == NodeType.section }
        if (items.isEmpty() && subSections.isEmpty()) sb.appendLine("- (空)")
        for (item in items) appendItem(sb, item)
        for (sub in subSections) appendSectionTree(sb, sub, name)
    }

    fun buildBoardContext(boardId: UUID): String {
        val board = repo.findById(boardId).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "board not found: $boardId")
        }
        val children = repo.findByParentIdAndDeletedAtIsNull(boardId)
        val sections = children.filter { it.type == NodeType.section }
        val items = children.filter { it.type in TEXT_TYPES }
        // 矢印の端点はセクション内（入れ子含む）の要素・画像・手描きにも付くため、
        // 名前解決は全子孫で行う
        val all = mutableListOf<NodeEntity>()
        fun collect(parentId: UUID) {
            for (n in repo.findByParentIdAndDeletedAtIsNull(parentId)) {
                all.add(n)
                if (n.type == NodeType.section) collect(n.id)
            }
        }
        collect(boardId)
        val byId = all.associateBy { it.id }
        val totalItems = all.count { it.type in TEXT_TYPES }

        val sb = StringBuilder()
        sb.appendLine("# Board: ${board.name} ($totalItems items)")
        sb.appendLine()
        sb.appendLine("## Items")
        for (item in items) appendItem(sb, item)
        // セクション（入れ子はパス表記）は見出しとして構造を伝える
        for (section in sections) appendSectionTree(sb, section, "")

        val edges = edgeRepo.findByBoardIdAndDeletedAtIsNull(boardId)
        if (edges.isNotEmpty()) {
            sb.appendLine()
            sb.appendLine("## Connections（矢印: 要素間の関係。source → target の向き）")
            for (e in edges) {
                val src = endpointName(e.data["sourceFree"], byId[e.sourceNodeId])
                val dst = endpointName(e.data["targetFree"], byId[e.targetNodeId])
                val label = if (e.label.isNotBlank()) " [${e.label}]" else ""
                sb.append("- \"$src\" →$label \"$dst\"")
                // 色分けはユーザーの意図（例: 赤=リスク）を含みうるので、デフォルト以外は添える
                val color = e.data["color"] as? String
                if (!color.isNullOrBlank() && color != "gray") sb.append("（${color}の矢印）")
                sb.appendLine()
            }
        }

        val out = sb.toString()
        return if (out.length > MAX_CHARS) out.take(MAX_CHARS) + "\n…(truncated)" else out
    }

    private fun appendItem(sb: StringBuilder, item: NodeEntity) {
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

    /** 矢印の端点の表示名。フリー端点はどの要素にも接続していない */
    private fun endpointName(free: Any?, item: NodeEntity?): String = when {
        free != null -> "(接続なしの端点)"
        item == null -> "?"
        item.type == NodeType.image -> "(画像)"
        item.type == NodeType.drawing -> "(手描き)"
        else -> shortText(item)
    }
}
