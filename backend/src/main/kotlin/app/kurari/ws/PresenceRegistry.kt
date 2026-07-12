package app.kurari.ws

import org.springframework.stereotype.Component
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/** ボード上のカーソル位置（flow 座標） */
data class PresenceCursor(val x: Double, val y: Double)

/** 「どの画面のどこを見ているか」。doc 編集中は editing=true */
data class PresenceLocation(
    val mode: String = "board",
    val boardId: String? = null,
    val docId: String? = null,
    val editing: Boolean = false,
)

/** 接続中クライアント1つ分のプレゼンス。sessionId はサーバ採番（同一人物の複数タブは別エントリ） */
data class PresencePeer(
    val sessionId: String,
    val clientId: String,
    val name: String,
    val color: String,
    val location: PresenceLocation = PresenceLocation(),
    val cursor: PresenceCursor? = null,
    val selectedIds: List<String> = emptyList(),
)

/**
 * 接続中クライアントのプレゼンスをメモリで管理する（永続化しない）。
 * 生存判定は agent heartbeat と同じ TTL 方式（update 受信で lastSeen を更新）。
 */
@Component
class PresenceRegistry {

    private data class Entry(val peer: PresencePeer, val lastSeenAt: Instant)

    private val entries = ConcurrentHashMap<String, Entry>()

    fun join(peer: PresencePeer) {
        entries[peer.sessionId] = Entry(peer, Instant.now())
    }

    /** join 済みなら patch を適用して返す。未 join は null（黙殺させる） */
    fun update(sessionId: String, patch: (PresencePeer) -> PresencePeer): PresencePeer? {
        var updated: PresencePeer? = null
        entries.computeIfPresent(sessionId) { _, entry ->
            Entry(patch(entry.peer), Instant.now()).also { updated = it.peer }
        }
        return updated
    }

    /** 退室。実際に消えたら true（peers 再配信の要否判定に使う） */
    fun leave(sessionId: String): Boolean = entries.remove(sessionId) != null

    fun peers(): List<PresencePeer> = entries.values.map { it.peer }

    /** lastSeen が ttl 秒を超えたエントリを掃除。1件でも消したら true */
    fun evictStale(ttlSeconds: Long): Boolean {
        val cutoff = Instant.now().minusSeconds(ttlSeconds)
        var removed = false
        entries.entries.removeIf { (_, entry) ->
            (entry.lastSeenAt < cutoff).also { if (it) removed = true }
        }
        return removed
    }
}
