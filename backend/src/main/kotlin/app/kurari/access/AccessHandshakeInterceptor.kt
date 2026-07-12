package app.kurari.access

import org.springframework.http.HttpStatus
import org.springframework.http.server.ServerHttpRequest
import org.springframework.http.server.ServerHttpResponse
import org.springframework.stereotype.Component
import org.springframework.web.socket.WebSocketHandler
import org.springframework.web.socket.server.HandshakeInterceptor
import org.springframework.web.util.UriComponentsBuilder

/**
 * /ws 握手のアクセスゲート。オーナー（localhost）はそのまま、
 * メンバーは `?token=<アクセストークン>` を検証する（Vite プロキシを素通しできる方式）。
 */
@Component
class AccessHandshakeInterceptor(private val registry: AccessRegistry) : HandshakeInterceptor {

    override fun beforeHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        attributes: MutableMap<String, Any>,
    ): Boolean {
        val peer = request.remoteAddress?.address?.hostAddress ?: ""
        val xff = request.headers.getFirst("X-Forwarded-For")
        if (ClientIp.isLoopback(ClientIp.effective(peer, xff))) return true
        val token = UriComponentsBuilder.fromUri(request.uri).build().queryParams.getFirst("token")
        if (registry.memberOf(token) != null) return true
        response.setStatusCode(HttpStatus.UNAUTHORIZED)
        return false
    }

    override fun afterHandshake(
        request: ServerHttpRequest,
        response: ServerHttpResponse,
        wsHandler: WebSocketHandler,
        exception: Exception?,
    ) = Unit
}
