package app.kurari.ai

import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

data class TriggerCallLiveSummaryRequest(val runner: String? = null)

@RestController
@RequestMapping("/api/call/live-summary")
class CallLiveSummaryController(private val service: CallLiveSummaryService) {
    @PostMapping
    fun trigger(
        @RequestBody(required = false) request: TriggerCallLiveSummaryRequest?,
    ): ResponseEntity<AiJobDto> {
        val job = service.trigger(manual = true, runner = request?.runner)
            ?: return ResponseEntity.noContent().build()
        return ResponseEntity.ok(job)
    }
}
