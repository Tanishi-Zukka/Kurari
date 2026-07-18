package app.kurari.ws

import app.kurari.ai.AiJobService
import app.kurari.ai.CreateAiJobRequest
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Lazy
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.handler.TextWebSocketHandler
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.ConcurrentHashMap

/**
 * /ws に接続した全クライアントへアプリイベントを配信する。
 * 受信はプレゼンス（presence.join / presence.update）と通話シグナリング（call.*）のみ扱い、
 * それ以外のデータ変更は従来どおり REST 経由。未知の受信 type は黙殺する。
 * call.signal の description / candidate は中身を検証せずそのまま宛先へ中継する。
 */
@Component
class EventBroadcaster(
    private val objectMapper: ObjectMapper,
    private val presence: PresenceRegistry,
    private val calls: CallRegistry,
    private val transcripts: CallTranscriptRegistry,
    @Lazy private val aiJobs: AiJobService,
    @Value("\${kurari.presence.offline-after-seconds}") private val presenceTtlSeconds: Long,
    @Value("\${kurari.call.minutes-min-chars:100}") private val minutesMinChars: Int,
) : TextWebSocketHandler() {

    private val log = LoggerFactory.getLogger(javaClass)
    private val sessions = ConcurrentHashMap<String, WebSocketSession>()

    override fun afterConnectionEstablished(session: WebSocketSession) {
        sessions[session.id] = session
    }

    override fun afterConnectionClosed(session: WebSocketSession, status: CloseStatus) {
        sessions.remove(session.id)
        if (presence.leave(session.id)) broadcast("presence.peers", presence.peers())
        removeCallParticipant(session.id)
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
            "call.join" -> {
                calls.join(
                    CallParticipant(
                        sessionId = session.id,
                        muted = payload["muted"]?.asBoolean() ?: false,
                        cameraOff = payload["cameraOff"]?.asBoolean() ?: false,
                        screenStreamId = payload["screenStreamId"]?.takeIf { it.isTextual }?.asText(),
                    ),
                )
                sendTo(session, "call.joined", mapOf("participants" to calls.participants()))
                broadcast("call.participants", calls.participants())
            }
            "call.leave" -> {
                removeCallParticipant(session.id)
            }
            "call.media" -> {
                val updated = calls.updateMedia(
                    session.id,
                    muted = payload["muted"]?.asBoolean() ?: false,
                    cameraOff = payload["cameraOff"]?.asBoolean() ?: false,
                    screenStreamId = payload["screenStreamId"]?.takeIf { it.isTextual }?.asText(),
                )
                if (updated) broadcast("call.participants", calls.participants())
            }
            "call.transcript" -> {
                if (!calls.contains(session.id)) return
                val text = payload["text"]?.asText()?.trim()?.take(500).orEmpty()
                if (text.isEmpty()) return
                val speaker = presence.peers().firstOrNull { it.sessionId == session.id }?.name ?: "不明"
                transcripts.append(TranscriptLine(speaker = speaker, text = text, at = Instant.now()))
            }
            "call.signal" -> {
                // WebRTC の offer/answer/ICE を宛先セッションへそのまま中継（宛先不在は黙殺）
                val to = payload["to"]?.asText() ?: return
                val target = sessions[to] ?: return
                val relayed = mutableMapOf<String, Any?>("from" to session.id)
                if (payload.has("description")) relayed["description"] = payload["description"]
                if (payload.has("candidate")) relayed["candidate"] = payload["candidate"]
                sendTo(target, "call.signal", relayed)
            }
        }
    }

    /** update が途絶えたゾンビセッションを掃除する（FIN が届かない切断対策） */
    @Scheduled(fixedDelay = 30_000)
    fun evictStalePresence() {
        if (presence.evictStale(presenceTtlSeconds)) broadcast("presence.peers", presence.peers())
        // presence から消えたセッションは通話からも退出させる
        callParticipantsChanged(calls.retainOnly(presence.peers().map { it.sessionId }.toSet()))
    }

    private fun removeCallParticipant(sessionId: String) {
        callParticipantsChanged(calls.leave(sessionId))
    }

    /** 退出3経路の参加者更新と、最後の退出時の議事録生成を一か所で扱う。 */
    private fun callParticipantsChanged(changed: Boolean) {
        if (!changed) return
        val participants = calls.participants()
        broadcast("call.participants", participants)
        if (participants.isNotEmpty()) return

        if (transcripts.totalChars() < minutesMinChars) {
            transcripts.clear()
            return
        }
        val lines = transcripts.snapshotAndClear()
        if (lines.isEmpty()) return
        val zone = ZoneId.of("Asia/Tokyo")
        val time = DateTimeFormatter.ofPattern("HH:mm").withZone(zone)
        val dateTime = DateTimeFormatter.ofPattern("M/d HH:mm").withZone(zone)
        val sourceText = buildString {
            appendLine("参加者: ${lines.map { it.speaker }.distinct().joinToString("、")}")
            appendLine("開始: ${dateTime.format(lines.first().at)}")
            appendLine("終了: ${dateTime.format(lines.last().at)}")
            appendLine()
            lines.forEach { appendLine("[${time.format(it.at)}] ${it.speaker}: ${it.text}") }
        }
        try {
            aiJobs.create(CreateAiJobRequest(type = "call_minutes", sourceText = sourceText))
        } catch (e: Exception) {
            log.error("failed to create call minutes job", e)
        }
    }

    fun broadcast(type: String, payload: Any) {
        val message = TextMessage(objectMapper.writeValueAsString(mapOf("type" to type, "payload" to payload)))
        sessions.forEach { (id, session) ->
            try {
                synchronized(session) {
                    if (session.isOpen) session.sendMessage(message)
                }
            } catch (e: Exception) {
                log.warn("ws send failed, dropping session: {}", e.message)
                sessions.remove(id)
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
