package app.kurari.config

import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.server.ResponseStatusException

@RestControllerAdvice
class ApiExceptionHandler {

    data class ApiError(val error: Body) {
        data class Body(val code: String, val message: String)
    }

    @ExceptionHandler(ResponseStatusException::class)
    fun handleStatus(e: ResponseStatusException): ResponseEntity<ApiError> =
        ResponseEntity.status(e.statusCode)
            .body(ApiError(ApiError.Body(e.statusCode.toString(), e.reason ?: "error")))

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidation(e: MethodArgumentNotValidException): ResponseEntity<ApiError> =
        ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ApiError(ApiError.Body("VALIDATION", e.bindingResult.fieldErrors.joinToString { "${it.field}: ${it.defaultMessage}" })))
}
