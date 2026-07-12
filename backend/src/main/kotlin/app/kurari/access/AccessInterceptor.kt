package app.kurari.access

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import org.springframework.web.servlet.HandlerInterceptor
import org.springframework.web.servlet.config.annotation.InterceptorRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

/** Authorization ヘッダから Bearer トークンを取り出す */
fun bearerToken(request: HttpServletRequest): String? =
    request.getHeader("Authorization")
        ?.takeIf { it.startsWith("Bearer ") }
        ?.removePrefix("Bearer ")
        ?.trim()
        ?.takeIf { it.isNotEmpty() }

/**
 * /api 配下全体のアクセスゲート。オーナー（localhost）と承認済みメンバーだけ通す。
 * 参加リクエスト関連と <img src> で読まれるファイル GET だけは認可前でも許可する。
 */
@Component
class AccessInterceptor(private val registry: AccessRegistry) : HandlerInterceptor {

    override fun preHandle(
        request: HttpServletRequest,
        response: HttpServletResponse,
        handler: Any,
    ): Boolean {
        if (request.method == "OPTIONS") return true // CORS preflight
        if (isPreAuth(request)) return true
        if (ClientIp.isOwner(request)) return true
        if (registry.memberOf(bearerToken(request)) != null) return true
        response.status = HttpServletResponse.SC_UNAUTHORIZED
        response.contentType = "application/json;charset=UTF-8"
        response.writer.write("""{"error":{"code":"UNAUTHORIZED","message":"アクセスが承認されていません"}}""")
        return false
    }

    /** method+path の許可リスト（excludePathPatterns はメソッド区別ができないためここで判定） */
    private fun isPreAuth(request: HttpServletRequest): Boolean {
        val path = request.requestURI
        return when (request.method) {
            "POST" -> path == "/api/access/join"
            "GET" ->
                path == "/api/access/me" ||
                    path.startsWith("/api/access/join/") ||
                    // ファイルはファイル名(UUID)を知っている人だけが読めるケーパビリティURL扱い
                    path.startsWith("/api/files/")
            else -> false
        }
    }
}

@Configuration
class AccessInterceptorConfig(private val accessInterceptor: AccessInterceptor) : WebMvcConfigurer {
    override fun addInterceptors(registry: InterceptorRegistry) {
        registry.addInterceptor(accessInterceptor).addPathPatterns("/api/**")
    }
}
