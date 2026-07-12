package app.kurari.ai

import jakarta.validation.constraints.NotBlank
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class CreateAiJobRequest(
    @field:NotBlank val type: String,
    /** board / document / project など、種別ごとの主対象ノード */
    val targetId: UUID? = null,
    /** summarize_selection: 選択された要素のID一覧 */
    val nodeIds: List<UUID>? = null,
    /** chat_reply: 会話履歴を持つ chat_room ノード */
    val chatRoomId: UUID? = null,
    val prompt: String? = null,
    /** summarize_transcript: クライアントで文字起こししたテキスト */
    val sourceText: String? = null,
    /** ページ側で選択された実行エンジン（copilot-cli / apple-ai / ollama）。Agent がジョブごとに参照 */
    val runner: String? = null,
)

@RestController
@RequestMapping("/api/ai")
class AiController(private val service: AiJobService) {

    @GetMapping("/status")
    fun status(): AiStatusDto = service.status()

    @PostMapping("/jobs")
    fun create(@Valid @RequestBody req: CreateAiJobRequest): AiJobDto =
        service.create(req)

    @GetMapping("/jobs/{id}")
    fun get(@PathVariable id: UUID): AiJobDto = service.get(id)
}
