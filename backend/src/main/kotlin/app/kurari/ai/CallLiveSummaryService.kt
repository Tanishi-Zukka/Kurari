package app.kurari.ai

import app.kurari.ws.CallRegistry
import app.kurari.ws.CallTranscriptRegistry
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Service
class CallLiveSummaryService(
    private val calls: CallRegistry,
    private val transcripts: CallTranscriptRegistry,
    private val aiJobs: AiJobService,
    private val repo: AiJobRepository,
    @Value("\${kurari.call.live-summary-min-new-chars:120}") private val minNewChars: Long,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun trigger(manual: Boolean, runner: String? = null): AiJobDto? {
        if (calls.participants().isEmpty()) return null
        val appended = transcripts.appendedChars()
        val newChars = appended - transcripts.summarizedChars()
        if (newChars < if (manual) 1 else minNewChars) return null
        if (repo.existsByTypeAndStatusIn(
                AiJobType.call_live_summary.name,
                listOf(AiJobStatus.pending, AiJobStatus.claimed),
            )) return null
        val lines = transcripts.snapshot()
        if (lines.isEmpty()) return null
        val time = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of("Asia/Tokyo"))
        val sourceText = lines.joinToString("\n") { "[${time.format(it.at)}] ${it.speaker}: ${it.text}" }
        val job = aiJobs.create(CreateAiJobRequest(
            type = AiJobType.call_live_summary.name,
            sourceText = sourceText,
            runner = runner,
        ))
        transcripts.markSummarized(appended)
        return job
    }

    @Scheduled(fixedDelayString = "\${kurari.call.live-summary-interval-ms:60000}")
    fun tick() {
        try {
            trigger(manual = false)
        } catch (e: Exception) {
            log.error("failed to create live summary job", e)
        }
    }
}
