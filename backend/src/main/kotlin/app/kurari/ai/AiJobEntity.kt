package app.kurari.ai

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
enum class AiJobStatus { pending, claimed, done, failed }

@Entity
@Table(name = "ai_jobs")
class AiJobEntity(
    @Id
    var id: UUID = UUID.randomUUID(),

    @Column(nullable = false, length = 32)
    var type: String,

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    var status: AiJobStatus = AiJobStatus.pending,

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    var payload: MutableMap<String, Any?> = mutableMapOf(),

    @Column(columnDefinition = "text")
    var context: String? = null,

    @Column(columnDefinition = "text")
    var result: String? = null,

    @Column(columnDefinition = "text")
    var error: String? = null,

    @Column(name = "claimed_at")
    var claimedAt: Instant? = null,

    @Column(name = "completed_at")
    var completedAt: Instant? = null,

    @Column(name = "created_at", nullable = false)
    var createdAt: Instant = Instant.now(),

    @Column(name = "updated_at", nullable = false)
    var updatedAt: Instant = Instant.now(),
)
