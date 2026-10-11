namespace LyricBridge;

public sealed record SafeError(string Code, string Message, bool Retryable = false, DateTime? RetryAt = null, string? DiagnosticId = null)
{
    public static SafeError Create(string code, string message, bool retryable = false, DateTime? retryAt = null) => new(code, message, retryable, retryAt, Guid.NewGuid().ToString("N"));
}

public sealed class ServiceFailure(string code, string message, DateTimeOffset? retryAt = null) : Exception(message) { public string Code => code; public DateTimeOffset? RetryAt => retryAt; }
