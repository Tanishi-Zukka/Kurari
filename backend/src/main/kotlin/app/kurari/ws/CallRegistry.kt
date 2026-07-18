package app.kurari.ws

import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

/** 通話参加者1人分。名前・色は presence から引くためここでは持たない */
data class CallParticipant(
    val sessionId: String,
    val muted: Boolean = false,
    val cameraOff: Boolean = false,
    val screenStreamId: String? = null,
)

/**
 * ワークスペース通話（1ルーム）の参加者をメモリで管理する（永続化しない）。
 * 独自 TTL は持たない — 参加者は必ず presence にも join しているため、
 * presence の生存セッションとの突き合わせ（retainOnly）で掃除する。
 */
@Component
class CallRegistry {

    private val entries = ConcurrentHashMap<String, CallParticipant>()

    fun join(participant: CallParticipant) {
        entries[participant.sessionId] = participant
    }

    /** 参加中ならメディア状態を更新して true。未参加は false（黙殺させる） */
    fun updateMedia(sessionId: String, muted: Boolean, cameraOff: Boolean, screenStreamId: String?): Boolean =
        entries.computeIfPresent(sessionId) { _, p ->
            p.copy(muted = muted, cameraOff = cameraOff, screenStreamId = screenStreamId)
        } != null

    /** 退出。実際に消えたら true（participants 再配信の要否判定に使う） */
    fun leave(sessionId: String): Boolean = entries.remove(sessionId) != null

    fun participants(): List<CallParticipant> = entries.values.toList()

    fun contains(sessionId: String): Boolean = entries.containsKey(sessionId)

    /** presence から消えたセッションを道連れに掃除。1件でも消したら true */
    fun retainOnly(alive: Set<String>): Boolean =
        entries.keys.removeIf { it !in alive }
}
