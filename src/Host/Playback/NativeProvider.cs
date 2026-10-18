using System.Text;
using Lyricify.Lyrics.Models;
using MediaBrowser.Controller.Lyrics;
using MediaBrowser.Model.Lyrics;
using MediaBrowser.Model.Providers;
namespace LyricBridge;

public sealed class NativeProvider(Retrieval retrieval, Store store, Lazy<Plugin> plugin) : ILyricProvider
{
    public string Name => "LyricBridge";
    public async Task<IEnumerable<RemoteLyricInfo>> SearchAsync(LyricSearchRequest request, CancellationToken token)
    {
        if (request.IsAutomated && !plugin.Value.Configuration.ScheduledRetrieval) return [];
        var track = new TrackMultiArtistMetadata { Title = request.SongName, Artists = request.ArtistNames?.ToList() ?? [], Album = request.AlbumName, AlbumArtists = request.AlbumArtistsNames?.ToList() ?? [], DurationMs = request.Duration is long d ? (int)(d / 10000) : null };
        var candidates = await retrieval.Candidates(track, token, !request.IsAutomated);
        var results = new List<RemoteLyricInfo>();
        foreach (var c in candidates.Where(c => c.Assessment?.Eligible == true && c.Verification == "verified"))
        {
            var key = store.CacheCandidate(c);
            var document = await retrieval.Fetch(c, token); if (document == null) continue;
            results.Add(new RemoteLyricInfo { Id = key, ProviderName = Name, Metadata = new LyricMetadata { Title = c.Title, Artist = c.Artist, Album = c.Album, Length = c.DurationMs.GetValueOrDefault() * 10000L, IsSynced = document.Lines.Any(l => l.Start != null) }, Lyrics = Response(document) });
        }
        return results;
    }
    public async Task<LyricResponse?> GetLyricsAsync(string id, CancellationToken token)
    {
        var candidate = store.GetCandidate(id); if (candidate == null) return null;
        // This operation returns a stream. LyricBridge never saves beside MediaPath.
        var document = await retrieval.Fetch(candidate, token); return document == null ? null : Response(document);
    }
    private static LyricResponse Response(RichLyrics document) => new() { Format = document.Lines.Any(l => l.Start != null) ? "lrc" : "txt", Stream = new MemoryStream(Encoding.UTF8.GetBytes(Normalization.Export(document))) };
}
