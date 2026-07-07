package app.kurari

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableScheduling

@SpringBootApplication
@EnableScheduling
class KurariApplication

fun main(args: Array<String>) {
    runApplication<KurariApplication>(*args)
}
