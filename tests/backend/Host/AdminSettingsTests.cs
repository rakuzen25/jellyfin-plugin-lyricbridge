using System.Reflection;
using System.Text.Json;
using LyricBridge;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Xunit;

public sealed class AdminSettingsTests : TestHost
{
    private static Configuration Draft(SettingsSnapshot snapshot) => snapshot.Configuration.Deserialize<Configuration>()!;
    [Fact]
    public void SettingsRoutesAreAdministratorOnlyAndReadsNeverReturnCredentials()
    {
        Assert.Equal(Jellyfin.Api.Constants.UserRoles.Administrator, typeof(AdminSettingsApi).GetCustomAttribute<AuthorizeAttribute>()?.Roles);
        Plugin.Configuration.Sources.Single(s => s.Name == "Spotify").Credential = "saved-source-secret";
        Plugin.Configuration.Services[0].ApiKey = "legacy-service-secret";
        Plugin.Configuration.Transcription.ApiKey = "legacy-transcription-secret";
        Plugin.Configuration.Transcription.Review.ApiKey = "legacy-review-secret";
        Plugin.Configuration.ServiceSetup = new() { Connections = [new() { Id = "connection", Name = "Fixture", Provider = "AI", Endpoint = "https://example.test/v1", ApiKey = "saved-connection-secret" }] };
        var snapshot = Plugin.ReadAdminSettings(); var json = snapshot.Configuration.ToJsonString();
        foreach (var secret in new[] { "saved-source-secret", "legacy-service-secret", "legacy-transcription-secret", "legacy-review-secret", "saved-connection-secret" }) Assert.DoesNotContain(secret, json);
        Assert.Contains("CredentialPresent", json); Assert.Contains("CredentialVersion", json);
    }
    [Fact]
    public void SaveMergesExplicitCredentialInstructionsAndRejectsStaleOrResetWrites()
    {
        var source = Plugin.Configuration.Sources.Single(s => s.Name == "Spotify"); source.Credential = "old-source";
        Plugin.Configuration.ServiceSetup = new() { Connections = [new() { Id = "connection", Name = "Fixture", Provider = "AI", Endpoint = "https://example.test/v1", ApiKey = "old-connection" }] };
        Plugin.Configuration.Services[0].ApiKey = "legacy";
        var first = Plugin.ReadAdminSettings(); var draft = Draft(first); draft.MinimumMatch = 75;
        var saved = Plugin.SaveAdminSettings(new(draft, first.Revision, [new("source", "Spotify", "replace", "replacement"), new("connection", "connection", "clear")]));
        Assert.Equal("replacement", Plugin.Configuration.Sources.Single(s => s.Name == "Spotify").Credential);
        Assert.Empty(Plugin.Configuration.ServiceSetup.Connections[0].ApiKey); Assert.Equal("legacy", Plugin.Configuration.Services[0].ApiKey);
        Assert.Equal(75, Plugin.Configuration.MinimumMatch); Assert.NotEqual(first.Revision, saved.Revision);
        Assert.Throws<WorkflowException>(() => Plugin.SaveAdminSettings(new(draft, first.Revision)));
        var keep = Plugin.SaveAdminSettings(new(Draft(saved), saved.Revision));
        Assert.Equal("replacement", Plugin.Configuration.Sources.Single(s => s.Name == "Spotify").Credential);
        Plugin.BeginDataMaintenance();
        Assert.Throws<WorkflowException>(() => Plugin.SaveAdminSettings(new(Draft(keep), keep.Revision)));
        Plugin.EndDataMaintenance();
    }
    [Fact]
    public void RejectedSavesDoNotModifyLiveCredentialsAndLegacyWritesInvalidateRevision()
    {
        var before = Plugin.ReadAdminSettings(); var draft = Draft(before);
        Assert.Throws<ArgumentException>(() => Plugin.SaveAdminSettings(new(draft, before.Revision, [new("path", "anything", "clear")])));
        draft.Sources[0].Credential = "implicit-secret";
        Assert.Throws<ArgumentException>(() => Plugin.SaveAdminSettings(new(draft, before.Revision)));
        draft = Draft(before); draft.MinimumMatch = 200;
        Assert.Throws<ArgumentException>(() => Plugin.SaveAdminSettings(new(draft, before.Revision, [new("source", "Spotify", "replace", "must-not-escape")])));
        Assert.DoesNotContain("must-not-escape", Plugin.Configuration.Sources.Select(s => s.Credential));
        Plugin.UpdateConfiguration(Draft(before));
        Assert.NotEqual(before.Revision, Plugin.ReadAdminSettings().Revision);
    }
    [Fact]
    public void RequestsArePaginatedByLifecycleAndIncludeOrphans()
    {
        var store = Own(new Store(Path.Combine(Root, "requests")));
        for (var i = 0; i < 4; i++) store.Put("job", "job" + i, new Job { Id = "job" + i, ItemId = Guid.NewGuid(), State = i < 2 ? "running" : "complete", Created = DateTime.UtcNow.AddMinutes(-i) });
        var api = new AdminSettingsApi(new(() => Plugin), store);
        var active = Assert.IsType<DataPage<Job>>(Assert.IsType<JsonResult>(api.Requests("active", 1, 1)).Value);
        Assert.Equal(2, active.Total); Assert.Single(active.Items); Assert.Equal("running", active.Items[0].State);
        var finished = Assert.IsType<DataPage<Job>>(Assert.IsType<JsonResult>(api.Requests("finished")).Value);
        Assert.Equal(2, finished.Total); Assert.All(finished.Items, job => Assert.Equal("complete", job.State));
        Assert.Throws<WorkflowException>(() => api.Requests("other"));
    }
}
