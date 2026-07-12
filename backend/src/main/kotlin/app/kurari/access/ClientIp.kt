package app.kurari.access

import jakarta.servlet.http.HttpServletRequest

/**
 * 実効クライアント IP の判定。Vite dev プロキシ（xfwd: true）前提のルール:
 * 1. 直接のピアが loopback でない → ピア IP（XFF は信用しない。LAN からの :8080 直叩き）
 * 2. ピアが loopback で XFF なし → loopback（= オーナー。agent / E2E / curl の直叩き）
 * 3. ピアが loopback で XFF あり（= Vite 経由）→ XFF の「最後の要素」を実効 IP とする。
 *    http-proxy は既存 XFF の末尾に実ピア IP を追記するため、末尾ルールなら偽装できない
 *    （先頭要素はクライアントが自由に付けられるので絶対に使わないこと）
 */
object ClientIp {

    private val LOOPBACKS = setOf("127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1")

    fun isLoopback(ip: String): Boolean = ip.trim() in LOOPBACKS

    fun effective(peer: String, xff: String?): String {
        if (!isLoopback(peer)) return peer
        val last = xff?.split(",")?.lastOrNull()?.trim()
        return if (last.isNullOrEmpty()) peer else last
    }

    fun effectiveIp(request: HttpServletRequest): String =
        effective(request.remoteAddr ?: "", request.getHeader("X-Forwarded-For"))

    /** オーナー = 実効 IP が loopback（サーバを起動したマシンからのアクセス） */
    fun isOwner(request: HttpServletRequest): Boolean = isLoopback(effectiveIp(request))
}
