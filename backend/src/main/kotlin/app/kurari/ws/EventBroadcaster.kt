package app.kurari.ws

import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler
import java.util.concurrent.ConcurrentHashMap

/**
 * /ws に接続した全クライアントへアプリイベントを配信する。
 * MVPでは受信は扱わない（送信専用）。
 */
@Component
class EventBroadcaster(private val objectMapper: ObjectMapper) : TextWebSocketHandler() {

    private val log = LoggerFactory.getLogger(javaClass)
    private val sessions = ConcurrentHashMap.newKeySet<WebSocketSession>()

    override fun afterConnectionEstablished(session: WebSocketSession) {
        sessions.add(session)
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        sessions.remove(session)
    }

    fun broadcast(type: String, payload: Any) {
        val message = TextMessage(objectMapper.writeValueAsString(mapOf("type" to type, "payload" to payload)))
        sessions.forEach { session ->
            try {
                synchronized(session) {
                    if (session.isOpen) session.sendMessage(message)
                }
            } catch (e: Exception) {
                log.warn("ws send failed, dropping session: {}", e.message)
                sessions.remove(session)
            }
        }
    }
}
