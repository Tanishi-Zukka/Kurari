package app.kurari.ws

import org.springframework.stereotype.Component

data class TimerSnapshot(
    val phase: String,
    val endsAt: Long?,
    val remainingMs: Long,
    val durationMs: Long,
    val startedBy: String?,
)

/** ワークスペース全体で1本の、非永続な共有タイマー。 */
@Component
class TimerRegistry {
    private var phase = "idle"
    private var endsAt: Long? = null
    private var remainingMs = 0L
    private var durationMs = 0L
    private var startedBy: String? = null

    @Synchronized
    fun start(durationMs: Long, by: String) {
        this.phase = "running"
        this.durationMs = durationMs
        this.remainingMs = durationMs
        this.endsAt = System.currentTimeMillis() + durationMs
        this.startedBy = by
    }

    @Synchronized
    fun pause(): Boolean {
        if (phase != "running") return false
        remainingMs = maxOf(0L, (endsAt ?: System.currentTimeMillis()) - System.currentTimeMillis())
        endsAt = null
        phase = "paused"
        return true
    }

    @Synchronized
    fun resume(): Boolean {
        if (phase != "paused") return false
        endsAt = System.currentTimeMillis() + remainingMs
        phase = "running"
        return true
    }

    @Synchronized
    fun stop(): Boolean {
        if (phase == "idle") return false
        phase = "idle"
        endsAt = null
        remainingMs = 0
        durationMs = 0
        startedBy = null
        return true
    }

    @Synchronized
    fun snapshot(): TimerSnapshot {
        val currentRemaining = if (phase == "running") {
            maxOf(0L, (endsAt ?: System.currentTimeMillis()) - System.currentTimeMillis())
        } else remainingMs
        return TimerSnapshot(phase, endsAt, currentRemaining, durationMs, startedBy)
    }
}
