package app.kurari.edge

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.util.UUID

interface EdgeRepository : JpaRepository<EdgeEntity, UUID> {
    fun findByWorkspaceIdAndDeletedAtIsNull(workspaceId: UUID): List<EdgeEntity>
    fun findByBoardIdAndDeletedAtIsNull(boardId: UUID): List<EdgeEntity>

    @Query(
        "select e from EdgeEntity e where e.deletedAt is null and (e.sourceNodeId = :nodeId or e.targetNodeId = :nodeId)",
    )
    fun findLiveByEndpoint(@Param("nodeId") nodeId: UUID): List<EdgeEntity>
}
