package app.kurari.ws

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.time.Instant

data class TranscriptLine(
    val speaker: String,
    val text: String,
    val at: Instant,
)

/** 1ルーム分の通話文字起こしを、議事録生成までメモリに保持する。 */
@Component
class CallTranscriptRegistry(
    @Value("\${kurari.call.transcript-max-lines:2000}") private val maxLines: Int,
) {
    private val lines = mutableListOf<TranscriptLine>()

    fun append(line: TranscriptLine) = synchronized(lines) {
        lines.add(line)
        val overflow = lines.size - maxLines.coerceAtLeast(1)
        if (overflow > 0) lines.subList(0, overflow).clear()
    }

    fun snapshotAndClear(): List<TranscriptLine> = synchronized(lines) {
        lines.toList().also { lines.clear() }
    }

    fun totalChars(): Int = synchronized(lines) { lines.sumOf { it.text.length } }

    fun clear() = synchronized(lines) { lines.clear() }
}
