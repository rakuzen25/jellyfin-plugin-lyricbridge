namespace LyricBridge;

public sealed class ServiceConnection
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Provider { get; set; } = "AI";
    public string Endpoint { get; set; } = "";
    public string ApiKey { get; set; } = "";
}
public sealed class ServiceOption
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Capability { get; set; } = "translation";
    public string Provider { get; set; } = "AI";
    public string? ConnectionId { get; set; }
    public bool Enabled { get; set; } = true;
    public string Model { get; set; } = "";
    public int TimeoutSeconds { get; set; } = 120;
    public int ModelContextWindow { get; set; } = 32768;
    public bool? DetectModelLimits { get; set; }
    public int? ModelCompletionLimit { get; set; }
    public string ReasoningEffort { get; set; } = "";
    public int ContextBefore { get; set; }
    public int ContextAfter { get; set; }
    public string UploadFormat { get; set; } = "opus";
    public int MaxUploadMb { get; set; } = 25;
    public int MaxInputMb { get; set; } = 256;
}
public sealed class ServiceSetup
{
    public int Version { get; set; } = 1;
    public ServiceConnection[] Connections { get; set; } = [];
    public ServiceOption[] Options { get; set; } = [];
    public static readonly string[] Capabilities = ["transcription", "translation", "pronunciation", "boundary-review"];
    public static bool Supports(string provider, string capability) => provider switch
    {
        "AI" => Capabilities.Contains(capability),
        "Google" => capability is "translation" or "pronunciation",
        "Kawazu" => capability == "pronunciation",
        "DeepL" or "LibreTranslate" => capability == "translation",
        _ => false
    };
    public static bool EndpointValid(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && uri.UserInfo.Length == 0 && uri.Fragment.Length == 0 && uri.Query.Length == 0;
    public bool Ready(ServiceOption option)
    {
        if (!option.Enabled || !Supports(option.Provider, option.Capability)) return false;
        if (option.Provider is "Google" or "Kawazu") return true;
        var c = Connections.FirstOrDefault(c => c.Id == option.ConnectionId && c.Provider == option.Provider);
        return c != null && (c.Provider == "DeepL" && string.IsNullOrEmpty(c.Endpoint) || EndpointValid(c.Endpoint)) && (c.Provider != "DeepL" || !string.IsNullOrWhiteSpace(c.ApiKey)) && (c.Provider != "AI" || !string.IsNullOrWhiteSpace(option.Model));
    }
    public void Validate(ServiceSetup? previous = null)
    {
        if (Version != 1 || Connections == null || Options == null || Connections.Any(c => c == null) || Options.Any(o => o == null)) throw new ArgumentException("Invalid service configuration.");
        static bool Id(string value) => !string.IsNullOrEmpty(value) && value.Length <= 100 && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
        if (Connections.Any(c => !Id(c.Id) || string.IsNullOrWhiteSpace(c.Name) || c.Name.Length > 100 || c.Provider is not ("AI" or "DeepL" or "LibreTranslate") || !string.IsNullOrEmpty(c.Endpoint) && !EndpointValid(c.Endpoint)) || Connections.Select(c => c.Id).Distinct().Count() != Connections.Length || Connections.Select(c => c.Name.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count() != Connections.Length) throw new ArgumentException("Use unique connection names and valid HTTP(S) API URLs without credentials, queries or fragments.");
        if (Options.Any(o => string.IsNullOrWhiteSpace(o.Name) || o.Model == null || o.ReasoningEffort == null) || Options.Select(o => o.Id).Distinct().Count() != Options.Length || Options.GroupBy(o => o.Capability).Any(g => g.Select(o => o.Name.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count() != g.Count())) throw new ArgumentException("Use unique option names within each capability.");
        foreach (var o in Options)
        {
            if (!Id(o.Id) || string.IsNullOrWhiteSpace(o.Name) || o.Name.Length > 100 || o.Model.Length > 200 || !Supports(o.Provider, o.Capability) || o.ModelContextWindow is < 1024 or > 10000000 || o.ModelCompletionLimit is < 1 or > 10000000 || o.TimeoutSeconds < 5 || o.TimeoutSeconds > (o.Capability == "transcription" ? 3600 : 600) || o.ContextBefore is < 0 or > 10 || o.ContextAfter is < 0 or > 10 || !new[] { "", "none", "minimal", "low", "medium", "high", "xhigh" }.Contains(o.ReasoningEffort) || o.UploadFormat is not ("flac" or "wav" or "opus") || o.MaxUploadMb is < 1 or > 1024 || o.MaxInputMb is < 1 or > 4096) throw new ArgumentException("Invalid capability option settings.");
            if (o.Provider is "Google" or "Kawazu") { if (o.ConnectionId != null) throw new ArgumentException("Built-in options do not use a connection."); }
            else if (!Connections.Any(c => c.Id == o.ConnectionId && c.Provider == o.Provider)) throw new ArgumentException("Choose a compatible connection for every remote option.");
        }
        if (previous != null)
            foreach (var old in previous.Connections)
            {
                var next = Connections.FirstOrDefault(c => c.Id == old.Id);
                if (Options.Any(o => o.ConnectionId == old.Id) && (next == null || next.Provider != old.Provider)) throw new ArgumentException("Remove referencing options before deleting a connection or changing its type.");
            }
    }
    public static ServiceSetup Migrate(ServiceConfig[] services, TranscriptionConfig transcription)
    {
        var connections = new List<ServiceConnection>(); var options = new List<ServiceOption>();
        string Connect(string seed, string name, string provider, string endpoint, string key)
        {
            var existing = connections.FirstOrDefault(c => c.Provider == provider && c.Endpoint == endpoint && c.ApiKey == key);
            if (existing != null) return existing.Id;
            var label = name; for (var i = 2; connections.Any(c => c.Name == label); i++) label = name + " " + i;
            var c = new ServiceConnection { Id = "connection-" + seed, Name = label, Provider = provider, Endpoint = endpoint, ApiKey = key }; connections.Add(c); return c.Id;
        }
        ServiceOption From(string id, string capability, string name, ServiceConfig s) => new() { Id = id, Capability = capability, Name = name, Provider = s.Name, ConnectionId = s.Name is "Google" or "Kawazu" ? null : Connect(s.Name.ToLowerInvariant(), s.Name == "AI" ? "AI service" : s.Name, s.Name, s.Endpoint, s.ApiKey), Model = s.Model, TimeoutSeconds = s.TimeoutSeconds, ReasoningEffort = s.ReasoningEffort, ContextBefore = s.ContextBefore, ContextAfter = s.ContextAfter };
        foreach (var s in services)
        {
            options.Add(From("legacy-translation-" + s.Name.ToLowerInvariant(), "translation", s.Name, s));
            if (s.Name is "Google" or "AI") options.Add(From("legacy-pronunciation-" + s.Name.ToLowerInvariant(), "pronunciation", s.Name, s));
        }
        options.Add(new() { Id = "legacy-pronunciation-kawazu", Capability = "pronunciation", Name = "Japanese romaji", Provider = "Kawazu" });
        options.Add(new() { Id = "legacy-transcription", Name = "Audio transcription", Capability = "transcription", Provider = "AI", ConnectionId = Connect("transcription", "Transcription service", "AI", transcription.Endpoint, transcription.ApiKey), Enabled = transcription.Enabled, Model = transcription.Model, TimeoutSeconds = transcription.TimeoutSeconds, UploadFormat = transcription.UploadFormat, MaxUploadMb = transcription.MaxUploadMb, MaxInputMb = transcription.MaxInputMb });
        var review = transcription.ReviewUsesAiService ? services.FirstOrDefault(s => s.Name == "AI") ?? new() { Name = "AI" } : transcription.Review;
        options.Add(new() { Id = "legacy-boundary-review", Name = "AI line-break review", Capability = "boundary-review", Provider = "AI", ConnectionId = Connect("review", "Review service", "AI", review.Endpoint, review.ApiKey), Model = review.Model, TimeoutSeconds = review.TimeoutSeconds, ReasoningEffort = review.ReasoningEffort });
        return new() { Connections = connections.ToArray(), Options = options.ToArray() };
    }
}
public sealed record ServiceOptionInfo(string Id, string Name, string Capability, string Provider, string Model, string Status, int MaxInputMb, int MaxUploadMb, string[] Languages);
public sealed class ServiceCatalog(Func<ServiceSetup> configuration)
{
    public ServiceSetup Configuration => configuration();
    public IReadOnlyList<ServiceOptionInfo> Options() => Configuration.Options.Select(o => new ServiceOptionInfo(o.Id, o.Name, o.Capability, o.Provider, o.Model, !o.Enabled ? "Disabled" : Configuration.Ready(o) ? "Ready" : "Needs setup", o.MaxInputMb, o.MaxUploadMb, o.Provider == "Google" && o.Capability == "pronunciation" ? ["ja", "ko", "zh", "zh-CN", "zh-TW", "ru", "ar", "hi", "th", "el"] : o.Provider == "Kawazu" ? ["ja"] : ["*"])).ToList();
    public ServiceOption Resolve(string capability, string? id, string? legacyProvider = null)
    {
        var setup = Configuration;
        var matches = setup.Options.Where(o => o.Capability == capability && (id != null ? o.Id == id : o.Provider == legacyProvider && o.Enabled)).ToList();
        if (matches.Count != 1) throw new WorkflowException(409, "service_choice_required", "Choose an available service option for this request.");
        var option = matches[0];
        if (!setup.Ready(option)) throw new WorkflowException(409, "service_not_configured", "This option is disabled or needs setup. Choose another option or ask an administrator to configure it.");
        return Codec.Deserialize<ServiceOption>(Codec.Serialize(option))!;
    }
    public ServiceConfig Settings(ServiceOption option)
    {
        var c = Configuration.Connections.FirstOrDefault(c => c.Id == option.ConnectionId);
        return new() { Name = option.Provider, Endpoint = c?.Endpoint ?? "", ApiKey = c?.ApiKey ?? "", Model = option.Model, TimeoutSeconds = option.TimeoutSeconds, ModelContextWindow = option.ModelContextWindow, ModelCompletionLimit = option.ModelCompletionLimit, ReasoningEffort = option.ReasoningEffort, ContextBefore = option.ContextBefore, ContextAfter = option.ContextAfter };
    }
    public void Restore(Job job)
    {
        if (job.Request.OptionId != null || job.Profile == null) return;
        var capability = job.TaskKind == "language" ? job.Request.Kind : job.TaskKind;
        var id = capability == "transcription" ? "legacy-transcription" : capability == "boundary-review" ? "legacy-boundary-review" : "legacy-" + capability + "-" + job.Request.Service.ToLowerInvariant();
        var option = Configuration.Options.FirstOrDefault(o => o.Id == id && o.Capability == capability);
        if (option == null) return;
        job.Request.OptionId = option.Id; job.Request.OptionName ??= option.Name;
        if (job.Audio != null) job.Audio = job.Audio with { OptionId = option.Id };
        if (job.Review != null) job.Review = job.Review with { OptionId = option.Id };
    }
    public ServiceConfig Language(GenerationRequest request)
    {
        var option = Resolve(request.Kind, request.OptionId, request.Service);
        request.OptionId = option.Id; request.OptionName = option.Name; request.Service = option.Provider;
        return Settings(option);
    }
    public TranscriptionConfig Transcription(Job job)
    {
        var option = Resolve("transcription", job.Audio?.OptionId ?? job.Request.OptionId, "AI"); job.Request.OptionId = option.Id; job.Request.OptionName = option.Name;
        var c = Settings(option);
        return new() { Enabled = true, Endpoint = c.Endpoint, ApiKey = c.ApiKey, Model = c.Model, TimeoutSeconds = c.TimeoutSeconds, UploadFormat = option.UploadFormat, MaxInputMb = option.MaxInputMb, MaxUploadMb = option.MaxUploadMb };
    }
    public ServiceConfig Review(Job job)
    {
        var option = Resolve("boundary-review", job.Review?.OptionId ?? job.Request.OptionId, "AI"); job.Request.OptionId = option.Id; job.Request.OptionName = option.Name;
        return Settings(option);
    }
}
