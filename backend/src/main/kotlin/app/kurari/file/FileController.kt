package app.kurari.file

import org.springframework.beans.factory.annotation.Value
import org.springframework.core.io.FileSystemResource
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.MediaTypeFactory
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.multipart.MultipartFile
import org.springframework.web.server.ResponseStatusException
import java.nio.file.Files
import java.nio.file.Paths
import java.util.UUID

private const val MAX_FILE_SIZE_BYTES = 10L * 1024 * 1024

@RestController
@RequestMapping("/api/files")
class FileController(
    @Value("\${kurari.uploads.dir:./data/uploads}") private val uploadsDir: String,
) {

    @PostMapping
    fun upload(@RequestParam("file") file: MultipartFile): Map<String, String> {
        val contentType = file.contentType
        if (contentType == null || !contentType.startsWith("image/")) {
            throw ResponseStatusException(HttpStatus.BAD_REQUEST, "image files only")
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
            throw ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "file too large")
        }

        val dir = Paths.get(uploadsDir)
        Files.createDirectories(dir)

        val filename = UUID.randomUUID().toString() + sanitizeExtension(file.originalFilename)
        val target = dir.resolve(filename)
        file.inputStream.use { input -> Files.copy(input, target) }

        return mapOf("url" to "/api/files/$filename")
    }

    @GetMapping("/{filename}")
    fun download(@PathVariable filename: String): ResponseEntity<FileSystemResource> {
        val safeName = Paths.get(filename).fileName.toString()
        val target = Paths.get(uploadsDir).resolve(safeName)
        if (!Files.isRegularFile(target)) {
            throw ResponseStatusException(HttpStatus.NOT_FOUND, "file not found: $safeName")
        }

        val mediaType = MediaTypeFactory.getMediaType(safeName).orElse(MediaType.APPLICATION_OCTET_STREAM)
        return ResponseEntity.ok()
            .contentType(mediaType)
            .body(FileSystemResource(target))
    }

    /** 拡張子のみを許容し、先頭ドット込みで最大10文字に丸める（例: ".jpeg"） */
    private fun sanitizeExtension(originalFilename: String?): String {
        val name = originalFilename ?: return ""
        val dotIndex = name.lastIndexOf('.')
        if (dotIndex < 0 || dotIndex == name.length - 1) return ""
        val ext = name.substring(dotIndex + 1).filter { it.isLetterOrDigit() }.take(10)
        return if (ext.isEmpty()) "" else ".$ext"
    }
}
