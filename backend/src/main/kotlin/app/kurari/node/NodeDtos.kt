package app.kurari.node

import jakarta.validation.constraints.NotNull
import java.time.Instant
import java.util.UUID

data class NodeDto(
    val id: UUID,
    val workspaceId: UUID,
    val parentId: UUID?,
    val type: NodeType,
    val name: String,
    val orderKey: String,
    val data: Map<String, Any?>,
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        fun from(e: NodeEntity) = NodeDto(
            id = e.id,
            workspaceId = e.workspaceId,
            parentId = e.parentId,
            type = e.type,
            name = e.name,
            orderKey = e.orderKey,
            data = e.data,
            createdAt = e.createdAt,
            updatedAt = e.updatedAt,
        )
    }
}

data class UpsertNodeRequest(
    @field:NotNull val id: UUID,
    @field:NotNull val workspaceId: UUID,
    val parentId: UUID? = null,
    @field:NotNull val type: NodeType,
    val name: String = "",
    val orderKey: String = "",
    val data: Map<String, Any?> = emptyMap(),
)

data class PatchNodeRequest(
    val name: String? = null,
    val parentId: UUID? = null,
    val orderKey: String? = null,
    /** data は shallow merge（キー単位で上書き。値が null のキーは削除） */
    val data: Map<String, Any?>? = null,
)
