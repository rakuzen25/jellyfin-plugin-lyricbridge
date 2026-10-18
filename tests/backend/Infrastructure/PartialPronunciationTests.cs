using Xunit;
using LyricBridge;
using System.Net;

public sealed class PartialPronunciationTests : LanguageFixture
{
    [Fact]
    public async Task PartialPronunciationPreservesLineIdentity()
    {
        var root = Root;
        var handler = new Handler();
        var services = Own(new LanguageServices(() => Services, new HttpClient(handler)));
        var doc = new RichLyrics
        {
            Lines = [
            new() { Id="ja", Text="こんにちは", Language="ja" },
            new() { Id="en", Text="hello", Language="en" },
            new() { Id="he", Text="שלום", Language="he" }
        ]
        };
        var request = new GenerationRequest { Kind = "pronunciation", Service = "Google" };
        var result = await services.Generate(doc, request, new Progress<int>(), TestContext.Current.CancellationToken);
        Assert.True(result.Count == 1 && result["ja"] == "konnichiwa", "supported rows generated");
        Assert.True(request.SkippedRows["en"] == "latin_only" && request.SkippedRows["he"] == "unsupported_language", "skip reasons retained");
        Assert.True(doc.Lines.Count == 3 && doc.Lines[0].Text == "こんにちは", "stored originals unchanged");
        doc.Lines.RemoveAt(0);
        try
        {
            await services.Generate(doc, request, new Progress<int>(), TestContext.Current.CancellationToken);
            throw new Exception("empty eligibility accepted");
        }
        catch (ServiceFailure e) { Assert.True(e.Code == "unsupported_language", "actionable unsupported result"); }
        Assert.True(handler.Calls == 1, "no external request for unsupported rows");
    }
    private sealed class Handler : HttpMessageHandler
    {
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("[[[null,null,null,\"konnichiwa\"]]]") });
        }
    }
}
