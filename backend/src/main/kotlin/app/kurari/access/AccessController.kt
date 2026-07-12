package app.kurari.access

import app.kurari.ws.EventBroadcaster
import jakarta.servlet.http.HttpServletRequest
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * LAN 共有の参加リクエスト・承認 API。
 * join / join status / me は認可前でも呼べる（AccessInterceptor の許可リスト）。
 * invite / pending / approve / deny はオーナー（localhost）のみ。
 */
@RestController
@RequestMapping("/api/access")
class AccessController(
    private val registry: AccessRegistry,
    private val broadcaster: EventBroadcaster,
    @Value("\${kurari.access.max-pending}") private val maxPending: Int,
) {

    data class JoinBody(val inviteToken: String?, val clientId: String?, val name: String?)

    @PostMapping("/join")
    fun join(@RequestBody body: JoinBody, request: HttpServletRequest): Map<String, String> {
        val inviteToken = body.inviteToken
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "招待トークンがありません")
        if (!registry.isInviteValid(inviteToken)) {
            throw ResponseStatusException(HttpStatus.GONE, "招待リンクが無効か期限切れです。オーナーに新しいリンクを発行してもらってください")
        }
        if (registry.pendingCount() >= maxPending) {
            throw ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "承認待ちが混み合っています。しばらくしてからやり直してください")
        }
        val clientId = body.clientId?.takeIf { it.isNotBlank() }
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST, "clientId がありません")
        val name = (body.name ?: "").trim().ifEmpty { "ゲスト" }.take(40)
        val req = registry.submitJoin(clientId, name, ClientIp.effectiveIp(request))
        broadcaster.broadcast(
            "access.requested",
            mapOf("requestId" to req.requestId, "name" to req.name, "requestedAt" to req.requestedAt.toString()),
        )
        return mapOf("requestId" to req.requestId)
    }

    @GetMapping("/join/{requestId}")
    fun joinStatus(@PathVariable requestId: String): Map<String, String?> {
        val req = registry.findRequest(requestId)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "リクエストが見つかりません。もう一度参加リクエストを送ってください")
        // accessToken はこのポーリング応答でだけ返す（WS ブロードキャストには載せない）
        return mapOf("status" to req.status.name.lowercase(), "accessToken" to req.accessToken)
    }

    @GetMapping("/me")
    fun me(request: HttpServletRequest): Map<String, String?> {
        if (ClientIp.isOwner(request)) return mapOf("role" to "owner")
        val member = registry.memberOf(bearerToken(request))
        return if (member != null) mapOf("role" to "member", "name" to member.name)
        else mapOf("role" to "guest")
    }

    // ---- 以下はオーナーのみ ----

    @PostMapping("/invite")
    fun invite(request: HttpServletRequest): Map<String, Any> {
        requireOwner(request)
        val (token, expiresAt) = registry.issueInvite()
        // URL の組み立てはフロント側（プロトコル・ポートはブラウザが知っている）
        return mapOf("token" to token, "expiresAt" to expiresAt.toString(), "lanIps" to lanIps())
    }

    @GetMapping("/pending")
    fun pending(request: HttpServletRequest): List<Map<String, String>> {
        requireOwner(request)
        return registry.pending().map {
            mapOf("requestId" to it.requestId, "name" to it.name, "ip" to it.ip, "requestedAt" to it.requestedAt.toString())
        }
    }

    @PostMapping("/pending/{requestId}/approve")
    fun approve(@PathVariable requestId: String, request: HttpServletRequest): Map<String, String> {
        requireOwner(request)
        val req = registry.approve(requestId)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "リクエストが見つかりません")
        broadcaster.broadcast("access.resolved", mapOf("requestId" to requestId, "status" to req.status.name.lowercase()))
        return mapOf("status" to req.status.name.lowercase())
    }

    @PostMapping("/pending/{requestId}/deny")
    fun deny(@PathVariable requestId: String, request: HttpServletRequest): Map<String, String> {
        requireOwner(request)
        val req = registry.deny(requestId)
            ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "リクエストが見つかりません")
        broadcaster.broadcast("access.resolved", mapOf("requestId" to requestId, "status" to req.status.name.lowercase()))
        return mapOf("status" to req.status.name.lowercase())
    }

    private fun requireOwner(request: HttpServletRequest) {
        if (!ClientIp.isOwner(request)) {
            throw ResponseStatusException(HttpStatus.FORBIDDEN, "オーナーのみ実行できます")
        }
    }

    private fun lanIps(): List<String> =
        NetworkInterface.getNetworkInterfaces().asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.asSequence() }
            .filterIsInstance<Inet4Address>()
            .filter { it.isSiteLocalAddress }
            .map { it.hostAddress }
            .toList()
}
