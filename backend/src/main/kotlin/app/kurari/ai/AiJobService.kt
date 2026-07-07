package app.kurari.ai

import app.kurari.ws.EventBroadcaster
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

data class AiJobDto(
    val id: UUID,
    val type: String,
    val status: AiJobStatus,
    val payload: Map<String, Any?>,
    val context: String?,
    val result: String?,
    val error: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        fun from(e: AiJobEntity) = AiJobDto(
            e.id, e.type, e.status, e.payload, e.context, e.result, e.error, e.createdAt, e.updatedAt,
        )
    }
}

data class AiStatusDto(
    val agent: String,          // "online" | "offline"
    val mockMode: Boolean,
    val lastSeenAt: Instant?,
)

@Service
class AiJobService(
    private val repo: AiJobRepository,
    private val contextBuilder: ContextBuilder,
    private val broadcaster: EventBroadcaster,
    @Value("\${kurari.ai.mock}") private val mockMode: Boolean,
    @Value("\${kurari.ai.agent-offline-after-seconds}") private val agentOfflineAfterSeconds: Long,
    @Value("\${kurari.ai.job-timeout-seconds}") private val jobTimeoutSeconds: Long,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** Agent の最終 heartbeat 時刻（MVPは単一Agent想定のためメモリ保持） */
    private val agentLastSeen = AtomicReference<Instant?>(null)

    fun heartbeat() {
        agentLastSeen.set(Instant.now())
    }

    fun agentOnline(): Boolean {
        val seen = agentLastSeen.get() ?: return false
        return seen.isAfter(Instant.now().minusSeconds(agentOfflineAfterSeconds))
    }

    fun status() = AiStatusDto(
        agent = if (agentOnline()) "online" else "offline",
        mockMode = mockMode,
        lastSeenAt = agentLastSeen.get(),
    )

    @Transactional
    fun create(type: String, boardId: UUID, prompt: String?): AiJobDto {
        if (type != "summarize_board") {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "unsupported job type: $type")
        }
        val context = contextBuilder.buildBoardContext(boardId)
        val job = AiJobEntity(
            type = type,
            payload = mutableMapOf("boardId" to boardId.toString(), "prompt" to prompt),
            context = context,
        )

        // Agent 不在かつ mock モードのときは即ダミー完了させる（開発・検証用）
        if (mockMode && !agentOnline()) {
            job.status = AiJobStatus.done
            job.result = mockSummary(context, prompt)
            job.completedAt = Instant.now()
        }

        val saved = repo.save(job)
        broadcast(saved)
        return AiJobDto.from(saved)
    }

    @Transactional(readOnly = true)
    fun get(id: UUID): AiJobDto =
        repo.findById(id).map(AiJobDto::from).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "job not found: $id")
        }

    /** Agent がジョブを1件取得する。無ければ null。 */
    @Transactional
    fun claim(): AiJobDto? {
        val job = repo.findFirstByStatusOrderByCreatedAtAsc(AiJobStatus.pending) ?: return null
        job.status = AiJobStatus.claimed
        job.claimedAt = Instant.now()
        job.updatedAt = job.claimedAt!!
        val saved = repo.save(job)
        broadcast(saved)
        return AiJobDto.from(saved)
    }

    @Transactional
    fun complete(id: UUID, result: String?, error: String?): AiJobDto {
        val job = repo.findById(id).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "job not found: $id")
        }
        if (error != null) {
            job.status = AiJobStatus.failed
            job.error = error
        } else {
            job.status = AiJobStatus.done
            job.result = result ?: ""
        }
        job.completedAt = Instant.now()
        job.updatedAt = job.completedAt!!
        val saved = repo.save(job)
        broadcast(saved)
        return AiJobDto.from(saved)
    }

    /** claimed のままタイムアウトしたジョブを pending に戻す */
    @Scheduled(fixedDelay = 30_000)
    @Transactional
    fun requeueStaleJobs() {
        val stale = repo.findByStatusAndClaimedAtBefore(
            AiJobStatus.claimed,
            Instant.now().minusSeconds(jobTimeoutSeconds),
        )
        for (job in stale) {
            log.warn("requeue stale ai job {}", job.id)
            job.status = AiJobStatus.pending
            job.claimedAt = null
            job.updatedAt = Instant.now()
            broadcast(repo.save(job))
        }
    }

    private fun broadcast(job: AiJobEntity) {
        broadcaster.broadcast("ai_job.updated", AiJobDto.from(job))
    }

    private fun mockSummary(context: String, prompt: String?): String {
        val lines = context.lines().filter { it.startsWith("- [") }
        return buildString {
            appendLine("【Mock要約 — Kurari Agent 未接続のためダミー応答です】")
            appendLine()
            appendLine("ボード上の付箋 ${lines.size} 件:")
            lines.take(10).forEach { appendLine(it) }
            if (prompt != null) {
                appendLine()
                appendLine("(指示: $prompt)")
            }
            appendLine()
            appendLine("実際のAI要約を使うには、ローカルで `cd agent && npm start` を実行してください。")
        }
    }
}
