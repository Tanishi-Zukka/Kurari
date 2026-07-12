package app.kurari.ws

import app.kurari.access.AccessHandshakeInterceptor
import org.springframework.context.annotation.Configuration
import org.springframework.web.socket.config.annotation.EnableWebSocket
import org.springframework.web.socket.config.annotation.WebSocketConfigurer
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry

@Configuration
@EnableWebSocket
class WsConfig(
    private val broadcaster: EventBroadcaster,
    private val accessHandshakeInterceptor: AccessHandshakeInterceptor,
) : WebSocketConfigurer {
    override fun registerWebSocketHandlers(registry: WebSocketHandlerRegistry) {
        registry.addHandler(broadcaster, "/ws")
            .addInterceptors(accessHandshakeInterceptor)
            .setAllowedOriginPatterns("*")
    }
}
