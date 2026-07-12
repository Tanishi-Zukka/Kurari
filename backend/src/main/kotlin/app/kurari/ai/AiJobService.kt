package app.kurari.ai

import app.kurari.node.NodeRepository
import app.kurari.node.NodeService
import app.kurari.node.NodeType
import app.kurari.node.UpsertNodeRequest
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
    /** online のとき、Agent が利用できる実行エンジン一覧（ページ側で選択する） */
    val runners: List<RunnerInfo> = emptyList(),
)

@Service
class AiJobService(
    private val repo: AiJobRepository,
    private val contextBuilder: ContextBuilder,
    private val broadcaster: EventBroadcaster,
    private val nodeRepo: NodeRepository,
    private val nodeService: NodeService,
    @Value("\${kurari.ai.mock}") private val mockMode: Boolean,
    @Value("\${kurari.ai.agent-offline-after-seconds}") private val agentOfflineAfterSeconds: Long,
    @Value("\${kurari.ai.job-timeout-seconds}") private val jobTimeoutSeconds: Long,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** Agent の最終 heartbeat 時刻（MVPは単一Agent想定のためメモリ保持） */
    private val agentLastSeen = AtomicReference<Instant?>(null)

    /** Agent が利用できる実行エンジン一覧。ページ側のセレクタ表示用 */
    private val agentRunners = AtomicReference<List<RunnerInfo>>(emptyList())

    fun heartbeat(runners: List<RunnerInfo>? = null) {
        agentLastSeen.set(Instant.now())
        if (runners != null) agentRunners.set(runners)
    }

    fun agentOnline(): Boolean {
        val seen = agentLastSeen.get() ?: return false
        return seen.isAfter(Instant.now().minusSeconds(agentOfflineAfterSeconds))
    }

    fun status() = AiStatusDto(
        agent = if (agentOnline()) "online" else "offline",
        mockMode = mockMode,
        lastSeenAt = agentLastSeen.get(),
        runners = if (agentOnline()) agentRunners.get() else emptyList(),
    )

    @Transactional
    fun create(req: CreateAiJobRequest): AiJobDto {
        val type = AiJobType.parse(req.type)
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "unsupported job type: ${req.type}")
        val context = buildContext(type, req)
        val job = AiJobEntity(
            type = type.name,
            payload = mutableMapOf(
                "targetId" to req.targetId?.toString(),
                "nodeIds" to req.nodeIds?.map { it.toString() },
                "chatRoomId" to req.chatRoomId?.toString(),
                "prompt" to req.prompt,
                "instruction" to type.instruction,
                "responseFormat" to type.responseFormat.name,
                "runner" to req.runner,
            ),
            context = context,
        )

        // Agent 不在かつ mock モードのときは即ダミー完了させる（開発・検証用）
        if (mockMode && !agentOnline()) {
            job.status = AiJobStatus.done
            job.result = mockResult(type, context, req.prompt)
            job.completedAt = Instant.now()
        }

        val saved = repo.save(job)
        finalizeJob(saved)
        broadcast(saved)
        return AiJobDto.from(saved)
    }

    /** 種別ごとに必須パラメータを検証してコンテキストを構築する */
    private fun buildContext(type: AiJobType, req: CreateAiJobRequest): String {
        fun target(): UUID = req.targetId
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "targetId required for ${type.name}")
        return when (type) {
            AiJobType.summarize_board -> contextBuilder.buildBoardContext(target())
            AiJobType.brainstorm -> contextBuilder.buildBoardContext(target(), 4000)
            AiJobType.summarize_selection -> {
                val ids = req.nodeIds?.takeIf { it.isNotEmpty() }
                    ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "nodeIds required for ${type.name}")
                contextBuilder.buildSelectionContext(ids)
            }
            AiJobType.summarize_document, AiJobType.draft_document ->
                contextBuilder.buildDocumentContext(target())
            AiJobType.summarize_transcript -> {
                val text = req.sourceText?.takeIf { it.isNotBlank() }
                    ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "sourceText required for ${type.name}")
                "# 文字起こし\n\n" + text.take(8000)
            }
            AiJobType.project_brief, AiJobType.detect_conflicts, AiJobType.extract_decisions ->
                contextBuilder.buildProjectContext(target())
            AiJobType.chat_reply -> {
                val roomId = req.chatRoomId
                    ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "chatRoomId required for ${type.name}")
                val base = chatTargetContext(target())
                val history = contextBuilder.buildChatContext(roomId)
                buildString {
                    append(base)
                    if (history.isNotBlank()) {
                        appendLine()
                        appendLine("## 直近の会話")
                        append(history)
                    }
                }
            }
        }
    }

    /** チャットの文脈対象は board / document / project のいずれか */
    private fun chatTargetContext(targetId: UUID): String {
        val node = nodeRepo.findById(targetId).orElseThrow {
            ResponseStatusException(HttpStatus.NOT_FOUND, "chat target not found: $targetId")
        }
        return when (node.type) {
            NodeType.board -> contextBuilder.buildBoardContext(targetId, 5000)
            NodeType.document -> contextBuilder.buildDocumentContext(targetId, 5000)
            NodeType.project -> contextBuilder.buildProjectContext(targetId, 8000)
            else -> throw ResponseStatusException(
                HttpStatus.BAD_REQUEST, "chat target must be board/document/project: ${node.type}",
            )
        }
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
        finalizeJob(saved)
        broadcast(saved)
        return AiJobDto.from(saved)
    }

    /**
     * ジョブ完了時のフォローアップ。chat_reply はAI応答を message ノードとして
     * サーバー側で作成する（ブラウザが閉じていても履歴が欠けない。
     * NodeService.upsert が node.created をWSブロードキャストするのでフロントは受信するだけ）。
     */
    private fun finalizeJob(job: AiJobEntity) {
        if (job.type != AiJobType.chat_reply.name || job.status != AiJobStatus.done) return
        val roomId = (job.payload["chatRoomId"] as? String)?.let(UUID::fromString) ?: return
        val room = nodeRepo.findById(roomId).orElse(null) ?: return
        val text = job.result?.takeIf { it.isNotBlank() } ?: return
        nodeService.upsert(
            UpsertNodeRequest(
                id = UUID.randomUUID(),
                workspaceId = room.workspaceId,
                parentId = roomId,
                type = NodeType.message,
                name = text.replace("\n", " ").take(30),
                data = mapOf("author" to "ai", "text" to text, "jobId" to job.id.toString()),
            ),
        )
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

    /**
     * Agent未接続時のダミー応答。JSON系種別は必ず妥当なJSONを返す
     * （フロントのパース経路・E2Eをmockモードで検証できるようにするため）。
     */
    private fun mockResult(type: AiJobType, context: String, prompt: String?): String = when (type) {
        AiJobType.brainstorm ->
            """["(Mock) アイデア案1","(Mock) アイデア案2","(Mock) アイデア案3"]"""
        AiJobType.detect_conflicts ->
            """[{"topic":"(Mock) 論点の例","a":"ボード上の記述A","b":"ドキュメント上の記述B","hint":"Agent接続時に実際の矛盾を検出します"}]"""
        AiJobType.extract_decisions ->
            """{"decisions":["(Mock) 決定事項の例"],"openQuestions":["(Mock) 未解決事項の例"]}"""
        else -> {
            val lines = context.lines().filter { it.startsWith("- ") }
            buildString {
                appendLine("【Mock応答 (${type.name}) — Kurari Agent 未接続のためダミー応答です】")
                appendLine()
                if (lines.isNotEmpty()) {
                    appendLine("コンテキスト内の要素 ${lines.size} 件:")
                    lines.take(10).forEach { appendLine(it) }
                }
                if (prompt != null) {
                    appendLine()
                    appendLine("(指示: $prompt)")
                }
                appendLine()
                appendLine("実際のAI応答を使うには、ローカルで `cd agent && npm start` を実行してください。")
            }
        }
    }
}
