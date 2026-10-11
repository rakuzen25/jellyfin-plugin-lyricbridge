namespace LyricBridge;

public sealed class WorkflowException(int status, string code, string message, bool retryable = false) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public bool Retryable { get; } = retryable;
}
