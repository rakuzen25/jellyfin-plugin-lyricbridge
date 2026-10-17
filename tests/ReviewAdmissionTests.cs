using System.Reflection;
using System.Security.Claims;
using LyricBridge;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

public sealed class ReviewAdmissionTests : TestHost
{
    [Fact]
    public void PlanIdentityIsRequiredAndChangedInputCannotAdmitStalePlan()
    {
        var token = TestContext.Current.CancellationToken;
        using var store = new Store(Root);
        var item = new Audio { Id = Guid.NewGuid(), Name = "Fixture" }; var user = Guid.NewGuid();
        var library = DispatchProxy.Create<ILibraryManager, OriginalLibraryProxy>(); ((OriginalLibraryProxy)(object)library).Item = item;
        var setup = new ServiceSetup { Connections = [new() { Id = "review", Name = "Review", Endpoint = "https://fixture.invalid/v1" }], Options = [new() { Id = "review", Name = "Review", Capability = "boundary-review", ConnectionId = "review", Provider = "AI", Model = "fixture" }] };
        Plugin.Configuration.ServiceSetup = setup;
        var catalog = new ServiceCatalog(() => setup); using var provider = new TranscriptionProvider(); var strategy = new LinguisticBoundaries();
        var handler = new BoundaryReviewTask(() => new(), store, provider, strategy, catalog.Review);
        using var languages = new LanguageServices(() => []); using var generation = new Generation(() => new(true, true, 5, 3), store, languages, handlers: [handler]);
        var profile = new GenerationProfile("Transcription", "fixture", "model", "transcription", "", "en", "", 0, 0, 1);
        var source = TranscriptionResponse.Parse("{\"text\":\"Hi\",\"language\":\"en\",\"words\":[{\"word\":\"Hi\",\"start\":0,\"end\":1}]}", item.Id, user, "source", profile, false);
        store.Put("transcript", source.Id, source);
        var controller = new TranscriptionApi(store, strategy, null!, generation, new(library), null!, new(() => Plugin));
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new(new ClaimsIdentity([new Claim("Jellyfin-UserId", user.ToString()), new Claim(ClaimTypes.Role, Jellyfin.Api.Constants.UserRoles.Administrator)], "fixture")) } };
        var input = new BoundaryInput(source.Id, ["t0"], new(), OptionId: "review");
        _ = controller.Break(item.Id, source.Id, new(), token);
        Assert.Empty(store.BoundaryVersions(source.Id)); Assert.Empty(store.SavedEntries(source.Id));
        var planned = Assert.IsType<JsonResult>(controller.ReviewPlan(item.Id, source.Id, input));
        using var json = System.Text.Json.JsonDocument.Parse(Codec.Serialize(planned.Value));
        var identity = json.RootElement.GetProperty("identity").GetString(); Assert.Equal(1, json.RootElement.GetProperty("requestCount").GetInt32());
        Assert.Equal("review_plan_changed", Assert.Throws<WorkflowException>(() => controller.Review(item.Id, source.Id, input)).Code);
        Assert.Equal("review_plan_changed", Assert.Throws<WorkflowException>(() => controller.Review(item.Id, source.Id, input with { PlanIdentity = identity, Settings = new(Characters: 20) })).Code);
        Assert.Empty(store.JobHistory(user, 0, 10));
        var admitted = Assert.IsType<Job>(Assert.IsType<JsonResult>(controller.Review(item.Id, source.Id, input with { PlanIdentity = identity })).Value);
        Assert.NotNull(admitted.Review!.Snapshot); Assert.Equal(input.EndTokenIds, admitted.Review.Snapshot.EndTokenIds);
        Assert.Empty(store.BoundaryVersions(source.Id)); Assert.Empty(store.SavedEntries(source.Id));
        Assert.Equal(identity, admitted.ReviewPlan!.Identity); Assert.Equal(1, store.CountAdmissions(user, DateTime.UtcNow.AddHours(-24)));
        token.ThrowIfCancellationRequested();
    }
    [Fact]
    public async Task ModelLookupRequiresAdministratorBeforeContactingEndpoint()
    {
        using var provider = new TranscriptionProvider(new HttpClient(new TranscriptionTests.Handler(_ => throw new InvalidOperationException("Should not contact provider"))));
        var controller = new Api(null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, null!, new(() => Plugin), provider);
        controller.ControllerContext = new() { HttpContext = new DefaultHttpContext() };
        var result = Assert.IsType<JsonResult>(await controller.ModelLimits(new("https://fixture.invalid/v1", "fixture"), TestContext.Current.CancellationToken));
        Assert.Equal(403, result.StatusCode);
    }
}
