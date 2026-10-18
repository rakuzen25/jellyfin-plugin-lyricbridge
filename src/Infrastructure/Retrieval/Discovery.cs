using System.Collections.Concurrent;
using Lyricify.Lyrics.Models;
using Lyricify.Lyrics.Helpers;
namespace LyricBridge;

public sealed class Discovery(Store store, ProviderRegistry registry, Retrieval retrieval, Func<int>? minimumMatch = null, TimeSpan? discoveryTimeout = null) : IDisposable
{
    private sealed class Entry(TimeSpan timeout, StoreAdmission admission)
    {
        public StoreAdmission Admission { get; } = admission; public readonly object Gate = new(); public LyricOutcome Value = new(); public readonly CancellationTokenSource Cancellation = new(timeout); public DateTime Created = DateTime.UtcNow; public Task Work = Task.CompletedTask;
    }
    private readonly ConcurrentDictionary<Guid, Entry> entries = new();
    private readonly ConcurrentDictionary<string, SearchSession> searches = new();
    private readonly object searchAdmission = new();
    private List<InstrumentalEvidence> Evidence(Guid item) => (store.Get<List<InstrumentalEvidence>>("instrumental-evidence", item.ToString("N")) ?? []).Where(e => e.Manual || e.Expires > DateTime.UtcNow).ToList();
    public LyricOutcome Start(Guid item, TrackMultiArtistMetadata track, bool retry = false, RichLyrics? displayed = null)
    {
        var ticket = store.Admit(item);
        var admittedEpoch = ticket.Epoch;
        lock (searchAdmission)
        {
            if (store.IsResetting || admittedEpoch != store.Epoch)
                throw new WorkflowException(409, "reset_in_progress", "Managed lyric reset in progress.", true);
            Sweep();
            if (retry)
                store.ResumeDiscovery(item);
            if (store.DiscoverySuppressed(item))
                return new()
                {
                    State = "cleared",
                    Complete = true
                };
            if (store.Get<MatchRejection>("rejected-match", item.ToString("N")) != null)
                return new()
                {
                    State = "rejected",
                    Complete = true
                };
            var mark = store.Get<InstrumentalEvidence>("instrumental", item.ToString("N"));
            if (mark != null && (mark.Manual || (!retry && mark.Expires > DateTime.UtcNow)))
                return new()
                {
                    State = "instrumental",
                    Instrumental = [mark],
                    Complete = true
                };
            var selected = displayed ?? retrieval.Selected(item);
            if (selected != null && !retry)
            {
                if (entries.TryGetValue(item, out var running))
                {
                    lock (running.Gate)
                    {
                        if (!running.Value.Complete && running.Value.Lyrics?.Hash == selected.Hash)
                            return Copy(running.Value);
                    }
                }
                var offer = store.Get<ImprovementOffer>("better", item.ToString("N"));
                if (offer?.BaselineHash != selected.Hash)
                    offer = null;
                return new()
                {
                    State = "ready",
                    Lyrics = selected,
                    Assessment = CurrentAssessment(item, track, selected),
                    Instrumental = Evidence(item),
                    Better = offer?.Lyrics,
                    Offer = offer,
                    Complete = true
                };
            }
            if (entries.TryGetValue(item, out var existing))
            {
                lock (existing.Gate)
                {
                    if (!retry || !existing.Value.Complete)
                        return Copy(existing.Value);
                }
                if (entries.TryRemove(item, out var removed))
                    removed.Cancellation.Dispose();
            }
            var next = new Entry(discoveryTimeout ?? TimeSpan.FromSeconds(20), ticket);
            if (selected != null)
            {
                next.Value.Lyrics = selected;
                next.Value.State = "ready";
            }
            var entry = entries.GetOrAdd(item, next);
            if (ReferenceEquals(next, entry))
                entry.Work = Discover(item, track, entry, ticket);
            else
                next.Cancellation.Dispose();
            lock (entry.Gate)
                return Copy(entry.Value);
        }
    }

    public MatchAssessment CurrentAssessment(Guid item, TrackMultiArtistMetadata track, RichLyrics selected)
    {
        var record = store.Get<SelectionAssessment>("selection-assessment", item.ToString("N"));
        if (record?.Hash == selected.Hash && record.Candidate.Assessment != null)
            return record.Candidate.Assessment;
        var candidate = new Candidate(selected.Source, selected.ProviderId, selected.Title, selected.Artist, "", null, 0);
        return LyricRanking.WithDocument(new MatchingSession(track, minimumMatch?.Invoke() ?? 70).Assess(candidate).Assessment!, selected);
    }
    public LyricOutcome Status(Guid item)
    {
        if (store.DiscoverySuppressed(item))
            return new()
            {
                State = "cleared",
                Complete = true
            };
        if (store.Get<MatchRejection>("rejected-match", item.ToString("N")) != null)
            return new()
            {
                State = "rejected",
                Complete = true
            };
        if (entries.TryGetValue(item, out var entry))
        {
            lock (entry.Gate)
            {
                var value = Copy(entry.Value);
                var latest = store.Improvement(item);
                if (latest != null && latest.BaselineHash == value.Lyrics?.Hash)
                {
                    value.Offer = latest;
                    value.Better = latest.Lyrics;
                }
                return value;
            }
        }
        var mark = store.Get<InstrumentalEvidence>("instrumental", item.ToString("N"));
        if (mark != null && (mark.Manual || mark.Expires > DateTime.UtcNow))
            return new()
            {
                State = "instrumental",
                Instrumental = [mark],
                Complete = true
            };
        var selected = retrieval.Selected(item);
        var offer = store.Get<ImprovementOffer>("better", item.ToString("N"));
        if (offer?.BaselineHash != selected?.Hash)
            offer = null;
        return new()
        {
            State = "ready",
            Lyrics = selected,
            Assessment = store.Get<SelectionAssessment>("selection-assessment", item.ToString("N"))?.Candidate.Assessment,
            Instrumental = Evidence(item),
            Better = offer?.Lyrics,
            Offer = offer,
            Complete = true
        };
    }
    private static LyricOutcome Copy(LyricOutcome value) => Codec.Deserialize<LyricOutcome>(Codec.Serialize(value))!;
    private async Task Discover(Guid item, TrackMultiArtistMetadata track, Entry entry, StoreAdmission ticket)
    {
        using var operation = store.Operation(ticket);
        var epoch = ticket.Epoch;
        await retrieval.Populate(item, track, entry.Value, entry.Gate, entry.Cancellation.Token, () => !store.IsResetting && epoch == store.Epoch && entries.TryGetValue(item, out var active) && ReferenceEquals(active, entry));
    }
    public SearchSession Search(Guid user, Guid item, TrackMultiArtistMetadata track, string? only)
    {
        var ticket = store.Admit(item);
        var admittedEpoch = ticket.Epoch;
        lock (searchAdmission)
        {
            if (store.IsResetting || admittedEpoch != store.Epoch)
                throw new WorkflowException(409, "reset_in_progress", "Managed lyric reset in progress.", true);
            Sweep();
            var active = searches.Values.Where(s => !s.Work.IsCompleted).ToList();
            if (active.Count >= 16 || active.Count(s => s.UserId == user) >= 2)
                throw new ServiceFailure("search_limit", "Too many active searches. Wait for a search to finish and retry.", DateTimeOffset.UtcNow.AddSeconds(15));
            var session = new SearchSession { UserId = user, ItemId = item, Admission = ticket, Baseline = store.Selection(item) };
            searches[session.Id] = session;
            session.Work = SearchWork(session, track, only, ticket);
            return Snapshot(session);
        }
    }
    public async Task<List<Candidate>> Candidates(Guid user, Guid item, TrackMultiArtistMetadata track, CancellationToken token)
    {
        var admitted = Search(user, item, track, null);
        if (!searches.TryGetValue(admitted.Id, out var session))
            throw new InvalidOperationException("Search expired.");
        using var cancellation = token.Register(() => session.Cancellation.Cancel());
        await session.Work;
        token.ThrowIfCancellationRequested();
        return Snapshot(session).Candidates.OrderBy(candidate => candidate, Comparer<Candidate>.Create(LyricRanking.Compare)).ToList();
    }
    public SearchSession? SearchStatus(string id, Guid user) => searches.TryGetValue(id, out var s) && s.UserId == user ? Snapshot(s) : null;
    public bool CancelSearch(string id, Guid user)
    {
        if (!searches.TryGetValue(id, out var s) || s.UserId != user)
            return false;
        s.Cancellation.Cancel();
        return true;
    }
    private static SearchSession Snapshot(SearchSession s)
    {
        lock (s)
            return new()
            {
                Id = s.Id,
                UserId = s.UserId,
                ItemId = s.ItemId,
                State = s.State,
                Finished = s.Finished,
                Total = s.Total,
                Candidates = s.Candidates.ToList(),
                Errors = s.Errors.ToList(),
                Recommended = s.Recommended,
                Improvement = s.Improvement,
                Metrics = s.Metrics
            };
    }
    private async Task SearchWork(SearchSession session, TrackMultiArtistMetadata track, string? only, StoreAdmission ticket)
    {
        using var operation = store.Operation(ticket);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(session.Cancellation.Token, deadline.Token);
        session.Total = registry.Sources.Count(s => string.IsNullOrWhiteSpace(only) || s.Name == only);
        var matching = new MatchingSession(track, minimumMatch?.Invoke() ?? 70);
        session.Metrics = matching.Metrics;
        await retrieval.Collect(matching, true, budget.Token, e => { lock (session) session.Errors.Add(e); }, candidate => { lock (session) session.Candidates.Add(candidate); }, verification =>
        {
            var c = verification.Candidate;
            retrieval.CachePreview(verification);
            lock (session)
            {
                var index = session.Candidates.FindIndex(x => LyricRanking.Key(x) == LyricRanking.Key(c));
                if (index >= 0)
                    session.Candidates[index] = c;

            }
        }, only, () => { lock (session) session.Finished++; });
        lock (session)
        {
            session.State = session.Cancellation.IsCancellationRequested ? "cancelled" : deadline.IsCancellationRequested ? "timed_out" : "complete";
            session.Candidates.Sort(LyricRanking.Compare);
            if (session.State == "cancelled")
                return;
            var best = session.Candidates.FirstOrDefault(x => x.Verification == "verified" && x.Assessment?.Eligible == true);
            session.Recommended = best == null ? null : LyricRanking.Key(best);
            var baseline = session.Baseline;
            if (best == null || baseline?.Lyrics == null || baseline.Assessment?.Candidate.Assessment == null)
                return;
            var assessed = baseline.Assessment.Candidate with
            {
                Assessment = LyricRanking.WithDocument(baseline.Assessment.Candidate.Assessment, baseline.Lyrics)
            };
            var reason = LyricRanking.Improvement(best, assessed);
            if (reason == null)
                return;
            var lyrics = Preview(best);
            if (lyrics == null || lyrics.Hash == baseline.Lyrics.Hash)
                return;
            var offer = store.TryOffer(session.ItemId, baseline, new(baseline.Lyrics.Hash, lyrics, best, reason, LyricRanking.ImprovementDescription(best, assessed, reason)), store.Get<RawLyrics>("raw", lyrics.Hash));
            if (offer != null && LyricRanking.Key(offer.Candidate) == LyricRanking.Key(best))
                session.Improvement = new(LyricRanking.Key(best), offer.Lyrics.Hash, offer.BaselineHash, offer.Reason, offer.Description);
        }
    }
    public RichLyrics? Preview(Candidate candidate) => store.GetPreview(candidate.Source + ":" + candidate.Id);
    public void Mark(Guid item, bool clear)
    {
        Invalidate(item);
        store.MarkInstrumental(item, clear);
        Invalidate(item);
    }
    public void Invalidate(Guid item)
    {
        if (entries.TryRemove(item, out var e))
        {
            lock (e.Gate)
            {
                e.Cancellation.Cancel();
                if (e.Value.Complete)
                    e.Cancellation.Dispose();
            }
        }
        store.Delete("better", item.ToString("N"));
    }
    public void InvalidateDeleted(Guid item, long revision)
    {
        lock (searchAdmission)
        {
            if (entries.TryGetValue(item, out var entry) && entry.Admission.Revision < revision && entries.TryRemove(new KeyValuePair<Guid, Entry>(item, entry)))
                lock (entry.Gate)
                {
                    entry.Cancellation.Cancel();
                    if (entry.Value.Complete)
                        entry.Cancellation.Dispose();
                }
            foreach (var session in searches.Values.Where(s => s.ItemId == item && s.Admission?.Revision < revision))
                session.Cancellation.Cancel();
        }
    }
    public async Task StopAll()
    {
        var work = new List<Task>();
        SearchSession[] admitted;
        lock (searchAdmission)
        {
            foreach (var pair in entries.ToArray())
            {
                work.Add(pair.Value.Work);
                Invalidate(pair.Key);
            }
            admitted = searches.Values.ToArray();
            foreach (var session in admitted)
            {
                session.Cancellation.Cancel();
                work.Add(session.Work);
            }
        }
        await Task.WhenAll(work);
        lock (searchAdmission)
            foreach (var session in admitted)
                if (searches.TryRemove(session.Id, out var removed))
                    removed.Cancellation.Dispose();
    }
    private void Sweep()
    {
        foreach (var s in searches.Values.Where(s => s.Created < DateTime.UtcNow.AddMinutes(-5)))
            if (searches.TryRemove(s.Id, out var removed))
            {
                removed.Cancellation.Cancel();
                removed.Cancellation.Dispose();
            }
        foreach (var pair in entries.Where(p => p.Value.Created < DateTime.UtcNow.AddMinutes(-10) && p.Value.Value.Complete))
            if (entries.TryRemove(pair.Key, out var e))
                e.Cancellation.Dispose();
    }
    public void Dispose()
    {
        foreach (var e in entries.Values)
        {
            e.Cancellation.Cancel();
            e.Cancellation.Dispose();
        }
        foreach (var s in searches.Values)
        {
            s.Cancellation.Cancel();
            s.Cancellation.Dispose();
        }
    }
}
