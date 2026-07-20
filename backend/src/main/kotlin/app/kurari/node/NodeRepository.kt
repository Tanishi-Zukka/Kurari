package app.kurari.node

import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface NodeRepository : JpaRepository<NodeEntity, UUID> {
    fun findByWorkspaceIdAndDeletedAtIsNullOrderByCreatedAtAsc(workspaceId: UUID): List<NodeEntity>
    fun findByParentIdAndDeletedAtIsNull(parentId: UUID): List<NodeEntity>
    fun findFirstByTypeAndDeletedAtIsNull(type: NodeType): NodeEntity?
}
