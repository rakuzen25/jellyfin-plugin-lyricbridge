using Lyricify.Lyrics.Helpers;
using Lyricify.Lyrics.Models;
using Lyricify.Lyrics.Searchers;
using Lyricify.Lyrics.Providers.Web;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using SearchSource=Lyricify.Lyrics.Searchers.Searchers;
namespace LyricBridge;

public interface ILyricSource
{
    string Name {get;}
    string[] SupportedLanguages => ["*"];
    bool SupportsWordTiming => Name!="LRCLIB";
    Task<List<Candidate>> Search(TrackMultiArtistMetadata track,CancellationToken token);
    Task<RawLyrics?> Fetch(Candidate candidate,CancellationToken token);
    Task<List<Candidate>> SearchQuery(TrackMultiArtistMetadata track,string query,CancellationToken token)=>Search(track,token);
    bool SupportsQueryExpansion=>false;
}
public sealed class ProviderRegistry : IDisposable
{
    private readonly ILyricSource[]? fixedSources;
    public static readonly AsyncLocal<CancellationToken> CurrentToken = new();
    public static readonly AsyncLocal<List<string>?> ResponseBodies = new();
    public readonly HttpClient Client;
    private readonly Func<SourceConfig[]> configuration;
    public ProviderRegistry(Func<SourceConfig[]>? configuration=null, HttpMessageHandler? handler=null)
    {
        this.configuration=configuration??(()=>SourceConfig.Defaults());
        Client=new HttpClient(new CancellationHandler(handler??new HttpClientHandler { AutomaticDecompression=DecompressionMethods.All,UseCookies=false})){Timeout=TimeSpan.FromSeconds(25)};

    }
    private ProviderRegistry(ILyricSource[] sources) : this(){fixedSources=sources;}
    public static ProviderRegistry WithSources(params ILyricSource[] sources)=>new(sources);
    public List<ILyricSource> Sources => fixedSources?.ToList()??configuration().Where(s=>s.Enabled && ((s.Name!="Spotify"&&s.Name!="AppleMusic")||!string.IsNullOrWhiteSpace(s.Credential))).Select(s=>(ILyricSource)new HelperSource(s,Client)).ToList();
    public void Dispose()=>Client.Dispose();
    private sealed class CancellationHandler(HttpMessageHandler inner) : DelegatingHandler(inner)
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)
        {
            using var linked=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken,CurrentToken.Value);
            var response=await base.SendAsync(request,linked.Token);
            if(response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests || (int)response.StatusCode>=500){
                var failure=new HttpRequestException("Lyric provider rejected the request.",null,response.StatusCode);
                if(response.Headers.RetryAfter is {} retry)failure.Data["retryAfter"]=retry.Date?.UtcDateTime??DateTime.UtcNow.Add(retry.Delta??TimeSpan.FromMinutes(1));
                response.Dispose();throw failure;
            }
            var path=request.RequestUri?.AbsolutePath??"";
            if(ResponseBodies.Value is { } bodies&&(path.Contains("lyric",StringComparison.OrdinalIgnoreCase)||path.Contains("download",StringComparison.OrdinalIgnoreCase)||path.Contains("seo_track",StringComparison.OrdinalIgnoreCase)||path.Contains("subtitle",StringComparison.OrdinalIgnoreCase)))bodies.Add(await response.Content.ReadAsStringAsync(linked.Token));
            return response;
        }
    }
}
public sealed class HelperSource : ILyricSource
{
    private readonly SourceConfig config;
    private readonly HttpClient client;
    private readonly Lyricify.Lyrics.Providers.Web.QQMusic.Api qq;
    private readonly Lyricify.Lyrics.Providers.Web.Netease.Api netease;
    private readonly Lyricify.Lyrics.Providers.Web.Kugou.Api kugou;
    private readonly Lyricify.Lyrics.Providers.Web.SodaMusic.Api soda;
    private readonly Lyricify.Lyrics.Providers.Web.Musixmatch.Api musixmatch;
    private readonly Lyricify.Lyrics.Providers.Web.Spotify.Api spotify;
    private readonly Lyricify.Lyrics.Providers.Web.AppleMusic.Api apple;
    private readonly Lyricify.Lyrics.Providers.Web.LRCLIB.Api lrclib;
    public HelperSource(SourceConfig config,HttpClient client)
    {
        this.config=new(){Name=config.Name,Enabled=config.Enabled,Credential=config.Credential};this.client=client;
        qq=new(){HttpClient=client};netease=new(){HttpClient=client};kugou=new(){HttpClient=client};soda=new(){HttpClient=client};
        musixmatch=new(){HttpClient=client};spotify=new(){HttpClient=client};apple=new(){HttpClient=client};lrclib=new(){HttpClient=client};
        if(config.Name=="Spotify")spotify.SetSpDc(config.Credential);
        if(config.Name=="AppleMusic")apple.SetMediaUserToken(config.Credential);
        if(config.Name=="Musixmatch"&&!string.IsNullOrWhiteSpace(config.Credential))musixmatch.SetUserToken(config.Credential);
    }
    private ISearcher Searcher()=>Name switch{
        "QQ"=>new QQMusicSearcher(qq),"NetEase"=>new NeteaseSearcher(netease),"Kugou"=>new KugouSearcher(kugou),
        "Soda"=>new SodaMusicSearcher(soda),"Musixmatch"=>new MusixmatchSearcher(musixmatch),"Spotify"=>new SpotifySearcher(spotify),
        "AppleMusic"=>new AppleMusicSearcher(apple),_=>new LRCLIBSearcher(lrclib)};

    public string Name=>config.Name;
    public bool SupportsQueryExpansion=>true;
    public Task<List<Candidate>> Search(TrackMultiArtistMetadata track,CancellationToken token)=>SearchQuery(track,MatchingSession.Queries(track).FirstOrDefault()??"",token);
    public async Task<List<Candidate>> SearchQuery(TrackMultiArtistMetadata track,string query,CancellationToken token)
    {
        ProviderRegistry.CurrentToken.Value=token;
        var results=await Searcher().SearchForResults(query);token.ThrowIfCancellationRequested();
        return (results??[]).Select(r=>new Candidate(Name,Id(r),r.Title,r.Artist,r.Album,r.DurationMs,0,(r as QQMusicSearchResult)?.Mid,Artists:r.Artists,AlbumArtists:r.AlbumArtists)).Where(c=>!string.IsNullOrEmpty(c.Id)).DistinctBy(c=>c.Id).ToList();
    }
    private static string Id(ISearchResult r)=>r switch{QQMusicSearchResult x=>x.Id,NeteaseSearchResult x=>x.Id,KugouSearchResult x=>x.Hash,SodaMusicSearchResult x=>x.Id,MusixmatchSearchResult x=>x.Id.ToString(),SpotifySearchResult x=>x.Id,AppleMusicSearchResult x=>x.Id,LRCLIBSearchResult x=>x.Id.ToString(),_=>""};
    public async Task<RawLyrics?> Fetch(Candidate c,CancellationToken token)
    {
        var previous=ProviderRegistry.ResponseBodies.Value;var recorded=new List<string>();ProviderRegistry.ResponseBodies.Value=recorded;
        try{var raw=await FetchInner(c,token);return raw!=null&&recorded.Count>0?raw with{RawResponse=Codec.Serialize(recorded)}:raw;}
        finally{ProviderRegistry.ResponseBodies.Value=previous;}
    }
    private static bool ContainsInstrumental(JsonElement element)
    {
        if(element.ValueKind==JsonValueKind.Object){foreach(var p in element.EnumerateObject()){if(p.Name=="instrumental"&&(p.Value.ValueKind==JsonValueKind.True||(p.Value.ValueKind==JsonValueKind.Number&&p.Value.TryGetInt32(out var n)&&n==1)))return true;if(ContainsInstrumental(p.Value))return true;}}
        if(element.ValueKind==JsonValueKind.Array)foreach(var v in element.EnumerateArray())if(ContainsInstrumental(v))return true;
        return false;
    }
    private async Task<RawLyrics?> FetchInner(Candidate c,CancellationToken token)
    {
        ProviderRegistry.CurrentToken.Value=token;
        switch(Name)
        {
            case "QQ":
                var qq=await this.qq.GetLyricsAsync(c.Id);
                if(string.IsNullOrWhiteSpace(qq?.Lyrics)){var lrc=await this.qq.GetLyric(c.SecondaryId??c.Id);return lrc==null?null:new(lrc.Lyric,lrc.Trans,RawResponse:Codec.Serialize(lrc));}
                return new(qq.Lyrics!,qq.Trans,qq.Roma,RawResponse:Codec.Serialize(qq));
            case "NetEase":
                var ne=await netease.GetLyricNew(c.Id);
                if(ne==null)return null;
                if(ne.Nolyric)return new("",RawResponse:Codec.Serialize(ne),Instrumental:true,InstrumentalReason:"Provider instrumental flag");
                var text=string.IsNullOrWhiteSpace(ne.Yrc?.Lyric)?ne.Lrc?.Lyric:ne.Yrc.Lyric;
                return string.IsNullOrWhiteSpace(text)?null:new(text,ne.Ytlrc?.Lyric??ne.Tlyric?.Lyric,ne.Yromalrc?.Lyric??ne.Romalrc?.Lyric,Codec.Serialize(ne));
            case "Kugou":
                var search=await kugou.GetSearchLyrics(duration:c.DurationMs,hash:c.Id);
                var first=search?.Candidates?.FirstOrDefault();if(first==null)return null;
                var json=await client.GetStringAsync($"https://lyrics.kugou.com/download?ver=1&client=pc&id={Uri.EscapeDataString(first.Id)}&accesskey={Uri.EscapeDataString(first.AccessKey)}&fmt=krc&charset=utf8",token);
                using(var doc=JsonDocument.Parse(json)){var content=doc.RootElement.GetProperty("content").GetString();var krc=Lyricify.Lyrics.Decrypter.Krc.Decrypter.DecryptLyrics(content!);return krc==null?null:new(krc,RawResponse:json);}
            case "Soda":
                var soda=await this.soda.GetDetail(c.Id);
                if((soda?.Track?.Vocal??soda?.SeoTrack?.Track?.Vocal)==2)return new("",RawResponse:Codec.Serialize(soda),Instrumental:true,InstrumentalReason:"Provider non-vocal classification");
                return string.IsNullOrWhiteSpace(soda?.Lyric?.Content)?null:new(soda.Lyric.Content,soda.Lyric.Translations?.ChineseTranslation,RawResponse:Codec.Serialize(soda),Language:soda.Lyric.Lang,AdditionalTranslations:soda.Lyric.LangTranslations?.ToDictionary(p=>p.Key,p=>p.Value.Content));
            case "Musixmatch":
                var mm=await musixmatch.GetFullLyricsRaw(c.Id,null,token);
                if(string.IsNullOrWhiteSpace(mm))return null;
                using(var macro=JsonDocument.Parse(mm)){if(ContainsInstrumental(macro.RootElement))return new("",RawResponse:mm,Instrumental:true,InstrumentalReason:"Provider instrumental flag");}
                return new(mm,RawResponse:mm);
            case "Spotify":
                var sp=await spotify.GetLyrics(c.Id);return string.IsNullOrWhiteSpace(sp)?null:new(sp,RawResponse:sp);
            case "AppleMusic":
                var apple=await this.apple.GetLyrics(c.Id);return string.IsNullOrWhiteSpace(apple?.Ttml)?null:new(apple.Ttml,RawResponse:Codec.Serialize(apple));
            default:
                var lr=await lrclib.GetById(int.Parse(c.Id));if(lr==null)return null;if(lr.Instrumental)return new("",RawResponse:Codec.Serialize(lr),Instrumental:true,InstrumentalReason:"Provider instrumental flag");return new(string.IsNullOrWhiteSpace(lr.SyncedLyrics)?lr.PlainLyrics??"":lr.SyncedLyrics,RawResponse:Codec.Serialize(lr));
        }
    }
}
