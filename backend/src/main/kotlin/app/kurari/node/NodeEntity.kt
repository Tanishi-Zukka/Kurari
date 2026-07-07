package app.kurari.node

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

@Suppress("EnumEntryName")
enum class NodeType {
    workspace, project, board, sticky, text_card, shape, group, document, block,
    chat_room, message, comment, ai_summary, decision, open_question, task, link
}

@Entity
@Table(name = "nodes")
class NodeEntity(
    @Id
    var id: UUID,

    @Column(name = "workspace_id", nullable = false)
    var workspaceId: UUID,

    @Column(name = "parent_id")
    var parentId: UUID? = null,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    var type: NodeType,

    @Column(nullable = false)
    var name: String = "",

    @Column(name = "order_key", nullable = false)
    var orderKey: String = "",

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    var data: MutableMap<String, Any?> = mutableMapOf(),

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),

    @Column(name = "deleted_at")
    var deletedAt: Instant? = null,
)
