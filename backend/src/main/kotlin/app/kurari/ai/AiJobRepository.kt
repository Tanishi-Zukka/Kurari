package app.kurari.ai

import org.springframework.data.jpa.repository.JpaRepository
import java.time.Instant
import java.util.UUID

interface AiJobRepository : JpaRepository<AiJobEntity, UUID> {
    fun findFirstByStatusOrderByCreatedAtAsc(status: AiJobStatus): AiJobEntity?
    fun findByStatusAndClaimedAtBefore(status: AiJobStatus, before: Instant): List<AiJobEntity>
    fun existsByTypeAndStatusIn(type: String, statuses: Collection<AiJobStatus>): Boolean
}
