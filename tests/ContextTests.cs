using Xunit;
using LyricBridge;
using System.Net;
using System.Text.Json;
public sealed class ContextTests : TestHost
{
    [Fact]
    public async Task ProviderContextPreservesTargetLineMapping()
    {
        var root = Root;
        var doc = new RichLyrics { Hash = "context-fixture", Lines = [new() { Id = "a", Text = "Before", Language = "en" }, new() { Id = "b", Text = "Target", Language = "en" }, new() { Id = "c", Text = "After", Language = "en" }] };
        var window = TranslationContext.Window(doc.Lines, 1, 1, 1);
        Assert.True(window.Before == "Before" && window.After == "After", "context window includes both neighbors");
        Assert.True(TranslationContext.Window(doc.Lines, 0, 10, 10).Before == "", "start boundary");
        Assert.True(TranslationContext.Window(doc.Lines, 2, 10, 10).After == "", "end boundary");
        Assert.True(TranslationContext.Extract("before 🔤 translation 🔤 after", true) == "translation", "target extraction");
        foreach (var bad in new[] { "no marker", "🔤 target", "🔤 target 🔤 extra 🔤", "🔤 🔤" })
        {
            try
            {
                TranslationContext.Extract(bad, true);
                throw new Exception("accepted malformed mapping");
            }
            catch (InvalidDataException) { }
        }
        var handler = new ContextHandler();
        var services = Own(new LanguageServices(() => Plugin.Configuration.Services, new HttpClient(handler)));
        var config = Plugin.Configuration.Services.First(s => s.Name == "DeepL");
        var oldKey = config.ApiKey;
        config.ApiKey = "synthetic";
        try
        {
            var request = new GenerationRequest { Service = "DeepL", ContextBefore = 1, ContextAfter = 1 };
            var plain = services.Key(doc, new()
            {
                Service = "DeepL",
                ContextBefore = 0,
                ContextAfter = 0
            });
            Assert.True(plain != services.Key(doc, request), "context changes cache identity");
            var result = await services.Generate(doc, request, new Progress<int>(), TestContext.Current.CancellationToken);
            Assert.True(result["b"] == "translated Target", "DeepL maps target only");
            Assert.True(handler.Contexts[1] == "Before\nAfter", "DeepL separate context field");
        }
        finally { config.ApiKey = oldKey; }
        handler.Contexts.Clear();
        var google = await services.Generate(doc, new()
        {
            Service = "Google",
            ContextBefore = 1,
            ContextAfter = 1
        }, new Progress<int>(), TestContext.Current.CancellationToken);
        Assert.True(google["b"] == "translated Target", "Google extracts target only");
        var libreConfig = Plugin.Configuration.Services.First(s => s.Name == "LibreTranslate");
        var oldEndpoint = libreConfig.Endpoint;
        libreConfig.Endpoint = "http://synthetic";
        try
        {
            var libre = await services.Generate(doc, new()
            {
                Service = "LibreTranslate",
                ContextBefore = 1,
                ContextAfter = 1
            }, new Progress<int>(), TestContext.Current.CancellationToken);
            Assert.True(libre["b"] == "translated Target", "LibreTranslate extracts target only");
        }
        finally { libreConfig.Endpoint = oldEndpoint; }
        handler.Malformed = true;
        try
        {
            await services.Generate(doc, new()
            {
                Service = "Google",
                ContextBefore = 1
            }, new Progress<int>(), TestContext.Current.CancellationToken);
            throw new Exception("lost marker accepted");
        }
        catch (InvalidDataException) { }
    }
    sealed class ContextHandler : HttpMessageHandler
    {
        public List<string> Contexts = []; public bool Malformed;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            string output;
            if (request.Method == HttpMethod.Post)
            {
                using var data = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(token));
                if (data.RootElement.TryGetProperty("q", out var query))
                {
                    output = Codec.Serialize(new
                    {
                        translatedText = "outside 🔤 translated " + TranslationContext.Extract(query.GetString()!, true) + " 🔤 outside"
                    });
                    return new(HttpStatusCode.OK)
                    {
                        Content = new StringContent(output)
                    };
                }
                Contexts.Add(data.RootElement.TryGetProperty("context", out var context) ? context.GetString()! : "");
                output = Codec.Serialize(new
                {
                    translations = new[] { new { text = "translated " + data.RootElement.GetProperty("text")[0].GetString() } }
                });
            }
            else
            {
                var q = request.RequestUri!.Query.Split('&').First(s => s.StartsWith("q=")).Substring(2);
                var text = Uri.UnescapeDataString(q);
                var target = TranslationContext.Extract(text, true);
                output = Codec.Serialize(new[] { new[] { Malformed ? "lost markers" : "outside 🔤 translated " + target + " 🔤 outside", "en" } });
            }
            return new(HttpStatusCode.OK)
            {
                Content = new StringContent(output)
            };
        }
    }
}
