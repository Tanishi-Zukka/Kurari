package app.kurari.config

import app.kurari.node.NodeEntity
import app.kurari.node.NodeRepository
import app.kurari.node.NodeType
import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** 初回起動時に Workspace / Project / Board / 案内付箋 を投入する */
@Component
class SeedRunner(private val repo: NodeRepository) : ApplicationRunner {

    private val log = LoggerFactory.getLogger(javaClass)

    companion object {
        val WORKSPACE_ID: UUID = UUID.fromString("00000000-0000-0000-0000-000000000001")
        val PROJECT_ID: UUID = UUID.fromString("00000000-0000-0000-0000-000000000002")
        val BOARD_ID: UUID = UUID.fromString("00000000-0000-0000-0000-000000000003")
    }

    @Transactional
    override fun run(args: ApplicationArguments) {
        if (repo.count() > 0) return
        log.info("seeding initial workspace")

        fun node(id: UUID, parent: UUID?, type: NodeType, name: String, order: String, data: Map<String, Any?> = emptyMap()) =
            NodeEntity(
                id = id, workspaceId = WORKSPACE_ID, parentId = parent, type = type,
                name = name, orderKey = order, data = data.toMutableMap(),
            )

        repo.save(node(WORKSPACE_ID, null, NodeType.workspace, "My Workspace", "a"))
        repo.save(node(PROJECT_ID, WORKSPACE_ID, NodeType.project, "Getting Started", "a"))
        repo.save(node(BOARD_ID, PROJECT_ID, NodeType.board, "First Board", "a"))
        repo.save(
            node(
                UUID.randomUUID(), BOARD_ID, NodeType.sticky, "Kurariへようこそ 👋", "a",
                mapOf(
                    "text" to "Kurariへようこそ 👋\nボードをダブルクリックすると付箋を作れます",
                    "color" to "yellow", "x" to 120, "y" to 120, "w" to 220, "h" to 120,
                ),
            ),
        )
        repo.save(
            node(
                UUID.randomUUID(), BOARD_ID, NodeType.sticky, "付箋を選択してみよう", "b",
                mapOf(
                    "text" to "付箋を選択すると、右のContext Panelにコメントが表示されます",
                    "color" to "blue", "x" to 420, "y" to 220, "w" to 220, "h" to 120,
                ),
            ),
        )
    }
}
