package app.kurari.ws

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler
import java.util.concurrent.ConcurrentHashMap

/**
 * /ws に接続した全クライアントへアプリイベントを配信する。
 * 受信はプレゼンス（presence.join / presence.update）のみ扱い、
 * それ以外のデータ変更は従来どおり REST 経由。未知の受信 type は黙殺する。
 */
@Component
class EventBroadcaster(
    private val objectMapper: ObjectMapper,
    private val presence: PresenceRegistry,
    @Value("\${kurari.presence.offline-after-seconds}") private val presenceTtlSeconds: Long,
) : TextWebSocketHandler() {

    private val log = LoggerFactory.getLogger(javaClass)
    private val sessions = ConcurrentHashMap.newKeySet<WebSocketSession>()

    override fun afterConnectionEstablished(session: WebSocketSession) {
        sessions.add(session)
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        sessions.remove(session)
        if (presence.leave(session.id)) broadcast("presence.peers", presence.peers())
    }

    override fun handleTextMessage(session: WebSocketSession, message: TextMessage) {
        val root = try {
            objectMapper.readTree(message.payload)
        } catch (e: Exception) {
            return
        }
        val payload = root["payload"] ?: return
        when (root["type"]?.asText()) {
            "presence.join" -> {
                val clientId = payload["clientId"]?.asText() ?: return
                presence.join(
                    PresencePeer(
                        sessionId = session.id,
                        clientId = clientId,
                        name = payload["name"]?.asText() ?: "",
                        color = payload["color"]?.asText() ?: "gray",
                        location = parseLocation(payload["location"]) ?: PresenceLocation(),
                        selectedIds = parseSelectedIds(payload["selectedIds"]) ?: emptyList(),
                    ),
                )
                sendTo(session, "presence.joined", mapOf("sessionId" to session.id, "peers" to presence.peers()))
                broadcast("presence.peers", presence.peers())
            }
            "presence.update" -> {
                // 送られてきたフィールドだけ上書き（cursor は null 明示でクリア）。join 前は黙殺
                val updated = presence.update(session.id) { peer ->
                    peer.copy(
                        name = payload["name"]?.asText() ?: peer.name,
                        color = payload["color"]?.asText() ?: peer.color,
                        location = parseLocation(payload["location"]) ?: peer.location,
                        cursor = if (payload.has("cursor")) parseCursor(payload["cursor"]) else peer.cursor,
                        selectedIds = parseSelectedIds(payload["selectedIds"]) ?: peer.selectedIds,
                    )
                } ?: return
                broadcast("presence.updated", updated)
            }
        }
    }

    /** update が途絶えたゾンビセッションを掃除する（FIN が届かない切断対策） */
    @Scheduled(fixedDelay = 30_000)
    fun evictStalePresence() {
        if (presence.evictStale(presenceTtlSeconds)) broadcast("presence.peers", presence.peers())
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

    private fun sendTo(session: WebSocketSession, type: String, payload: Any) {
        val message = TextMessage(objectMapper.writeValueAsString(mapOf("type" to type, "payload" to payload)))
        try {
            synchronized(session) {
                if (session.isOpen) session.sendMessage(message)
            }
        } catch (e: Exception) {
            log.warn("ws send failed: {}", e.message)
        }
    }

    private fun parseLocation(node: JsonNode?): PresenceLocation? {
        if (node == null || !node.isObject) return null
        return PresenceLocation(
            mode = node["mode"]?.asText() ?: "board",
            boardId = node["boardId"]?.takeIf { it.isTextual }?.asText(),
            docId = node["docId"]?.takeIf { it.isTextual }?.asText(),
            editing = node["editing"]?.asBoolean() ?: false,
        )
    }

    private fun parseCursor(node: JsonNode?): PresenceCursor? {
        if (node == null || !node.isObject) return null
        val x = node["x"]?.takeIf { it.isNumber }?.asDouble() ?: return null
        val y = node["y"]?.takeIf { it.isNumber }?.asDouble() ?: return null
        return PresenceCursor(x, y)
    }

    private fun parseSelectedIds(node: JsonNode?): List<String>? {
        if (node == null || !node.isArray) return null
        return node.mapNotNull { it.takeIf { n -> n.isTextual }?.asText() }
    }
}
