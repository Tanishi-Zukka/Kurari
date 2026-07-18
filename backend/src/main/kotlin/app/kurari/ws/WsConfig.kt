package app.kurari.ws

import app.kurari.access.AccessHandshakeInterceptor
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.socket.config.annotation.EnableWebSocket
import org.springframework.web.socket.config.annotation.WebSocketConfigurer
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean

@Configuration
@EnableWebSocket
class WsConfig(
    private val broadcaster: EventBroadcaster,
    private val accessHandshakeInterceptor: AccessHandshakeInterceptor,
) : WebSocketConfigurer {
    @Bean
    fun webSocketContainer(): ServletServerContainerFactoryBean =
        ServletServerContainerFactoryBean().apply {
            // 画面トラック追加後の SDP offer は Tomcat の既定値（8 KiB）を超える
            setMaxTextMessageBufferSize(64 * 1024)
        }

    override fun registerWebSocketHandlers(registry: WebSocketHandlerRegistry) {
        registry.addHandler(broadcaster, "/ws")
            .addInterceptors(accessHandshakeInterceptor)
            .setAllowedOriginPatterns("*")
    }
}
