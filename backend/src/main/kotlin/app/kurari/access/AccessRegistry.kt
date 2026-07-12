package app.kurari.access

import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.security.SecureRandom
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

/**
 * LAN 共有のアクセス制御をメモリで管理する（presence と同じ流儀・永続化しない）。
 * - invite: オーナーが発行する招待トークン。最新1本のみ有効（再発行が実質の失効手段）
 * - requests: 参加リクエスト。承認/拒否の結果はポーリングで参加者に返す
 * - tokens: 承認で発行するアクセストークン。失効は backend 再起動のみ
 */
@Component
class AccessRegistry(
    @Value("\${kurari.access.invite-ttl-seconds}") private val inviteTtlSeconds: Long,
    @Value("\${kurari.access.pending-ttl-seconds}") private val pendingTtlSeconds: Long,
    @Value("\${kurari.access.resolved-ttl-seconds}") private val resolvedTtlSeconds: Long,
) {

    enum class JoinStatus { PENDING, APPROVED, DENIED }

    data class JoinRequest(
        val requestId: String,
        val clientId: String,
        val name: String,
        val ip: String,
        val requestedAt: Instant,
        val status: JoinStatus = JoinStatus.PENDING,
        val accessToken: String? = null,
        val resolvedAt: Instant? = null,
    )

    data class Member(val clientId: String, val name: String, val approvedAt: Instant)

    private data class Invite(val token: String, val expiresAt: Instant)

    private val invite = AtomicReference<Invite?>()
    private val requests = ConcurrentHashMap<String, JoinRequest>()
    private val tokens = ConcurrentHashMap<String, Member>()
    private val random = SecureRandom()

    fun issueInvite(): Pair<String, Instant> {
        val token = randomToken()
        val expiresAt = Instant.now().plusSeconds(inviteTtlSeconds)
        invite.set(Invite(token, expiresAt))
        return token to expiresAt
    }

    fun isInviteValid(token: String): Boolean {
        val cur = invite.get() ?: return false
        return cur.token == token && cur.expiresAt.isAfter(Instant.now())
    }

    fun pendingCount(): Int = requests.values.count { it.status == JoinStatus.PENDING }

    fun submitJoin(clientId: String, name: String, ip: String): JoinRequest {
        val req = JoinRequest(
            requestId = UUID.randomUUID().toString(),
            clientId = clientId,
            name = name,
            ip = ip,
            requestedAt = Instant.now(),
        )
        requests[req.requestId] = req
        return req
    }

    fun findRequest(requestId: String): JoinRequest? = requests[requestId]

    fun pending(): List<JoinRequest> =
        requests.values.filter { it.status == JoinStatus.PENDING }.sortedBy { it.requestedAt }

    /** PENDING のときだけ承認してトークン発行。それ以外は現状を返す */
    fun approve(requestId: String): JoinRequest? {
        var result: JoinRequest? = null
        requests.computeIfPresent(requestId) { _, r ->
            if (r.status != JoinStatus.PENDING) {
                result = r
                r
            } else {
                val token = randomToken()
                tokens[token] = Member(r.clientId, r.name, Instant.now())
                r.copy(status = JoinStatus.APPROVED, accessToken = token, resolvedAt = Instant.now())
                    .also { result = it }
            }
        }
        return result
    }

    fun deny(requestId: String): JoinRequest? {
        var result: JoinRequest? = null
        requests.computeIfPresent(requestId) { _, r ->
            if (r.status != JoinStatus.PENDING) {
                result = r
                r
            } else {
                r.copy(status = JoinStatus.DENIED, resolvedAt = Instant.now()).also { result = it }
            }
        }
        return result
    }

    fun memberOf(token: String?): Member? = token?.let { tokens[it] }

    private fun randomToken(): String =
        ByteArray(32).also { random.nextBytes(it) }.joinToString("") { "%02x".format(it) }

    /** 期限切れリクエストの掃除。resolved はポーリングが結果を読む猶予を置いてから消す */
    @Scheduled(fixedDelay = 60_000)
    fun evictStale() {
        val now = Instant.now()
        requests.entries.removeIf { (_, r) ->
            when (r.status) {
                JoinStatus.PENDING -> r.requestedAt.plusSeconds(pendingTtlSeconds).isBefore(now)
                else -> (r.resolvedAt ?: r.requestedAt).plusSeconds(resolvedTtlSeconds).isBefore(now)
            }
        }
    }
}
