using System.Net;
using LyricBridge;
using Xunit;

public sealed class ProviderIsolationTests
{
    [Fact]
    public async Task ProviderClientsAndCredentialCachesAreInstanceOwned()
    {
        var firstSpotify = new Lyricify.Lyrics.Providers.Web.Spotify.Api();
        var secondSpotify = new Lyricify.Lyrics.Providers.Web.Spotify.Api();
        firstSpotify.SetSpDc("synthetic-first"); secondSpotify.SetSpDc("synthetic-second");
        firstSpotify.SetAccessToken("first-token", long.MaxValue); secondSpotify.SetAccessToken("second-token", long.MaxValue);
        Assert.Equal("synthetic-first", firstSpotify.GetSpDc()); Assert.Equal("first-token", firstSpotify.GetAccessToken());
        var firstApple = new Lyricify.Lyrics.Providers.Web.AppleMusic.Api();
        var secondApple = new Lyricify.Lyrics.Providers.Web.AppleMusic.Api();
        firstApple.SetAccessToken("first-apple"); secondApple.SetAccessToken("second-apple");
        Assert.Equal("first-apple", firstApple.GetAccessToken());
        using var firstClient = new HttpClient(new Fixture("first")); using var secondClient = new HttpClient(new Fixture("second"));
        var first = new HelperSource(new() { Name = "LRCLIB" }, firstClient); var second = new HelperSource(new() { Name = "LRCLIB" }, secondClient);
        var candidate = new Candidate("LRCLIB", "1", "title", "artist", "", 1000, 100);
        var responses = await Task.WhenAll(first.Fetch(candidate, CancellationToken.None), second.Fetch(candidate, CancellationToken.None));
        Assert.Equal("first", responses[0]!.Original); Assert.Equal("second", responses[1]!.Original);
    }
    private sealed class Fixture(string text) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            await Task.Yield(); token.ThrowIfCancellationRequested();
            return new(HttpStatusCode.OK) { Content = new StringContent(Codec.Serialize(new { id = 1, plainLyrics = text })) };
        }
    }
}
