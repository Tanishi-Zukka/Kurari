package app.kurari.ai

import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotNull
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
    @field:NotNull val boardId: UUID,
    val prompt: String? = null,
)

@RestController
@RequestMapping("/api/ai")
class AiController(private val service: AiJobService) {

    @GetMapping("/status")
    fun status(): AiStatusDto = service.status()

    @PostMapping("/jobs")
    fun create(@Valid @RequestBody req: CreateAiJobRequest): AiJobDto =
        service.create(req.type, req.boardId, req.prompt)

    @GetMapping("/jobs/{id}")
    fun get(@PathVariable id: UUID): AiJobDto = service.get(id)
}
