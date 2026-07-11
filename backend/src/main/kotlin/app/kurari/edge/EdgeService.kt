package app.kurari.edge

import app.kurari.ws.EventBroadcaster
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import java.time.Instant
import java.util.UUID

data class EdgeDto(
    val id: UUID,
    val workspaceId: UUID,
    val boardId: UUID,
    val sourceNodeId: UUID,
    val targetNodeId: UUID,
    val label: String,
    val data: Map<String, Any?>,
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        fun from(e: EdgeEntity) = EdgeDto(
            e.id, e.workspaceId, e.boardId, e.sourceNodeId, e.targetNodeId,
            e.label, e.data, e.createdAt, e.updatedAt,
        )
    }
}

@Service
class EdgeService(
    private val repo: EdgeRepository,
    private val broadcaster: EventBroadcaster,
) {

    @Transactional(readOnly = true)
    fun listByWorkspace(workspaceId: UUID): List<EdgeDto> =
        repo.findByWorkspaceIdAndDeletedAtIsNull(workspaceId).map(EdgeDto::from)

    @Transactional
    fun upsert(dto: EdgeDto): EdgeDto {
        val existing = repo.findById(dto.id).orElse(null)
        val entity = existing?.apply {
            label = dto.label
            data = dto.data.toMutableMap()
            deletedAt = null
            updatedAt = Instant.now()
        } ?: EdgeEntity(
            id = dto.id,
            workspaceId = dto.workspaceId,
            boardId = dto.boardId,
            sourceNodeId = dto.sourceNodeId,
            targetNodeId = dto.targetNodeId,
            label = dto.label,
            data = dto.data.toMutableMap(),
        )
        val saved = EdgeDto.from(repo.save(entity))
        broadcaster.broadcast(if (existing != null) "edge.updated" else "edge.created", saved)
        return saved
    }

    @Transactional
    fun softDelete(id: UUID) {
        val entity = repo.findById(id).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "edge not found: $id")
        }
        markDeleted(entity)
    }

    /** ノード削除時に、そのノードに接続するエッジも削除する（NodeServiceから呼ばれる） */
    @Transactional
    fun deleteByEndpoint(nodeId: UUID) {
        repo.findLiveByEndpoint(nodeId).forEach { markDeleted(it) }
    }

    private fun markDeleted(entity: EdgeEntity) {
        entity.deletedAt = Instant.now()
        entity.updatedAt = entity.deletedAt!!
        repo.save(entity)
        broadcaster.broadcast("edge.deleted", EdgeDto.from(entity))
    }
}
