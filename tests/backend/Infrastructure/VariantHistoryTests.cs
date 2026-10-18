using Xunit;
using LyricBridge;
using System.Net;
using System.Text.Json;
public sealed class VariantHistoryTests : LanguageFixture
{
    [Fact]
    public async Task GeneratedVersionsRetainHistoryAndSelection()
    {
        var root = Root;
        var c = Services.First(s => s.Name == "AI");
        var old = (c.Endpoint, c.Model, c.ReasoningEffort, c.TimeoutSeconds);
        var requests = AllowUserRequests;
        var store = Own(new Store(Path.Combine(root, "version-history")));
        var services = Own(new LanguageServices(() => Services, new HttpClient(new Handler())));
        var worker = Own(new Generation(Policy, store, services));
        var legacy = new Variant("legacy", "base", "translation", "zh", "QQ", "Supplied · 12", new());
        var donor = new RichLyrics { Hash = "donor", Source = "NetEase", ProviderId = "34" };
        store.Put("document", donor.Hash, donor);
        store.Put("mixed-origin", legacy.Key, new MixedOrigin(donor.Hash));
        try
        {
            c.Endpoint = "http://fixture/v1";
            c.Model = "fixture";
            c.ReasoningEffort = "";
            c.TimeoutSeconds = 5;
            var doc = new RichLyrics { Hash = "versions", Lines = [new() { Id = "l0", Text = "Good morning", Language = "en" }] };
            store.Put("document", doc.Hash, doc);
            var user = Guid.NewGuid();
            var item = Guid.NewGuid();
            var first = worker.Request(user, item, doc, new() { Service = "AI" }, true);
            await worker.StartAsync(TestContext.Current.CancellationToken);
            await Completed(first);
            var firstVersion = store.Get<Variant>("variant", first.VariantKey)!;
            Assert.True(firstVersion.Text["l0"] == "版本1", "first generation saved");
            var second = worker.Request(user, item, doc, new()
            {
                Service = "AI",
                ForceNew = true
            }, true);
            var duplicate = worker.Request(user, item, doc, new()
            {
                Service = "AI",
                ForceNew = true
            }, true);
            Assert.True(duplicate.Id == second.Id, "force-new in-flight deduplication");
            await Completed(second);
            Assert.True(first.VariantKey != second.VariantKey && store.Variants(doc.Hash).Count == 2, "immutable versions retained");
            Assert.True(store.Get<Variant>("variant", first.VariantKey)!.Text["l0"] == "版本1", "old text unchanged");
            Assert.True(worker.Cached(doc, new() { Service = "AI" })!.Text["l0"] == "版本2", "latest compatible version is reusable cache");
            var free = worker.Request(Guid.NewGuid(), item, doc, new() { Service = "AI" }, false);
            Assert.True(free.State == "cached", "cached versions need no external request");
            AllowUserRequests = false;
            try
            {
                worker.Request(Guid.NewGuid(), item, doc, new()
                {
                    Service = "AI",
                    ForceNew = true
                }, false);
                throw new Exception("force-new bypassed permission");
            }
            catch (UnauthorizedAccessException) { }
            store.Put("auxiliary-choice", "user-a", new AuxiliarySelection(second.VariantKey));
            store.Put("auxiliary-choice", "user-b", new AuxiliarySelection(second.VariantKey));
            store.Put("auxiliary-choice", "other", new AuxiliarySelection(first.VariantKey));
            Assert.True(!store.DeleteVariant(second.VariantKey, "wrong-hash", "translation"), "deletion rejects a different lyric document");
            Assert.True(!store.DeleteVariant(second.VariantKey, doc.Hash, "pronunciation"), "deletion rejects a different language kind");
            Assert.True(store.DeleteVariant(second.VariantKey, doc.Hash, "translation"), "saved version deleted");
            Assert.True(store.Get<AuxiliarySelection>("auxiliary-choice", "user-a") == null && store.Get<AuxiliarySelection>("auxiliary-choice", "user-b") == null, "deleted selections fall back for all users");
            Assert.True(store.Get<AuxiliarySelection>("auxiliary-choice", "other")?.Key == first.VariantKey, "other selections retained");
            Assert.True(worker.Cached(doc, new() { Service = "AI" })?.Key == first.VariantKey, "cache falls back to retained version");
            store.Put("variant", "local", new Variant("local", doc.Hash, "pronunciation", "ja", "Kawazu", "", new()));
            Assert.True(!store.DeleteVariant("local", doc.Hash, "pronunciation"), "automatic local pronunciation protected");
            Assert.True(!store.DeleteVariant(second.VariantKey, doc.Hash, "translation"), "already deleted version unavailable");
            async Task Completed(Job job)
            {
                for (int n = 0; n < 60 && store.Get<Job>("job", job.Id)?.State is "queued" or "running"; n++)
                    await Task.Delay(100, TestContext.Current.CancellationToken);
                Assert.True(store.Get<Job>("job", job.Id)?.State == "complete", "generation completed");
            }
        }
        finally { await worker.StopAsync(TestContext.Current.CancellationToken); (c.Endpoint, c.Model, c.ReasoningEffort, c.TimeoutSeconds) = old; AllowUserRequests = requests; }
    }
    sealed class Handler : HttpMessageHandler
    {
        int count; protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage message, CancellationToken token) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Codec.Serialize(new { choices = new[] { new { message = new { content = Codec.Serialize(new { lines = new[] { new { id = "l0", text = "版本" + (++count) } } }) } } } })) });
    }
}
