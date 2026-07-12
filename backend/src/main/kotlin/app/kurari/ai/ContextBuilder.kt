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

    private fun truncate(text: String, maxChars: Int): String =
        if (text.length > maxChars) text.take(maxChars) + "\n…(truncated)" else text

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

    fun buildBoardContext(boardId: UUID, maxChars: Int = MAX_CHARS): String {
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

        return truncate(sb.toString(), maxChars)
    }

    /** ドキュメント本文（data.content = BlockNoteのブロック配列）をMarkdown風テキストに直列化 */
    fun buildDocumentContext(docId: UUID, maxChars: Int = 6000): String {
        val doc = repo.findById(docId).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "document not found: $docId")
        }
        val sb = StringBuilder()
        sb.appendLine("# Document: ${doc.name}")
        sb.appendLine()
        val content = doc.data["content"] as? List<*>
        if (content.isNullOrEmpty()) {
            sb.appendLine("(本文なし)")
        } else {
            for (block in content) flattenBlock(sb, block, depth = 0)
        }
        return truncate(sb.toString(), maxChars)
    }

    /** BlockNoteブロック1個をテキスト化。children を再帰 */
    private fun flattenBlock(sb: StringBuilder, block: Any?, depth: Int) {
        val map = block as? Map<*, *> ?: return
        val type = map["type"] as? String ?: ""
        val text = (map["content"] as? List<*>).orEmpty()
            .mapNotNull { (it as? Map<*, *>)?.get("text") as? String }
            .joinToString("")
        val indent = "  ".repeat(depth)
        when (type) {
            "heading" -> {
                val level = ((map["props"] as? Map<*, *>)?.get("level") as? Number)?.toInt() ?: 1
                if (text.isNotBlank()) sb.appendLine("${"#".repeat(level.coerceIn(1, 6))} $text")
            }
            "bulletListItem", "checkListItem" -> if (text.isNotBlank()) sb.appendLine("$indent- $text")
            "numberedListItem" -> if (text.isNotBlank()) sb.appendLine("${indent}1. $text")
            else -> if (text.isNotBlank()) sb.appendLine("$indent$text")
        }
        for (child in (map["children"] as? List<*>).orEmpty()) flattenBlock(sb, child, depth + 1)
    }

    /** ボード上でユーザーが選択した要素（＋コメント・選択内エッジ）を直列化 */
    fun buildSelectionContext(nodeIds: List<UUID>, maxChars: Int = 4000): String {
        val items = nodeIds.mapNotNull { repo.findById(it).orElse(null) }
            .filter { it.deletedAt == null }
        if (items.isEmpty()) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "no valid nodes in selection")
        }
        val idSet = items.map { it.id }.toSet()
        val sb = StringBuilder()
        sb.appendLine("# 選択された要素 (${items.size} items)")
        sb.appendLine()
        for (item in items) {
            when {
                item.type in TEXT_TYPES -> appendItem(sb, item)
                item.type == NodeType.section -> sb.appendLine("- [セクション] \"${item.name}\"")
                else -> sb.appendLine("- ${describe(item)}")
            }
        }
        // 選択要素同士をつなぐ矢印だけ含める
        val boardId = boardAncestorId(items.first())
        if (boardId != null) {
            val edges = edgeRepo.findByBoardIdAndDeletedAtIsNull(boardId)
                .filter { it.sourceNodeId in idSet && it.targetNodeId in idSet }
            if (edges.isNotEmpty()) {
                val byId = items.associateBy { it.id }
                sb.appendLine()
                sb.appendLine("## Connections（選択内の矢印）")
                for (e in edges) {
                    val src = byId[e.sourceNodeId]?.let { shortText(it) } ?: "?"
                    val dst = byId[e.targetNodeId]?.let { shortText(it) } ?: "?"
                    val label = if (e.label.isNotBlank()) " [${e.label}]" else ""
                    sb.appendLine("- \"$src\" →$label \"$dst\"")
                }
            }
        }
        return truncate(sb.toString(), maxChars)
    }

    /** チャット履歴を "user:/ai:" 形式で直列化（直近 maxMessages 件） */
    fun buildChatContext(chatRoomId: UUID, maxMessages: Int = 20, maxChars: Int = 3000): String {
        val messages = repo.findByParentIdAndDeletedAtIsNull(chatRoomId)
            .filter { it.type == NodeType.message }
            .sortedBy { it.createdAt }
            .takeLast(maxMessages)
        val sb = StringBuilder()
        for (m in messages) {
            val author = m.data["author"] as? String ?: "user"
            val text = (m.data["text"] as? String ?: "").replace("\n", " ")
            sb.appendLine("$author: $text")
        }
        return truncate(sb.toString(), maxChars)
    }

    /**
     * プロジェクト横断コンテキスト。配分: ボード計6000 / ドキュメント計4000 / チャット計1500。
     * ai_summary はAI出力の自己参照ループになるため含めない。
     */
    fun buildProjectContext(projectId: UUID, maxChars: Int = 12000): String {
        val project = repo.findById(projectId).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "project not found: $projectId")
        }
        // project 配下の全子孫から board / document / chat_room を集める
        val boards = mutableListOf<NodeEntity>()
        val documents = mutableListOf<NodeEntity>()
        val chatRooms = mutableListOf<NodeEntity>()
        fun collect(parentId: UUID) {
            for (n in repo.findByParentIdAndDeletedAtIsNull(parentId)) {
                when (n.type) {
                    NodeType.board -> { boards.add(n); collect(n.id) }
                    NodeType.document -> documents.add(n)
                    NodeType.chat_room -> chatRooms.add(n)
                    NodeType.group, NodeType.section -> collect(n.id)
                    else -> {}
                }
            }
        }
        collect(projectId)

        val sb = StringBuilder()
        sb.appendLine("# Project: ${project.name}")
        if (boards.isNotEmpty()) {
            val perBoard = (6000 / boards.size).coerceAtLeast(1000)
            for (b in boards) {
                sb.appendLine()
                sb.appendLine(buildBoardContext(b.id, perBoard))
            }
        }
        if (documents.isNotEmpty()) {
            val perDoc = (4000 / documents.size).coerceAtLeast(800)
            for (d in documents) {
                sb.appendLine()
                sb.appendLine(buildDocumentContext(d.id, perDoc))
            }
        }
        if (chatRooms.isNotEmpty()) {
            val perRoom = (1500 / chatRooms.size).coerceAtLeast(300)
            for (r in chatRooms) {
                val chat = buildChatContext(r.id, maxChars = perRoom)
                if (chat.isNotBlank()) {
                    sb.appendLine()
                    sb.appendLine("## Chat: ${r.name}")
                    sb.append(chat)
                }
            }
        }
        return truncate(sb.toString(), maxChars)
    }

    /** 祖先をたどって所属ボードの id を返す（要素はセクション配下のこともある） */
    private fun boardAncestorId(start: NodeEntity): UUID? {
        var cur: NodeEntity? = start
        while (cur != null && cur.type != NodeType.board) {
            cur = cur.parentId?.let { repo.findById(it).orElse(null) }
        }
        return cur?.id
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
