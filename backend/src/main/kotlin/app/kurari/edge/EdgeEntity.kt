package app.kurari.edge

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import java.time.Instant
import java.util.UUID

/** ボード上の要素間の接続（矢印）。ツリーノードではなく関係データとして扱う。 */
@Entity
@Table(name = "edges")
class EdgeEntity(
    @Id
    var id: UUID,

    @Column(name = "workspace_id", nullable = false)
    var workspaceId: UUID,

    @Column(name = "board_id", nullable = false)
    var boardId: UUID,

    @Column(name = "source_node_id", nullable = false)
    var sourceNodeId: UUID,

    @Column(name = "target_node_id", nullable = false)
    var targetNodeId: UUID,

    @Column(nullable = false)
    var label: String = "",

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
