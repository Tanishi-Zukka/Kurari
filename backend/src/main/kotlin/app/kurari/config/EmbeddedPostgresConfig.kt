package app.kurari.config

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.context.annotation.Profile
import java.nio.file.Paths
import javax.sql.DataSource

/**
 * Docker が使えない環境向け: `--spring.profiles.active=embedded` で
 * PostgreSQL バイナリを backend/data/pg に展開してプロセス起動する。
 * データは data/pg に永続化され、再起動しても残る。
 */
@Configuration
@Profile("embedded")
class EmbeddedPostgresConfig {

    private val log = LoggerFactory.getLogger(javaClass)

    @Bean(destroyMethod = "close")
    fun embeddedPostgres(): EmbeddedPostgres {
        val dataDir = Paths.get("data/pg").toAbsolutePath()
        dataDir.parent.toFile().mkdirs()
        log.info("starting embedded PostgreSQL (data: {})", dataDir)
        return EmbeddedPostgres.builder()
            .setDataDirectory(dataDir)
            .setCleanDataDirectory(false)
            .start()
    }

    @Bean
    fun dataSource(pg: EmbeddedPostgres): DataSource = pg.postgresDatabase
}
