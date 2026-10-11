namespace LyricBridge;

public sealed class ServiceConfig
{
    public string Name { get; set; } = "Google";
    public string Endpoint { get; set; } = "";
    public string ApiKey { get; set; } = "";
    public string Model { get; set; } = "";
    public string ReasoningEffort { get; set; } = "";
    public int TimeoutSeconds { get; set; } = 15;
    public int ContextBefore { get; set; }
    public int ContextAfter { get; set; }
}
