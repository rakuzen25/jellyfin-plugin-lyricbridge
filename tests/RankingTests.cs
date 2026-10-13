using LyricBridge;
using Lyricify.Lyrics.Models;
using Microsoft.Extensions.Logging.Abstractions;
using System.Diagnostics;
using Lyricify.Lyrics.Helpers.General;
public static class RankingTests
{
    static void Check(bool ok, string name) { if (!ok) throw new Exception("Ranking: " + name); }
    static TrackMultiArtistMetadata Query(string title = "Morning light", string album = "Album", int? duration = 200000, string[]? artists = null) => new() { Title = title, Album = album, Artists = artists?.ToList() ?? ["Singer"], DurationMs = duration };
    static Candidate C(string id = "1", string title = "Morning light", string artist = "Singer", string album = "Album", int? duration = 200000) => new("QQ", id, title, artist, album, duration, 0);
    static RichLyrics Timed(int words, int count = 10) => new() { Source = "QQ", ProviderId = "fixture", Lines = Enumerable.Range(0, count).Select(i => new LyricLine { Id = "l" + i, Text = "hello world", Start = i * 100L, End = i * 100L + 100, Cues = i < words ? [new(0, 5, i * 100L, i * 100L + 40), new(6, 11, i * 100L + 50, i * 100L + 100)] : [] }).ToList() };
    public static async Task Run(string root)
    {
        if (Plugin.Instance == null) { var applicationPaths = System.Reflection.DispatchProxy.Create<MediaBrowser.Common.Configuration.IApplicationPaths, Proxy>(); ((Proxy)(object)applicationPaths).Root = root; var serializer = System.Reflection.DispatchProxy.Create<MediaBrowser.Model.Serialization.IXmlSerializer, Proxy>(); new Plugin(applicationPaths, serializer).UpdateConfiguration(new Configuration()); }
        foreach (var label in new[] { "Live", "Acoustic", "Instrumental", "Karaoke", "Sped Up", "Slowed", "Radio Edit", "Studio" })
        {
            var m = new MatchingSession(Query()); var c = m.Assess(C(title: "Morning light (" + label + ")")); Check(c.Assessment!.Eligible == (label == "Studio"), "edition " + label);
        }
        foreach (var title in new[] { "Live Forever", "Acoustic Dreams", "Remix My Heart", "Edit This Life", "Instrumental Love", "Slowed Thoughts" }) Check(new MatchingSession(Query(title)).Assess(C(title: title)).Assessment!.Eligible, "literal title " + title);
        Check(new MatchingSession(Query()).Assess(C(title: "Morning light (2020 Remaster)")).Assessment!.Eligible, "neutral remaster");
        Check(!new MatchingSession(Query()).Assess(C(title: "Morning light （Live）")).Assessment!.Eligible, "full-width qualifier");
        Check(!new MatchingSession(Query()).Assess(C(title: "Morning light — Live")).Assessment!.Eligible, "dash qualifier");
        Check(!new MatchingSession(Query()).Assess(C(title: "Morning light (Live 2020 Remaster)")).Assessment!.Eligible, "neutral remaster does not erase live evidence");
        Check(new MatchingSession(Query("Morning light (feat. Guest)")).Assess(C(title: "Morning light")).Assessment!.Eligible, "featured clause");
        foreach (var featured in new[] { "(feat. Ayase & yuigot)", "(featuring Ayase)", "（ft. Ayase）" })
        {
            var remix = new MatchingSession(Query("睡魔 (yuigot REMIX)")); var same = remix.Assess(C(title: "睡魔 " + featured + " (yuigot Remix)"));
            Check(same.Assessment!.Eligible && !same.Assessment.Reasons.Contains("Title differs"), "featured clause before named remix " + featured);
            Check(!new MatchingSession(Query("睡魔 (yuigot REMIX)")).Assess(C(title: "睡魔 " + featured + " (Ayase Remix)")).Assessment!.Eligible, "featured stripping preserves named remix gate");
        }
        Check(new MatchingSession(Query("睡魔 (yuigot REMIX)")).Assess(C(title: "睡魔 - feat. Ayase (yuigot REMIX)")).Assessment!.Eligible, "featured suffix preserves remix");
        Check(new MatchingSession(Query("Featuring You")).Assess(C(title: "Featuring You")).Assessment!.Eligible, "literal featuring title retained");
        Check(!new MatchingSession(Query(album: "Live at Tokyo")).Assess(C()).Assessment!.Eligible, "album edition");
        Check(!new MatchingSession(Query("Morning light (Alice Remix)")).Assess(C(title: "Morning light (Bob Remix)")).Assessment!.Eligible, "different named remix");
        Check(new MatchingSession(Query("Morning light (Alice Remix)")).Assess(C(title: "Morning light [ALICE remix]")).Assessment!.Eligible, "same remix");
        var matching = new MatchingSession(Query()); Check(matching.Assess(C()).Score == 100, "same field buckets");
        Check(!matching.Assess(C("wrong-title", "Entirely different song")).Assessment!.Eligible, "title gate");
        Check(!matching.Assess(C("wrong-artist", artist: "Stranger")).Assessment!.Eligible, "artist gate");
        Check(matching.Assess(C("missing-artist", artist: "")).Assessment!.Fields.Single(x => x.Field == "artists").Result == "Unavailable", "missing artist uncertain");
        Check(!new MatchingSession(Query(artists: ["A", "B", "C", "D", "E", "F"])).Assess(C(artist: "群星")).Assessment!.Eligible, "helper various-artists exception does not bypass overlap");
        Check(new MatchingSession(Query(artists: ["Singer", "Guest", "Another"])).Assess(C()).Assessment!.Eligible, "actual overlap is sufficient even if the helper bucket is NoMatch");
        Check(matching.Assess(C("duration-boundary", duration: 210000)).Assessment!.Reasons.All(x => !x.StartsWith("Duration differs")), "duration inclusive boundary");
        Check(matching.Assess(C("duration-over", duration: 210001)).Assessment!.Reasons.Any(x => x.StartsWith("Duration differs")), "duration excluded above boundary");
        Check(new MatchingSession(Query(duration: 400000)).Assess(C(duration: 420000)).Assessment!.Reasons.All(x => !x.StartsWith("Duration differs")), "five percent duration boundary");
        Check(new MatchingSession(Query(duration: null)).Assess(C(duration: 999999)).Assessment!.Eligible, "missing duration not excluded");
        Check(!new MatchingSession(Query(), 100).Assess(C(album: "Another album", duration: 205000)).Assessment!.Eligible, "configured minimum enforced");
        var durationSession = new MatchingSession(Query());
        var exact = durationSession.Assess(C("exact", duration: 200000));
        foreach (var delta in new[] { 1, 1000, 2000 }) { var near = durationSession.Assess(C("near" + delta, duration: 200000 - delta)); Check(near.Score == exact.Score && near.Assessment!.Fields.Single(f => f.Field == "duration").Result == "Perfect", "two-second duration equivalence " + delta); }
        Check(durationSession.Assess(C("outside", duration: 202001)).Assessment!.Fields.Single(f => f.Field == "duration").Result != "Perfect", "duration tolerance inclusive boundary");
        var supplied = Timed(10); foreach (var line in supplied.Lines) { line.Translations["zh"] = "translation"; line.Pronunciation = "pronunciation"; }
        supplied.Lines[0].Translations["en"] = "extra language";
        var analysis = LyricRanking.Analyze(supplied); Check(analysis.Auxiliary.Completeness == 200, "multiple translations do not inflate completeness");
        var both = exact with { Verification = "verified", Assessment = LyricRanking.WithDocument(exact.Assessment!, supplied) with { ProviderOrder = 7 } };
        var onlyTranslation = Timed(10); foreach (var line in onlyTranslation.Lines) line.Translations["zh"] = "translation";
        var one = exact with { Id = "one", Assessment = LyricRanking.WithDocument(exact.Assessment!, onlyTranslation) with { ProviderOrder = 0 } };
        Check(LyricRanking.Compare(both, one) < 0, "supplied completeness breaks metadata/timing ties before provider order");
        var partial = Timed(10); partial.Lines[0].Pronunciation = "reading"; partial.Lines[0].Translations["zh"] = "text";
        Check(LyricRanking.Analyze(partial).Auxiliary.Completeness == 20, "auxiliary ranking uses coverage rather than flags");
        partial.Lines[1].Pronunciation = " "; partial.Lines[1].Translations["zh"] = " "; partial.Lines[0].Background = new() { Text = "backing", Pronunciation = "reading", Translations = new() { ["zh"] = "text" } };
        Check(LyricRanking.Analyze(partial).Auxiliary.Completeness == 20, "blank and background rows do not inflate completeness");
        Check(LyricRanking.Compare(one with { Assessment = one.Assessment! with { Score = 100 } }, both with { Assessment = both.Assessment! with { Score = 99 } }) < 0, "metadata score precedes auxiliary completeness");
        Check(LyricRanking.Improvement(both, one) == "auxiliary-completeness", "auxiliary ranking creates improvement offers");
        var doc = Timed(8); var original = Codec.Serialize(doc); Check(LyricRanking.Timing(doc).Rank == 3, "80 percent mostly"); Check(LyricRanking.Timing(Timed(7)).Rank == 2, "70 percent partially"); Check(LyricRanking.Timing(Timed(0)).Rank == 1, "line timing");
        doc.Lines[0].Background = new() { Text = "background", Cues = [new(0, 2, 0, 10), new(2, 10, 10, 20)] }; doc.Lines[1].Pronunciation = "aux"; doc.Lines[1].Translations["zh"] = "aux"; Check(LyricRanking.Timing(doc).Coverage == 80, "auxiliary/background excluded");
        var full = Timed(0); full.Lines.ForEach(l => l.Cues = [new(0, l.Text.Length, l.Start!.Value, l.End)]); Check(LyricRanking.Timing(full).Rank == 1, "whole-line cues are not words");
        var unicode = new RichLyrics { Lines = [new() { Text = "😀ab", Start = 0, End = 100, Cues = [new(0, 1, 0, 40), new(1, 4, 50, 100)] }] }; Check(LyricRanking.Timing(unicode).WordLines == 0 && LyricRanking.Timing(unicode).InvalidCues == 2, "surrogate boundaries");
        unicode.Lines[0].Text = "e\u0301ab"; Check(LyricRanking.Timing(unicode).InvalidCues == 2, "combining-character boundaries");
        var malformed = Timed(10); malformed.Lines[0].Cues[1] = new(6, 11, 10, 5); Check(LyricRanking.Timing(malformed).InvalidCues == 1, "invalid time order");
        var a = matching.Assess(C("a")) with { Assessment = matching.Assess(C("a")).Assessment! with { Timing = LyricRanking.Timing(Timed(0)) } };
        var b = matching.Assess(C("b")) with { Assessment = matching.Assess(C("b")).Assessment! with { Timing = LyricRanking.Timing(Timed(8)) } };
        Check(LyricRanking.Compare(b, a) < 0 && LyricRanking.Improvement(b with { Verification = "verified" }, a) == "timing", "higher timing upgrade");
        Check(LyricRanking.Improvement(b with { Verification = "verified", Assessment = b.Assessment! with { Score = b.Assessment.Score + 1 } }, b) == "match-score", "score difference creates offer");
        var low = a with { Assessment = a.Assessment! with { Score = 70, Tier = 1 } }; Check(LyricRanking.Compare(a, low) < 0 && LyricRanking.Improvement(a with { Verification = "verified" }, low) == "recording-match", "tier precedes timing");
        var duplicate = new MatchingSession(Query()); await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => Task.Run(() => duplicate.Assess(C())))); Check(duplicate.Metrics.Assessments == 1, "assessment deduplicated concurrently");
        var store = new Store(Path.Combine(root, "ranking")); var source = new RankSource(); var retrieval = new Retrieval(store, ProviderRegistry.WithSources(source), NullLogger<Retrieval>.Instance); var session = new MatchingSession(Query()); var candidate = session.Assess(C()); await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => session.Verify(retrieval, source, candidate, CancellationToken.None, _ => { }))); Check(session.Metrics.Verifications == 1 && session.Metrics.ParsePasses == 1 && source.Fetches == 1, "verification and parse shared");
        var fallback = new RankSource { MissingFirst = true }; var engine = new Retrieval(store, ProviderRegistry.WithSources(fallback), NullLogger<Retrieval>.Instance); var f = new MatchingSession(Query()); var results = new List<Verification>(); await f.RunProvider(engine, fallback, 0, false, CancellationToken.None, _ => { }, null, results.Add); Check(results.Any(v => v.Lyrics != null) && f.Metrics.Verifications == 3 && fallback.Fetches == 3, "bounded three-candidate fallback");
        var expansion = new RankSource { Expand = true }; var x = new MatchingSession(Query()); await x.RunProvider(engine, expansion, 0, false, CancellationToken.None, _ => { }, null, _ => { }); Check(expansion.Queries.Distinct().Count() == expansion.Queries.Count && expansion.Queries.Count <= 3 && x.Metrics.Assessments == 1 && expansion.Queries.Count == 3 && x.Metrics.Verifications == 1, "expansion query and ID deduplication");
        var calls = source.Searches; var item = Guid.NewGuid(); store.Save(item, Timed(8)); using var discovery = new Discovery(store, ProviderRegistry.WithSources(source), retrieval); Check(discovery.Start(item, Query()).Complete && source.Searches == calls, "cached no discovery");
        foreach (var code in new[] { System.Net.HttpStatusCode.Unauthorized, System.Net.HttpStatusCode.TooManyRequests }) { var failedSource = new RankSource { Failure = code }; var failed = new Retrieval(store, ProviderRegistry.WithSources(failedSource), NullLogger<Retrieval>.Instance); var failures = new List<SafeError>(); var m = new MatchingSession(Query()); await m.RunProvider(failed, failedSource, 0, false, CancellationToken.None, failures.Add, null, _ => { }); Check(failedSource.Searches == 1 && failures.Single().Code == (code == System.Net.HttpStatusCode.Unauthorized ? "provider_authentication" : "provider_rate_limited"), "provider-wide failure stops expansion " + code); }
        var challengedSource = new RankSource { Captcha = true }; var challenged = new Retrieval(store, ProviderRegistry.WithSources(challengedSource), NullLogger<Retrieval>.Instance); var challenges = new List<SafeError>();
        await new MatchingSession(Query()).RunProvider(challenged, challengedSource, 0, false, CancellationToken.None, challenges.Add, null, _ => { });
        Check(challengedSource.Searches == 1 && challenges.Single().Code == "provider_verification_required" && challenges[0].RetryAt > DateTime.UtcNow.AddMinutes(4), "CAPTCHA has explicit safe error and five-minute backoff without expansion");
        await new MatchingSession(Query()).RunProvider(challenged, challengedSource, 0, false, CancellationToken.None, challenges.Add, null, _ => { });
        Check(challengedSource.Searches == 1 && challenges.Last().Code == "provider_backoff", "CAPTCHA backoff suppresses repeated requests");
        var tracker = new PipelineCounter(); var concurrent = new Retrieval(store, ProviderRegistry.WithSources(Enumerable.Range(0, 8).Select(i => (ILyricSource)new PipelineSource("p" + i, tracker)).ToArray()), NullLogger<Retrieval>.Instance); var concurrentCandidates = await concurrent.Candidates(Query(), CancellationToken.None, false); Check(tracker.Maximum == 3 && concurrentCandidates.Count == 8, "eight providers have at most three active pipelines");
        var searchStore = new Store(Path.Combine(root, "ranking-paths")); var sharedSource = new RankSource(); var registry = ProviderRegistry.WithSources(sharedSource); var shared = new Retrieval(searchStore, registry, NullLogger<Retrieval>.Instance); using var paths = new Discovery(searchStore, registry, shared);
        var search = paths.Search(Guid.NewGuid(), Guid.NewGuid(), Query(), null); SearchSession snapshot = search; for (int i = 0; i < 80; i++) { snapshot = paths.SearchStatus(search.Id, search.UserId)!; if (snapshot.State != "searching") break; await Task.Delay(50); }
        Check(snapshot.State == "complete" && snapshot.Metrics?.ParsePasses == 1 && snapshot.Metrics.Assessments == 4, "manual parses identical document once and assesses IDs once");
        var ranked = snapshot.Candidates.OrderBy(c => c, Comparer<Candidate>.Create(LyricRanking.Compare)).First(); Check(snapshot.Recommended == LyricRanking.Key(ranked), "recommended uses shared order"); var fetches = sharedSource.Fetches; var selected = await shared.Select(Guid.NewGuid(), ranked, CancellationToken.None, track: Query()); Check(sharedSource.Fetches == fetches && searchStore.Get<RawLyrics>("raw", selected.Hash) != null, "manual use reuses parsed document and raw response");
        var nativeResult = await shared.Get(Guid.NewGuid(), Query(), false, CancellationToken.None); var liveItem = Guid.NewGuid(); paths.Start(liveItem, Query()); for (int i = 0; i < 80 && !paths.Status(liveItem).Complete; i++) await Task.Delay(50); Check(nativeResult?.ProviderId == ranked.Id && paths.Status(liveItem).Lyrics?.ProviderId == ranked.Id, "all retrieval paths rank identical candidate sets identically");
        var staleItem = Guid.NewGuid(); var baseline = Timed(0); searchStore.Save(staleItem, baseline); searchStore.Put("better", staleItem.ToString("N"), new ImprovementOffer("stale-hash", Timed(8), ranked, "timing", "fixture")); Check(paths.Start(staleItem, Query()).Offer == null, "stale offer rejected after content change");
        var measuredHash = Codec.ContentHash(baseline); searchStore.Put("selection-assessment", staleItem.ToString("N"), new SelectionAssessment(measuredHash, ranked)); Check(Codec.ContentHash(baseline) == measuredHash, "assessment does not change content identity");
        var benchmarks = new List<double>(); for (int round = 0; round < 25; round++) { var watch = Stopwatch.StartNew(); var m = new MatchingSession(Query()); var set = Enumerable.Range(0, 200).Select(i => m.Assess(C(i.ToString(), i % 5 == 0 ? "朝の光 " + i : i % 5 == 1 ? "晨光 " + i : i % 3 == 0 ? "Morning light (2020 Remaster)" : "Morning light", album: i % 2 == 0 ? "Album" : "Collection"))).ToList(); set.Sort(LyricRanking.Compare); watch.Stop(); if (round >= 5) benchmarks.Add(watch.Elapsed.TotalMilliseconds); Check(m.Metrics.Assessments == 200, "benchmark assessment count"); }
        var p95 = benchmarks.Order().ElementAt((int)Math.Ceiling(benchmarks.Count * .95) - 1); Check(p95 < 100, "200-candidate p95 budget " + p95);
        var raw = new RawLyrics(string.Join("\n", Enumerable.Range(0, 1000).Select(i => $"[{i * 2000},1000]({i * 2000},500,0)hello({i * 2000 + 500},500,0) world"))); var parseTimes = new List<double>(); var timingTimes = new List<double>(); for (int i = 0; i < 12; i++) { var w = Stopwatch.StartNew(); var d = Normalization.Parse(raw, C()); w.Stop(); if (i > 1) parseTimes.Add(w.Elapsed.TotalMilliseconds); w.Restart(); var t = LyricRanking.Timing(d); w.Stop(); if (i > 1) timingTimes.Add(w.Elapsed.TotalMilliseconds); Check(t.SungLines == 1000 && t.WordLines == 1000, "1000-line timing coverage"); }
        Console.WriteLine($"PASS ranking gates, qualifiers, Unicode/timing coverage, deterministic comparisons, deduplication, fallback and expansion. BENCH 200 candidates p95={p95:F2}ms; 1000-line parse mean={parseTimes.Average():F2}ms; coverage mean={timingTimes.Average():F2}ms.");
    }
}
public sealed class RankSource : ILyricSource
{
    public string Name => "QQ"; public int Fetches, Searches; public bool MissingFirst, Expand, Captcha; public System.Net.HttpStatusCode? Failure; public List<string> Queries = []; public bool SupportsQueryExpansion => Expand;
    public Task<List<Candidate>> Search(TrackMultiArtistMetadata track, CancellationToken token) => SearchQuery(track, "", token);
    public Task<List<Candidate>> SearchQuery(TrackMultiArtistMetadata track, string query, CancellationToken token) { Searches++; Queries.Add(query); if (Captcha) throw new Lyricify.Lyrics.Providers.Web.Musixmatch.RequestCaptchaException(); if (Failure != null) throw new HttpRequestException("SECRET", null, Failure); return Task.FromResult(Enumerable.Range(1, Expand ? 1 : 4).Select(i => new Candidate(Name, i.ToString(), "Morning light", "Singer", "Album", 200000, 0)).ToList()); }
    public Task<RawLyrics?> Fetch(Candidate candidate, CancellationToken token) { Interlocked.Increment(ref Fetches); return Task.FromResult<RawLyrics?>(Expand || MissingFirst && candidate.Id == "1" ? null : new("[1000,1000](1000,500,0)hello(1500,500,0) world")); }
}

public sealed class PipelineCounter { public int Active, Maximum; public void Enter() { var n = Interlocked.Increment(ref Active); int old; do { old = Maximum; if (n <= old) return; } while (Interlocked.CompareExchange(ref Maximum, n, old) != old); } public void Exit() => Interlocked.Decrement(ref Active); }
public sealed class PipelineSource(string name, PipelineCounter counter) : ILyricSource
{
    public string Name => name;
    public async Task<List<Candidate>> Search(TrackMultiArtistMetadata track, CancellationToken token) { counter.Enter(); try { await Task.Delay(20, token); return [new(Name, "1", "Morning light", "Singer", "Album", 200000, 0)]; } finally { counter.Exit(); } }
    public async Task<RawLyrics?> Fetch(Candidate candidate, CancellationToken token) { counter.Enter(); try { await Task.Delay(20, token); return new("[00:01.00]hello"); } finally { counter.Exit(); } }
}
