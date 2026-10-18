using LyricBridge;
using Xunit;

public sealed class ServiceSetupPolicyTests
{
    private static ServiceSetup Setup() => ServiceSetup.Migrate([new() { Name = "Google" }, new() { Name = "AI", Endpoint = "https://api.example/v1", ApiKey = "private-key", Model = "text-model" }], new() { Enabled = true, Endpoint = "https://api.example/v1", ApiKey = "private-key", Model = "audio-model" });
    [Fact]
    public void TimeoutDefaultsIncludeReviewAndPreserveConfiguredValues()
    {
        Assert.Equal(120, new ServiceConfig { Name = "AI" }.TimeoutSeconds);
        Assert.Equal(120, new ServiceOption().TimeoutSeconds);
        Assert.Equal(120, new TranscriptionConfig().TimeoutSeconds);
        Assert.Equal(120, new TranscriptionConfig().Review.TimeoutSeconds);
        var setup = ServiceSetup.Migrate([new() { Name = "AI", TimeoutSeconds = 45 }], new() { TimeoutSeconds = 300, ReviewUsesAiService = false, Review = new() { Name = "AI", TimeoutSeconds = 90 } });
        Assert.Equal(45, setup.Options.First(o => o.Capability == "translation" && o.Provider == "AI").TimeoutSeconds);
        Assert.Equal(90, setup.Options.Single(o => o.Capability == "boundary-review").TimeoutSeconds);
        Assert.Equal(300, setup.Options.Single(o => o.Capability == "transcription").TimeoutSeconds);
    }
    [Fact]
    public void MigrationIsDeterministicAndSharesOnlyIdenticalConnections()
    {
        var setup = Setup(); setup.Validate();
        Assert.Single(setup.Connections);
        Assert.Equal(Codec.Serialize(setup), Codec.Serialize(Setup()));
        Assert.Equal("audio-model", setup.Options.Single(o => o.Capability == "transcription").Model);
        Assert.Equal("text-model", setup.Options.Single(o => o.Capability == "boundary-review").Model);
        Assert.Contains(setup.Options, o => o.Provider == "Kawazu" && o.ConnectionId == null);
        var t = new TranscriptionConfig { Endpoint = "https://api.example/v1", ApiKey = "other-key" };
        var separate = ServiceSetup.Migrate([new() { Name = "AI", Endpoint = t.Endpoint, ApiKey = "private-key" }], t);
        Assert.Equal(2, separate.Connections.Length);
        Assert.False(separate.Options.Single(o => o.Capability == "transcription").Enabled);
    }
    [Fact]
    public void MissingFieldsRemainDraftsWhileMalformedValuesAreRejected()
    {
        var setup = Setup(); var option = setup.Options.First(o => o.Provider == "AI"); option.Model = "";
        setup.Validate(); Assert.False(setup.Ready(option));
        setup.Connections[0].Endpoint = "https://secret:password@host/v1";
        Assert.Throws<ArgumentException>(() => setup.Validate());
    }
    [Fact]
    public void ExplicitOptionChoosesCorrectModelAndLegacyAmbiguityIsRejected()
    {
        var setup = Setup(); var a = setup.Options.Single(o => o.Id == "legacy-translation-ai");
        var b = Codec.Deserialize<ServiceOption>(Codec.Serialize(a))!; b.Id = "alternative"; b.Name = "Second model"; b.Model = "second-model"; setup.Options = [.. setup.Options, b]; setup.Validate();
        var catalog = new ServiceCatalog(() => setup);
        Assert.Equal("service_choice_required", Assert.Throws<WorkflowException>(() => catalog.Resolve("translation", null, "AI")).Code);
        var request = new GenerationRequest { Kind = "translation", OptionId = b.Id };
        Assert.Equal("second-model", catalog.Language(request).Model);
        Assert.Equal("AI", request.Service); Assert.Equal("Second model", request.OptionName);
        Assert.Throws<WorkflowException>(() => catalog.Resolve("pronunciation", b.Id));
        b.Enabled = false; Assert.Throws<WorkflowException>(() => catalog.Resolve("translation", b.Id));
    }
}
