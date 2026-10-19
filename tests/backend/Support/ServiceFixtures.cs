using LyricBridge;

public static class ServiceFixtures
{
    // Synthetic options with explicit, predictable test identities. Settings remain mutable test inputs.
    public static ServiceCatalog Catalog(Func<ServiceConfig[]> settings) => new(() =>
    {
        var values = settings();
        return new ServiceSetup
        {
            Connections = values.Where(c => c.Name != "Google").Select(c => new ServiceConnection { Id = c.Name, Name = c.Name, Provider = c.Name, Endpoint = c.Endpoint, ApiKey = c.ApiKey }).ToArray(),
            Options = values.SelectMany(c => (c.Name is "Google" or "AI" ? new[] { "translation", "pronunciation" } : ["translation"]).Select(capability =>
                new ServiceOption { Id = capability + "-" + c.Name, Name = c.Name, Capability = capability, Provider = c.Name, ConnectionId = c.Name == "Google" ? null : c.Name, Model = c.Model, TimeoutSeconds = c.TimeoutSeconds, ReasoningEffort = c.ReasoningEffort, ContextBefore = c.ContextBefore, ContextAfter = c.ContextAfter, ModelContextWindow = c.ModelContextWindow, ModelCompletionLimit = c.ModelCompletionLimit })).ToArray()
        };
    });
    public static ServiceSetup Configured()
    {
        var setup = ServiceSetup.Defaults();
        foreach (var connection in setup.Connections) { connection.Endpoint = "https://api.example/v1"; connection.ApiKey = "private-key"; }
        foreach (var option in setup.Options) { option.Enabled = true; option.Model = option.Capability == "transcription" ? "audio-model" : "text-model"; }
        return setup;
    }
}
