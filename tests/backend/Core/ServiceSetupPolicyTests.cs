using LyricBridge;
using Xunit;

public sealed class ServiceSetupPolicyTests
{
    [Fact]
    public void DefaultsHaveOpaqueDistinctIdentitiesAndRoundTripWithoutChangingThem()
    {
        var setup = ServiceSetup.Defaults(); setup.Validate();
        var ids = setup.Connections.Select(c => c.Id).Concat(setup.Options.Select(o => o.Id)).ToList();
        Assert.All(ids, id => Assert.True(Guid.TryParseExact(id, "N", out _)));
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.Equal(Codec.Serialize(setup), Codec.Serialize(Codec.Deserialize<ServiceSetup>(Codec.Serialize(setup))));
        Assert.DoesNotContain(ServiceSetup.Defaults().Options, option => ids.Contains(option.Id));
        Assert.Equal(9, setup.Options.Length); Assert.Equal(4, setup.Connections.Length);
        Assert.False(setup.Options.Single(o => o.Capability == "transcription").Enabled);
        Assert.All(setup.Options, option => Assert.Equal(120, option.TimeoutSeconds));
    }
    [Fact]
    public void MissingFieldsRemainDraftsWhileMalformedValuesAreRejected()
    {
        var setup = ServiceFixtures.Configured(); var option = setup.Options.First(o => o.Provider == "AI"); option.Model = "";
        setup.Validate(); Assert.False(setup.Ready(option));
        setup.Connections[0].Endpoint = "https://secret:password@host/v1";
        Assert.Throws<ArgumentException>(() => setup.Validate());
    }
    [Fact]
    public void ExplicitOptionIsRequiredAndChoosesTheCorrectModel()
    {
        var setup = ServiceFixtures.Configured(); var a = setup.Options.Single(o => o.Capability == "translation" && o.Provider == "AI");
        var b = Codec.Deserialize<ServiceOption>(Codec.Serialize(a))!; b.Id = Guid.NewGuid().ToString("N"); b.Name = "Second model"; b.Model = "second-model"; setup.Options = [.. setup.Options, b]; setup.Validate();
        var catalog = new ServiceCatalog(() => setup);
        Assert.Equal("service_choice_required", Assert.Throws<WorkflowException>(() => catalog.Resolve("translation", null)).Code);
        Assert.Throws<WorkflowException>(() => catalog.Language(new GenerationRequest { Service = "AI" }));
        var request = new GenerationRequest { Kind = "translation", OptionId = b.Id };
        Assert.Equal("second-model", catalog.Language(request).Model);
        Assert.Equal("AI", request.Service); Assert.Equal("Second model", request.OptionName);
        Assert.Throws<WorkflowException>(() => catalog.Resolve("pronunciation", b.Id));
        b.Enabled = false; Assert.Throws<WorkflowException>(() => catalog.Resolve("translation", b.Id));
    }
}
