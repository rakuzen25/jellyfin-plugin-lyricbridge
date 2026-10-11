using LyricBridge;
using System.Net;

public static class PartialPronunciationTests
{
    public static async Task Run()
    {
        var handler = new Handler();
        var services = new LanguageServices(() => Plugin.Instance.Configuration.Services, new HttpClient(handler));
        var doc = new RichLyrics
        {
            Lines = [
            new() { Id="ja", Text="こんにちは", Language="ja" },
            new() { Id="en", Text="hello", Language="en" },
            new() { Id="he", Text="שלום", Language="he" }
        ]
        };
        var request = new GenerationRequest { Kind = "pronunciation", Service = "Google" };
        var result = await services.Generate(doc, request, new Progress<int>(), CancellationToken.None);
        Check(result.Count == 1 && result["ja"] == "konnichiwa", "supported rows generated");
        Check(request.SkippedRows["en"] == "latin_only" && request.SkippedRows["he"] == "unsupported_language", "skip reasons retained");
        Check(doc.Lines.Count == 3 && doc.Lines[0].Text == "こんにちは", "stored originals unchanged");
        doc.Lines.RemoveAt(0);
        try { await services.Generate(doc, request, new Progress<int>(), CancellationToken.None); throw new Exception("empty eligibility accepted"); }
        catch (ServiceFailure e) { Check(e.Code == "unsupported_language", "actionable unsupported result"); }
        Check(handler.Calls == 1, "no external request for unsupported rows");
        Console.WriteLine("PASS: mixed-language partial pronunciation, skip reasons, unchanged originals, no eligible rows make no request.");
    }
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
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
