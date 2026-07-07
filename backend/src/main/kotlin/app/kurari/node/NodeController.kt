package app.kurari.node

import jakarta.validation.Valid
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

@RestController
@RequestMapping("/api")
class NodeController(private val service: NodeService) {

    @GetMapping("/health")
    fun health(): Map<String, String> = mapOf("status" to "ok")

    @GetMapping("/workspace")
    fun workspace(): NodeDto = service.defaultWorkspace()

    @GetMapping("/nodes")
    fun list(@RequestParam workspaceId: UUID): List<NodeDto> = service.listByWorkspace(workspaceId)

    @PostMapping("/nodes")
    fun upsert(@Valid @RequestBody req: UpsertNodeRequest): NodeDto = service.upsert(req)

    @PatchMapping("/nodes/{id}")
    fun patch(@PathVariable id: UUID, @RequestBody req: PatchNodeRequest): NodeDto =
        service.patch(id, req)

    @DeleteMapping("/nodes/{id}")
    fun delete(@PathVariable id: UUID): ResponseEntity<Void> {
        service.softDelete(id)
        return ResponseEntity.noContent().build()
    }
}
