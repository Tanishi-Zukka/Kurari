package app.kurari.node

import app.kurari.ws.EventBroadcaster
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import org.springframework.http.HttpStatus
import java.time.Instant
import java.util.UUID

@Service
class NodeService(
    private val repo: NodeRepository,
    private val broadcaster: EventBroadcaster,
) {

    @Transactional(readOnly = true)
    fun listByWorkspace(workspaceId: UUID): List<NodeDto> =
        repo.findByWorkspaceIdAndDeletedAtIsNull(workspaceId).map(NodeDto::from)

    @Transactional(readOnly = true)
    fun defaultWorkspace(): NodeDto =
        repo.findFirstByTypeAndDeletedAtIsNull(NodeType.workspace)?.let(NodeDto::from)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "workspace not found")

    @Transactional
    fun upsert(req: UpsertNodeRequest): NodeDto {
        val existing = repo.findById(req.id).orElse(null)
        val entity = if (existing != null) {
            existing.apply {
                parentId = req.parentId
                type = req.type
                name = req.name
                orderKey = req.orderKey
                data = req.data.toMutableMap()
                deletedAt = null
                updatedAt = Instant.now()
            }
        } else {
            NodeEntity(
                id = req.id,
                workspaceId = req.workspaceId,
                parentId = req.parentId,
                type = req.type,
                name = req.name,
                orderKey = req.orderKey,
                data = req.data.toMutableMap(),
            )
        }
        val saved = NodeDto.from(repo.save(entity))
        broadcaster.broadcast(if (existing != null) "node.updated" else "node.created", saved)
        return saved
    }

    @Transactional
    fun patch(id: UUID, req: PatchNodeRequest): NodeDto {
        val entity = repo.findById(id).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "node not found: $id")
        }
        if (entity.deletedAt != null) {
            throw ResponseStatusException(HttpStatus.NOT_FOUND, "node deleted: $id")
        }
        req.name?.let { entity.name = it }
        req.parentId?.let { entity.parentId = it }
        req.orderKey?.let { entity.orderKey = it }
        req.data?.forEach { (k, v) ->
            if (v == null) entity.data.remove(k) else entity.data[k] = v
        }
        entity.updatedAt = Instant.now()
        val saved = NodeDto.from(repo.save(entity))
        broadcaster.broadcast("node.updated", saved)
        return saved
    }

    /** ソフトデリート（子孫も再帰的に） */
    @Transactional
    fun softDelete(id: UUID) {
        val entity = repo.findById(id).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "node not found: $id")
        }
        deleteRecursive(entity)
    }

    private fun deleteRecursive(entity: NodeEntity) {
        repo.findByParentIdAndDeletedAtIsNull(entity.id).forEach { deleteRecursive(it) }
        entity.deletedAt = Instant.now()
        entity.updatedAt = entity.deletedAt!!
        repo.save(entity)
        broadcaster.broadcast("node.deleted", NodeDto.from(entity))
    }
}
