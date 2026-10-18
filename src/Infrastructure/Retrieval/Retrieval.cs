using System.Collections.Concurrent;
using Lyricify.Lyrics.Models;
using Microsoft.Extensions.Logging;
namespace LyricBridge;

public sealed class Retrieval(Store store, ProviderRegistry registry, ILogger<Retrieval> logger, Func<int>? minimumMatch = null, TimeProvider? timeProvider = null)
{
    private readonly TimeProvider clock = timeProvider ?? TimeProvider.System;
    private readonly KeyedAsyncLock<Guid> locks = new();
    private readonly ConcurrentDictionary<string, SemaphoreSlim> providerLocks = new();
    private readonly ConcurrentDictionary<string, DateTime> retryAfter = new();
    private readonly ConcurrentDictionary<Guid, DateTime> missingUntil = new();
    public void ClearMissingCache() => missingUntil.Clear();
    public int ExpireMissingCache()
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var removed = 0;
        foreach (var entry in missingUntil)
            if (entry.Value <= now && missingUntil.TryRemove(entry))
                removed++;
        return removed;
    }
    public RichLyrics? Selected(Guid item) => store.Get<RichLyrics>("selected", item.ToString("N"));
    internal bool InBackoff(string source) => retryAfter.TryGetValue(source, out var until) && until > DateTime.UtcNow;
    internal async Task<T?> Run<T>(ILyricSource source, Func<CancellationToken, Task<T>> action, CancellationToken token, Action<SafeError>? report = null)
    {
        var gate = providerLocks.GetOrAdd(source.Name, _ => new(1));
        await gate.WaitAsync(token);
        try
        {
            if (retryAfter.TryGetValue(source.Name, out var until) && until > DateTime.UtcNow)
            {
                report?.Invoke(SafeError.Create("provider_backoff", source.Name + " is temporarily unavailable.", true, until));
                return default;
            }
            using var budget = CancellationTokenSource.CreateLinkedTokenSource(token);
            budget.CancelAfter(TimeSpan.FromSeconds(20));
            token.ThrowIfCancellationRequested();
            var result = await action(budget.Token);
            budget.Token.ThrowIfCancellationRequested();
            await Task.Delay(300, token);
            return result;
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { retryAfter[source.Name] = DateTime.UtcNow.AddMinutes(1); logger.LogWarning("Lyric source {Source} timed out; retry delayed", source.Name); report?.Invoke(SafeError.Create("provider_timeout", source.Name + " timed out.", true, retryAfter[source.Name])); return default; }
        catch (OperationCanceledException) { throw; }
        catch (Lyricify.Lyrics.Providers.Web.Musixmatch.RequestCaptchaException)
        {
            var until = DateTime.UtcNow.AddMinutes(5);
            retryAfter[source.Name] = until;
            var failure = SafeError.Create("provider_verification_required", source.Name + " requires verification before lyrics can be retrieved.", true, until);
            logger.LogWarning("Lyric source {Source} requires verification; retry delayed until {RetryAt}; reference {DiagnosticId}", source.Name, until, failure.DiagnosticId);
            report?.Invoke(failure);
            return default;
        }
        catch (HttpRequestException e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound) { return default; }
        catch (HttpRequestException e) when (e.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden or System.Net.HttpStatusCode.TooManyRequests)
        {
            var rate = e.StatusCode == System.Net.HttpStatusCode.TooManyRequests;
            var until = e.Data["retryAfter"] is DateTime date && date > DateTime.UtcNow ? date : DateTime.UtcNow.AddMinutes(1);
            retryAfter[source.Name] = until;
            logger.LogWarning("Lyric source {Source}: {Code}; retry delayed", source.Name, rate ? "rate limit" : "authentication failure");
            report?.Invoke(SafeError.Create(rate ? "provider_rate_limited" : "provider_authentication", rate ? source.Name + " rate-limited requests. Retry after the indicated time." : source.Name + " rejected authentication. Check the source credentials.", true, until));
            return default;
        }
        catch (Exception error) { retryAfter[source.Name] = DateTime.UtcNow.AddMinutes(1); var failure = SafeError.Create("provider_failed", source.Name + " could not retrieve lyrics.", true, retryAfter[source.Name]); logger.LogWarning("Lyric source {Source} failed ({FailureType}); retry delayed; reference {DiagnosticId}", source.Name, error.GetType().Name, failure.DiagnosticId); report?.Invoke(failure); return default; }
        finally { gate.Release(); }
    }
    public async Task<List<Candidate>> Candidates(TrackMultiArtistMetadata track, CancellationToken token, bool manual = true)
    {
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(token);
        budget.CancelAfter(TimeSpan.FromSeconds(manual ? 15 : 20));
        var session = new MatchingSession(track, minimumMatch?.Invoke() ?? 70);
        var results = new ConcurrentDictionary<string, Candidate>();
        await Collect(session, manual, budget.Token, _ => { }, c => results[LyricRanking.Key(c)] = c, v => { results[LyricRanking.Key(v.Candidate)] = v.Candidate; if (v.Lyrics != null) CachePreview(v); });
        token.ThrowIfCancellationRequested();
        return results.Values.OrderBy(c => c, Comparer<Candidate>.Create(LyricRanking.Compare)).ToList();
    }
    internal void CachePreview(Verification verification) => store.CachePreview(verification);
    internal async Task Collect(MatchingSession session, bool manual, CancellationToken token, Action<SafeError> error, Action<Candidate>? pending, Action<Verification> result, string? only = null, Action? finished = null)
    {
        using var limit = new SemaphoreSlim(3);
        var sources = registry.Sources;
        await Task.WhenAll(sources.Select(async (source, order) =>
        {
            if (!string.IsNullOrWhiteSpace(only) && source.Name != only)
                return;
            bool acquired = false;
            try
            {
                await limit.WaitAsync(token);
                acquired = true;
                await session.RunProvider(this, source, order, manual, token, error, pending, result);
            }
            catch (OperationCanceledException) { if (token.IsCancellationRequested) error(SafeError.Create("discovery_timeout", source.Name + " did not complete before the search deadline.", true)); }
            catch { error(SafeError.Create("provider_failed", source.Name + " could not retrieve lyrics.", true)); }
            finally { if (acquired) limit.Release(); finished?.Invoke(); }
        }));
    }
    internal async Task Populate(Guid item, TrackMultiArtistMetadata track, LyricOutcome outcome, object gate, CancellationToken token, Func<bool> active, string? expectedHash = null)
    {
        var id = item.ToString("N");
        var session = new MatchingSession(track, minimumMatch?.Invoke() ?? 70);
        outcome.Total = registry.Sources.Count;
        outcome.Metrics = session.Metrics;
        var results = new List<Verification>();
        Task? window = null;
        using var windowCancel = new CancellationTokenSource();
        if (outcome.Lyrics is { } baseline)
        {
            var recorded = store.Get<SelectionAssessment>("selection-assessment", id);
            var c = recorded?.Hash == baseline.Hash ? recorded.Candidate : new Candidate(baseline.Source, baseline.ProviderId, baseline.Title, baseline.Artist, "", null, 0);
            outcome.Assessment = LyricRanking.WithDocument(session.Assess(c).Assessment!, baseline);
        }
        void Commit()
        {
            lock (gate)
            {
                if (!active() || outcome.Lyrics != null || results.Count == 0)
                    return;
                var best = results.MinBy(v => v.Candidate, Comparer<Candidate>.Create(LyricRanking.Compare))!;
                if (!store.TrySaveAutomatic(item, best, expectedHash))
                    return;
                outcome.Lyrics = best.Lyrics;
                outcome.Assessment = best.Candidate.Assessment;
                outcome.State = "ready";
            }
        }
        async Task CommitLater()
        {
            try
            {
                await Task.Delay(2000, windowCancel.Token);
                Commit();
            }
            catch (OperationCanceledException) { }
        }
        void Consider(Verification v)
        {
            lock (gate)
            {
                if (!active())
                    return;
                CachePreview(v);
                if (v.Instrumental)
                {
                    outcome.Instrumental.Add(new(v.Candidate.Source, v.Candidate.Id, v.InstrumentalReason ?? "Provider instrumental flag", Expires: DateTime.UtcNow.AddDays(7)));
                    if (v.Raw != null)
                        store.Put("raw", Codec.Hash(Codec.Serialize(v.Raw)), v.Raw);
                    return;
                }
                if (v.Lyrics == null)
                    return;
                results.Add(v);
                if (outcome.Lyrics == null)
                {
                    window ??= CommitLater();
                    return;
                }
                if (outcome.Lyrics.Hash == v.Lyrics.Hash)
                    return;
                var baselineCandidate = new Candidate(outcome.Lyrics.Source, outcome.Lyrics.ProviderId, outcome.Lyrics.Title, outcome.Lyrics.Artist, "", null, 0, Assessment: outcome.Assessment);
                var reason = LyricRanking.Improvement(v.Candidate, baselineCandidate);
                if (reason == null)
                    return;
                if (outcome.Offer != null && LyricRanking.Compare(v.Candidate, outcome.Offer.Candidate) >= 0)
                    return;
                var proposed = new ImprovementOffer(outcome.Lyrics.Hash, v.Lyrics, v.Candidate, reason, LyricRanking.ImprovementDescription(v.Candidate, baselineCandidate, reason));
                var offer = store.TryOffer(item, store.Selection(item), proposed, v.Raw, baselineCandidate, outcome.Lyrics);
                if (offer == null)
                    return;
                outcome.Offer = offer;
                outcome.Better = offer.Lyrics;
            }
        }
        await Collect(session, false, token, e => { lock (gate) outcome.Errors.Add(e); }, null, Consider, finished: () => { lock (gate) outcome.Finished++; });
        Commit();
        windowCancel.Cancel();
        if (window != null)
            await window;
        lock (gate)
        {
            if (active())
                store.Put("instrumental-evidence", id, outcome.Instrumental);
            outcome.Complete = true;
            if (outcome.Lyrics != null)
                outcome.State = outcome.Errors.Count > 0 ? "partial" : "ready";
            else if (outcome.Instrumental.Count > 0)
            {
                outcome.State = "instrumental";
                if (active())
                    store.Put("instrumental", id, outcome.Instrumental[0]);
            }
            else
                outcome.State = outcome.Errors.Count > 0 ? "failed" : "missing";
        }
    }
    public async Task<RichLyrics?> Get(Guid item, TrackMultiArtistMetadata track, bool upgrade, CancellationToken token)
    {
        using var operation = store.Operation(store.Admit(item));
        using var lease = await locks.Acquire(item, token);
        var epoch = store.Epoch;
        if (store.IsResetting || store.DiscoverySuppressed(item))
            return null;
        var previous = Selected(item);
        if (previous != null && !upgrade)
            return previous;
        var instrumental = store.Get<InstrumentalEvidence>("instrumental", item.ToString("N"));
        if (!upgrade && instrumental != null && (instrumental.Manual || instrumental.Expires > DateTime.UtcNow))
            return null;
        if (!upgrade && missingUntil.TryGetValue(item, out var until) && until > clock.GetUtcNow().UtcDateTime)
            return null;
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(token);
        budget.CancelAfter(TimeSpan.FromSeconds(20));
        var outcome = new LyricOutcome();
        await Populate(item, track, outcome, new object(), budget.Token, () => epoch == store.Epoch && !store.IsResetting, upgrade ? previous?.Hash : null);
        token.ThrowIfCancellationRequested();
        if (outcome.Lyrics == null)
            missingUntil[item] = clock.GetUtcNow().UtcDateTime.AddMinutes(10);
        return outcome.Lyrics ?? previous;
    }
    private async Task<Verification> Resolve(Candidate candidate, CancellationToken token, TrackMultiArtistMetadata? track = null)
    {
        var query = track ?? new()
        {
            Title = candidate.Title,
            Artists = (candidate.Artists ?? candidate.Artist.Split(", ")).ToList(),
            Album = candidate.Album,
            AlbumArtists = (candidate.AlbumArtists ?? []).ToList(),
            DurationMs = candidate.DurationMs
        };
        var matching = new MatchingSession(query, minimumMatch?.Invoke() ?? 70);
        var assessed = matching.Assess(candidate);
        var cached = store.GetPreview(LyricRanking.Key(candidate));
        var saved = store.Get<SelectionAssessment>("preview-assessment", LyricRanking.Key(candidate));
        if (cached != null && saved?.Hash == cached.Hash)
            return new(assessed with
            {
                Verification = "verified",
                Assessment = LyricRanking.WithDocument(assessed.Assessment!, cached)
            }, cached, store.Get<RawLyrics>("raw", cached.Hash));
        var source = registry.Sources.FirstOrDefault(s => s.Name == candidate.Source) ?? throw new ArgumentException("Source is disabled or requires credentials.");
        var result = await matching.Verify(this, source, assessed, token, _ => { });
        CachePreview(result);
        return result;
    }
    public async Task<RichLyrics> Select(Guid item, Candidate candidate, CancellationToken token, Action? beforeSave = null, TrackMultiArtistMetadata? track = null)
    {
        using var operation = store.Operation(store.Admit(item));
        using var lease = await locks.Acquire(item, token);
        var epoch = store.Epoch;
        var verified = await Resolve(candidate, token, track);
        if (verified.Instrumental || verified.Lyrics == null)
            throw new InvalidDataException("Lyrics unavailable.");
        if (epoch != store.Epoch || store.IsResetting)
            throw new OperationCanceledException();
        beforeSave?.Invoke();
        verified.Lyrics.Manual = true;
        verified.Lyrics.Hash = Codec.ContentHash(verified.Lyrics);
        store.ApplySelection(item, new(verified.Lyrics, null, null, new SelectionAssessment(verified.Lyrics.Hash, verified.Candidate)), verified.Raw);
        return verified.Lyrics;
    }
    public async Task<RichLyrics?> Fetch(Candidate candidate, CancellationToken token, TrackMultiArtistMetadata? track = null)
    {
        using var operation = store.Operation();
        var epoch = store.Epoch;
        var result = await Resolve(candidate, token, track);
        if (epoch != store.Epoch || store.IsResetting || result.Instrumental)
            return null;
        return result.Lyrics;
    }
}
