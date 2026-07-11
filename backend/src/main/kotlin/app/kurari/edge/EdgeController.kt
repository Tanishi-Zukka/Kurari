package app.kurari.edge

import jakarta.validation.Valid
import jakarta.validation.constraints.NotNull
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

data class UpsertEdgeRequest(
    @field:NotNull val id: UUID,
    @field:NotNull val workspaceId: UUID,
    @field:NotNull val boardId: UUID,
    @field:NotNull val sourceNodeId: UUID,
    @field:NotNull val targetNodeId: UUID,
    val label: String = "",
    val data: Map<String, Any?> = emptyMap(),
)

@RestController
@RequestMapping("/api/edges")
class EdgeController(private val service: EdgeService) {

    @GetMapping
    fun list(@RequestParam workspaceId: UUID): List<EdgeDto> = service.listByWorkspace(workspaceId)

    @PostMapping
    fun upsert(@Valid @RequestBody req: UpsertEdgeRequest): EdgeDto =
        service.upsert(
            EdgeDto(
                id = req.id, workspaceId = req.workspaceId, boardId = req.boardId,
                sourceNodeId = req.sourceNodeId, targetNodeId = req.targetNodeId,
                label = req.label, data = req.data,
                createdAt = java.time.Instant.now(), updatedAt = java.time.Instant.now(),
            ),
        )

    @DeleteMapping("/{id}")
    fun delete(@PathVariable id: UUID): ResponseEntity<Void> {
        service.softDelete(id)
        return ResponseEntity.noContent().build()
    }
}
