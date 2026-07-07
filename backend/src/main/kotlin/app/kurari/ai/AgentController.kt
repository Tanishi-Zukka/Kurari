package app.kurari.ai

import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class CompleteJobRequest(
    val result: String? = null,
    val error: String? = null,
)

/**
 * Kurari Agent（ローカル常駐ワーカー）専用のエンドポイント。
 * Agent は外向き接続のみでジョブを取得し、Copilot CLI の実行結果を書き戻す。
 * 認証はMVPでは無し（ローカル前提）。AWSフェーズで Bearer トークンを追加する。
 */
@RestController
@RequestMapping("/api/agent")
class AgentController(private val service: AiJobService) {

    @PostMapping("/heartbeat")
    fun heartbeat(): Map<String, String> {
        service.heartbeat()
        return mapOf("status" to "ok")
    }

    @PostMapping("/jobs/claim")
    fun claim(): ResponseEntity<AiJobDto> {
        service.heartbeat()
        val job = service.claim() ?: return ResponseEntity.noContent().build()
        return ResponseEntity.ok(job)
    }

    @PostMapping("/jobs/{id}/complete")
    fun complete(@PathVariable id: UUID, @RequestBody req: CompleteJobRequest): AiJobDto =
        service.complete(id, req.result, req.error)
}
