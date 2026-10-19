using System.Net;
using System.Text;
using System.Text.Json;
using LyricBridge;
using Xunit;

public sealed class TranscriptionTests : StorageFixture
{
    private static readonly GenerationProfile Profile = new("Transcription", "endpoint", "model", "transcription", "", "en", "", 0, 0, 1);
    private const string Words = "{\"language\":\"en\",\"text\":\"Hello world!\",\"words\":[{\"word\":\"Hello\",\"start\":1,\"end\":1.5},{\"word\":\"world!\",\"start\":1.4,\"end\":2}]}";
    private static Transcript Parse(string json = Words, bool segmentOnly = false) => TranscriptionResponse.Parse(json, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid().ToString("N"), Profile, segmentOnly);
    private static BoundaryVersion Initial(Transcript transcript) => TranscriptBoundaries.Version(transcript, "local", new(), [transcript.Tokens[^1].Id], "fixture/1");
    [Fact]
    public void CompositionPreservesTextOverlapsAndExplicitEnds()
    {
        var transcript = Parse();
        var lyrics = TranscriptBoundaries.Compose(transcript, ["t0", "t1"]);
        Assert.Equal("Hello world!", string.Concat(lyrics.Lines.Select(l => l.Text)));
        Assert.Equal(15_000_000, lyrics.Lines[0].Cues[0].End);
        Assert.Equal(14_000_000, lyrics.Lines[1].Cues[0].Start);
        Assert.Equal(1, lyrics.Lines[1].Cues[0].Position);
        Assert.Contains(transcript.Warnings, w => w.Code == "overlapping_token_times");
        var merged = TranscriptBoundaries.Compose(transcript, ["t1"]);
        Assert.Equal(transcript.Tokens.Select(t => (t.Start, t.End)), merged.Lines.Single().Cues.Select(c => (c.Start, c.End!.Value)));
    }
    [Fact]
    public void FullTextMismatchNeverReplacesTimedText()
    {
        var transcript = Parse(Words.Replace("Hello world!", "A correction with no token timing"));
        Assert.Equal("Hello world!", transcript.Text);
        Assert.Contains("correction", transcript.ProviderText);
        Assert.Contains(transcript.Warnings, w => w.Code == "transcript_text_mismatch");
        Assert.Contains("words", transcript.RawResponses[0]);
    }
    [Fact]
    public void MixedProviderWhitespaceIsPreservedWithoutInsertingWordFragments()
    {
        var transcript = Parse("{\"language\":\"en\",\"text\":\" Hello world, again!\",\"words\":[{\"word\":\" Hello\",\"start\":0,\"end\":1},{\"word\":\"world\",\"start\":1,\"end\":2},{\"word\":\",\",\"start\":2,\"end\":2},{\"word\":\"again!\",\"start\":3,\"end\":4}]}");
        Assert.Equal(" Hello world, again!", transcript.Text);
        Assert.Equal(" Hello", transcript.Tokens[0].Text);
        Assert.Equal("", transcript.Tokens[2].Separator);
        Assert.Equal(transcript.Text, string.Concat(TranscriptBoundaries.Compose(transcript, ["t3"]).Lines.Select(l => l.Text)));
    }
    [Fact]
    public void UnicodeBoundariesUseUtf16AndIntactGraphemes()
    {
        var transcript = Parse("{\"language\":\"ja\",\"text\":\"😀が\",\"words\":[{\"word\":\"😀\",\"start\":0,\"end\":1},{\"word\":\"か\",\"start\":1,\"end\":2},{\"word\":\"゙\",\"start\":2,\"end\":3}]}");
        Assert.Equal(2, transcript.Tokens[0].EndPosition);
        Assert.DoesNotContain("t1", TranscriptBoundaries.Allowed(transcript));
        Assert.Throws<WorkflowException>(() => TranscriptBoundaries.Compose(transcript, ["t1", "t2"]));
        var lyrics = TranscriptBoundaries.Compose(transcript, ["t0", "t2"]);
        Assert.Equal("が", lyrics.Lines[1].Text);
        Assert.Equal(1, lyrics.Lines[1].Cues[0].EndPosition);
        Assert.Equal(transcript.Text, string.Concat(lyrics.Lines.Select(l => l.Text)));
    }
    [Theory]
    [InlineData("{\"text\":\"nothing timed\"}")]
    [InlineData("{\"words\":[{\"word\":\"x\",\"start\":2,\"end\":1}]}")]
    [InlineData("{\"words\":[{\"word\":\"x\",\"start\":-1,\"end\":1}]}")]
    [InlineData("{\"words\":[{\"word\":\"x\",\"start\":1}]}")]
    [InlineData("{\"words\":[{\"word\":\"\",\"start\":0,\"end\":1}]}")]
    [InlineData("<html>not an API</html>")]
    public void InvalidOrUntimedOutputCannotBecomeKaraoke(string raw) => Assert.Throws<ServiceFailure>(() => Parse(raw));
    [Fact]
    public void NestedWordsAndSegmentFallbackAreHonest()
    {
        const string json = "{\"language\":\"Japanese\",\"text\":\"はい\",\"segments\":[{\"text\":\"はい\",\"start\":1,\"end\":2,\"words\":[{\"word\":\"はい\",\"start\":1.1,\"end\":1.5}]}]}";
        var word = Parse(json); Assert.Equal("word", word.Timing); Assert.Equal("ja", word.Language);
        var segment = Parse(json, true); Assert.Equal("segment", segment.Timing);
        var lyrics = TranscriptBoundaries.Compose(segment, ["t0"]);
        Assert.False(lyrics.WordTimed); Assert.Equal(10_000_000, lyrics.Lines[0].Start); Assert.Equal(20_000_000, lyrics.Lines[0].End);
    }
    [Fact]
    public void BoundaryIdsRejectReorderingOmissionsDuplicatesAndUnknowns()
    {
        var transcript = Parse();
        foreach (var ids in new[] { new[] { "t0" }, new[] { "t1", "t0" }, new[] { "t0", "t0", "t1" }, new[] { "unknown", "t1" }, Array.Empty<string>() })
            Assert.Throws<WorkflowException>(() => TranscriptBoundaries.Validate(transcript, ids));
    }
    [Theory]
    [InlineData("en", "A natural phrase. Another reply!")]
    [InlineData("es", "Una frase natural. Otra respuesta!")]
    [InlineData("ar", "مرحبا بالعالم! كيف حالك؟")]
    [InlineData("zh", "你好世界。再见！")]
    public void GenericBreakingIsDeterministicAndLossless(string language, string text)
    {
        var pieces = text.Split(' ');
        var json = Codec.Serialize(new { language, text, words = pieces.Select((word, i) => new { word, start = i * .6, end = i * .6 + .5 }) });
        var transcript = Parse(json); var strategy = new LinguisticBoundaries();
        var a = TranscriptBoundaries.Optimize(transcript, new(8, 1), strategy.Analyze(transcript, TestContext.Current.CancellationToken), strategy.Version, TestContext.Current.CancellationToken);
        var b = TranscriptBoundaries.Optimize(transcript, new(8, 1), strategy.Analyze(transcript, TestContext.Current.CancellationToken), strategy.Version, TestContext.Current.CancellationToken);
        Assert.Equal(a.Id, b.Id); Assert.Equal(a.EndTokenIds, b.EndTokenIds);
        Assert.Equal(transcript.Text, string.Concat(TranscriptBoundaries.Compose(transcript, a.EndTokenIds).Lines.Select(l => l.Text)));
    }
    [Fact]
    public void JapaneseAnalysisProtectsMorphemeAndAuxiliaryGroupsButManualCanOverride()
    {
        var words = new[] { "これは", "食", "べ", "て", "いる", "よ", "。", "そう", "だ", "ね" };
        var raw = Codec.Serialize(new { language = "ja", text = string.Concat(words), words = words.Select((word, i) => new { word, start = i * .2, end = i * .2 + .18 }) });
        var transcript = Parse(raw); var strategy = new LinguisticBoundaries();
        var advice = strategy.Analyze(transcript, TestContext.Current.CancellationToken);
        Assert.False(advice.Single(a => a.AfterId == "t1").Allowed);
        Assert.Contains(advice, a => a.Message?.Contains("auxiliary", StringComparison.Ordinal) == true);
        Assert.Contains("NMeCab", strategy.Version);
        var version = TranscriptBoundaries.Optimize(transcript, new(), advice, strategy.Version, TestContext.Current.CancellationToken);
        Assert.DoesNotContain("t1", version.EndTokenIds);
        TranscriptBoundaries.Validate(transcript, ["t1", "t9"]);
    }
    [Fact]
    public void AtomicCommitConflictPreservesSelectionAndSavedVersions()
    {
        using var store = Own(new Store(Root)); var transcript = Parse(); var version = Initial(transcript);
        var job = new Job { ItemId = transcript.ItemId, Hash = transcript.Id, State = "running", TaskKind = "transcription" };
        Assert.True(store.PersistRequest(job, store.Epoch)); Assert.True(store.CompleteTranscript(job, transcript, version));
        var baseline = store.SelectionIdentity(transcript.ItemId);
        store.ApplySelection(transcript.ItemId, new(new RichLyrics { Source = "fixture", Lines = [new() { Id = "l0", Text = "Other original" }] }, null));
        Assert.Throws<WorkflowException>(() => store.CommitBoundary(transcript.ItemId, transcript, version, baseline));
        Assert.Equal("Other original", store.Selection(transcript.ItemId).Lyrics!.Lines[0].Text);
        Assert.Single(store.BoundaryVersions(transcript.Id));
        var selected = store.CommitBoundary(transcript.ItemId, transcript, version, store.SelectionIdentity(transcript.ItemId));
        Assert.Equal(selected.Hash, store.Selection(transcript.ItemId).Lyrics!.Hash);
        Assert.False(store.SavedOriginals(transcript.ItemId).First(o => o.Hash == selected.Hash).AutoSaved);
        Assert.Throws<WorkflowException>(() => store.DeleteTranscript(transcript.ItemId, transcript.Id, transcript.UserId, true));
        store.DeleteOriginal(transcript.ItemId, selected.Hash);
        Assert.NotNull(store.Transcript(transcript.Id));
        store.DeleteTranscript(transcript.ItemId, transcript.Id, transcript.UserId, true);
        Assert.Null(store.Transcript(transcript.Id)); Assert.Empty(store.BoundaryVersions(transcript.Id));
    }
    [Fact]
    public void TranscriptDeletionFenceRejectsPreviouslyAdmittedCompletionAndReimport()
    {
        using var store = Own(new Store(Root)); var transcript = Parse(); var version = Initial(transcript);
        var ticket = store.Admit(transcript.ItemId);
        var original = new Job { ItemId = transcript.ItemId, Hash = transcript.Id, State = "running", DeletionRevision = ticket.Revision, TaskKind = "transcription" };
        Assert.True(store.PersistRequest(original, ticket.Epoch)); Assert.True(store.CompleteTranscript(original, transcript, version));
        var review = new Job { ItemId = transcript.ItemId, Hash = transcript.Id, State = "running", DeletionRevision = ticket.Revision, TaskKind = "boundary-review" };
        Assert.True(store.PersistRequest(review, ticket.Epoch));
        Assert.Contains(review.Id, store.DeleteTranscript(transcript.ItemId, transcript.Id, transcript.UserId, false));
        Assert.False(store.CompleteTranscript(review, null, version));
        Assert.False(store.CompleteTranscript(withState(), transcript, version));
        Job withState() { original.State = "running"; return original; }
    }
    [Fact]
    public async Task SharedCoordinatorCountsLanguageAndAudioAdmissionsAtomically()
    {
        using var store = Own(new Store(Root)); using var services = Own(new LanguageServices(ServiceFixtures.Catalog(() => [new() { Name = "Google" }])));
        var handler = new StubTask(); using var generation = Own(new Generation(() => new(true, false, 100, 3), store, services, handlers: [handler]));
        var user = Guid.NewGuid(); var lyrics = new RichLyrics { Hash = "fixture", Lines = [new() { Id = "l0", Text = "hello" }] };
        generation.Request(user, Guid.NewGuid(), lyrics, new() { OptionId = "translation-Google" }, false);
        var submissions = Enumerable.Range(0, 20).Select(_ => Task.Run(() =>
        {
            try { generation.RequestRemote(new() { TaskKind = "transcription", ItemId = Guid.NewGuid(), UserId = user, Hash = Guid.NewGuid().ToString("N"), Audio = new(), Request = new() { Kind = "transcription", Service = "Transcription" } }, false); return true; }
            catch (InvalidOperationException) { return false; }
        }));
        Assert.Equal(2, (await Task.WhenAll(submissions)).Count(x => x)); Assert.Equal(3, store.CountActiveJobs(user));
        Assert.All(store.ActiveJobs(user), job => Assert.Equal("pending", job.State));
        Assert.Throws<UnauthorizedAccessException>(() => generation.Action(store.ActiveJobs(user)[0].Id, "approve", user, false));
    }
    [Fact]
    public void ExplicitEntriesPreservePreferencesAndShareOnlyImmutableBoundaries()
    {
        using var store = new Store(Root); var source = Parse(); var local = Initial(source);
        var job = new Job { ItemId = source.ItemId, UserId = source.UserId, Hash = source.Id, State = "running", TaskKind = "transcription" };
        store.Put("job", job.Id, job);
        Assert.True(store.CompleteTranscript(job, source, null));
        Assert.Empty(store.BoundaryVersions(source.Id)); Assert.Empty(store.SavedEntries(source.Id));
        var first = store.SaveEntry(source, local, source.UserId, false);
        Assert.Equal(first, store.SaveEntry(source, local, source.UserId, false));
        var manual = local with { Origin = "manual", Algorithm = "manual", Settings = new(24, 4, false) };
        var second = store.SaveEntry(source, manual, source.UserId, false);
        Assert.NotEqual(first.Id, second.Id); Assert.Single(store.BoundaryVersions(source.Id));
        Assert.Equal(manual.Settings, second.Settings); Assert.Equal(2, store.SavedEntries(source.Id).Count);
        store.DeleteEntry(source.ItemId, source.Id, first.Id, source.UserId, false);
        Assert.Equal(second.Id, Assert.Single(store.SavedEntries(source.Id)).Id); Assert.Single(store.BoundaryVersions(source.Id));
        store.DeleteEntry(source.ItemId, source.Id, second.Id, source.UserId, false);
        Assert.Empty(store.SavedEntries(source.Id)); Assert.Empty(store.BoundaryVersions(source.Id)); Assert.NotNull(store.Transcript(source.Id));
    }
    [Fact]
    public void EntryDeletionExplainsOriginalDependenciesAndChecksOwnership()
    {
        using var store = new Store(Root); var source = Parse(); var version = Initial(source);
        store.Put("transcript", source.Id, source);
        var entry = store.SaveEntry(source, version, source.UserId, false);
        Assert.False(store.Deletion(source.Id, entry.Id, Guid.NewGuid(), false).Allowed);
        Assert.Throws<WorkflowException>(() => store.DeleteEntry(source.ItemId, source.Id, entry.Id, Guid.NewGuid(), false));
        var review = new Job { ItemId = source.ItemId, Hash = source.Id, TaskKind = "boundary-review", State = "running", Review = new(source.Id, version.Id, new()) };
        store.Put("job", review.Id, review);
        review.Review = review.Review! with { Snapshot = version }; store.Put("job", review.Id, review);
        Assert.True(store.Deletion(source.Id, entry.Id, source.UserId, false).Allowed);
        var lyrics = store.CommitBoundary(source.ItemId, source, version, store.SelectionIdentity(source.ItemId), entry.Id);
        var dependency = Assert.Single(store.Deletion(source.Id, entry.Id, source.UserId, false).Originals);
        Assert.Equal(lyrics.Hash, dependency.OutputHash);
        Assert.Throws<WorkflowException>(() => store.DeleteEntry(source.ItemId, source.Id, entry.Id, source.UserId, true));
        Assert.Single(store.SavedEntries(source.Id));
        store.DeleteOriginal(source.ItemId, lyrics.Hash);
        review = new Job { ItemId = source.ItemId, UserId = source.UserId, Hash = source.Id, TaskKind = "boundary-review", State = "running", DeletionRevision = store.FreshAdmission(source.ItemId).Revision, Review = new(source.Id, version.Id, new(), Snapshot: version) };
        store.Put("job", review.Id, review);
        store.DeleteEntry(source.ItemId, source.Id, entry.Id, source.UserId, false);
        Assert.True(store.CompleteTranscript(review, null, version with { Origin = "AI" }));
        Assert.Equal("review:" + review.Id, Assert.Single(store.SavedEntries(source.Id)).Id);
    }
    [Fact]
    public void EntryDeletionFencesLateSavesAndFailedUseLeavesNoEntry()
    {
        using var store = new Store(Root); var source = Parse(); var version = Initial(source);
        store.Put("transcript", source.Id, source);
        Assert.Throws<WorkflowException>(() => store.CommitBoundary(source.ItemId, source, version, "stale"));
        Assert.Empty(store.SavedEntries(source.Id)); Assert.Empty(store.BoundaryVersions(source.Id));
        var entry = store.SaveEntry(source, version, source.UserId, false);
        var ticket = store.Admit(source.ItemId);
        store.DeleteEntry(source.ItemId, source.Id, entry.Id, source.UserId, false);
        using (store.Operation(ticket)) Assert.Throws<WorkflowException>(() => store.SaveEntry(source, version, source.UserId, false));
        Assert.Empty(store.SavedEntries(source.Id));
        Assert.NotNull(store.SaveEntry(source, version, source.UserId, false));
    }
    [Fact]
    public void SeparateAiCompletionsRetainDistinctEntriesAndHistoryRemovalCannotDeleteThem()
    {
        using var store = new Store(Root); var source = Parse(); var version = Initial(source);
        store.Put("transcript", source.Id, source);
        foreach (var i in Enumerable.Range(0, 2))
        {
            var job = new Job { ItemId = source.ItemId, UserId = source.UserId, Hash = source.Id, TaskKind = "boundary-review", State = "running", Review = new(source.Id, version.Id, new(24 + i), Snapshot: version) };
            store.Put("job", job.Id, job); Assert.True(store.CompleteTranscript(job, null, version)); store.RemoveFinishedJobs([job.Id]);
        }
        var entries = store.SavedEntries(source.Id); Assert.Equal(2, entries.Count); Assert.Single(store.BoundaryVersions(source.Id));
        store.DeleteEntry(source.ItemId, source.Id, entries[0].Id, source.UserId, false);
        Assert.Equal(entries[1].Id, Assert.Single(store.SavedEntries(source.Id)).Id); Assert.Single(store.ReviewResults(source.Id)); Assert.Single(store.BoundaryVersions(source.Id));
    }

    private sealed class StubTask : IRemoteTaskHandler
    {
        public string Kind => "transcription";
        public GenerationProfile Profile(Job job) => TranscriptionTests.Profile;
        public Task Execute(Job job, IProgress<int> progress, CancellationToken token) => Task.CompletedTask;
        public void Release(Job job) { }
    }
    [Theory]
    [InlineData(401, "service_credentials")]
    [InlineData(413, "audio_too_large")]
    [InlineData(400, "timestamp_request_unsupported")]
    [InlineData(429, "rate_limited")]
    [InlineData(302, "endpoint_redirect")]
    public async Task ProviderErrorsNeverEchoResponseBodiesOrKeys(int status, string code)
    {
        var path = Path.Combine(Root, "audio.flac"); Directory.CreateDirectory(Root); await File.WriteAllBytesAsync(path, [1, 2], TestContext.Current.CancellationToken);
        using var http = new HttpClient(new ResponseHandler(_ => new((HttpStatusCode)status) { Content = new StringContent("secret-key-and-private-transcript") }));
        using var provider = new TranscriptionProvider(http);
        var error = await Assert.ThrowsAsync<ServiceFailure>(() => provider.Transcribe(new(path, 1), new() { ApiKey = "secret-key" }, new(), TestContext.Current.CancellationToken));
        Assert.Equal(code, error.Code); Assert.DoesNotContain("secret", error.Message);
    }
    [Theory]
    [InlineData("opus", "audio/ogg", "audio.ogg")]
    [InlineData("flac", "audio/flac", "audio.flac")]
    [InlineData("wav", "audio/wav", "audio.wav")]
    public async Task ProviderUsesConfiguredEndpointMultipartGranularitiesAndBearer(string format, string contentType, string filename)
    {
        var path = Path.Combine(Root, "audio.flac"); Directory.CreateDirectory(Root); await File.WriteAllBytesAsync(path, [1, 2], TestContext.Current.CancellationToken);
        string body = "";
        using var http = new HttpClient(new AsyncHandler(async request =>
        {
            Assert.Equal("https://fixture.invalid/custom/v1/audio/transcriptions", request.RequestUri!.ToString());
            Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
            var multipart = Assert.IsType<MultipartFormDataContent>(request.Content);
            var file = Assert.Single(multipart, part => part.Headers.ContentDisposition?.Name?.Trim('"') == "file");
            Assert.Equal(contentType, file.Headers.ContentType!.MediaType);
            Assert.Equal(filename, file.Headers.ContentDisposition!.FileName!.Trim('"'));
            body = await request.Content!.ReadAsStringAsync(); return new(HttpStatusCode.OK) { Content = new StringContent(Words) };
        }));
        using var provider = new TranscriptionProvider(http);
        await provider.Transcribe(new(path, 1), new() { Endpoint = "https://fixture.invalid/custom/v1/", ApiKey = "fake", Model = "custom-model", UploadFormat = format }, new(), TestContext.Current.CancellationToken);
        Assert.Contains("verbose_json", body); Assert.Contains("custom-model", body); Assert.Contains("word", body); Assert.Contains("segment", body);
        Assert.Contains("timestamp_granularities[]", body);
    }
    [Theory]
    [InlineData("{\"endTokenIds\":[\"t0\"]}")]
    [InlineData("{\"endTokenIds\":[\"t1\",\"t0\"]}")]
    [InlineData("{\"endTokenIds\":[\"t0\",\"t0\",\"t1\"]}")]
    [InlineData("{\"endTokenIds\":[\"t1\"],\"text\":\"replacement\"}")]
    [InlineData("not JSON")]
    public async Task InvalidAiProposalDoesNotMutateTheCurrentVersion(string answer)
    {
        var transcript = Parse(); var version = Initial(transcript); var before = Codec.Serialize(transcript);
        using var http = new HttpClient(new ResponseHandler(_ => new(HttpStatusCode.OK) { Content = new StringContent(Codec.Serialize(new { choices = new[] { new { message = new { content = answer } } } })) }));
        using var provider = new TranscriptionProvider(http);
        var error = await Assert.ThrowsAsync<ServiceFailure>(() => provider.Review(transcript, version, new() { Endpoint = "https://fixture.invalid/v1", Model = "fixture" }, TestContext.Current.CancellationToken));
        Assert.Equal("invalid_boundary_response", error.Code); Assert.Equal(before, Codec.Serialize(transcript)); Assert.Equal(new[] { "t1" }, version.EndTokenIds);
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ReviewSeparatesOwnedBatchFromContextAndRejectsContextBoundary(bool returnContextBoundary)
    {
        var transcript = Parse(Codec.Serialize(new { language = "en", text = string.Join(" ", Enumerable.Repeat("a", 272)), words = Enumerable.Range(0, 272).Select(i => new { word = "a", start = (double)i, end = i + .5 }) }));
        var version = Initial(transcript); var before = Codec.Serialize(version); var calls = 0;
        using var http = new HttpClient(new AsyncHandler(async request =>
        {
            using var envelope = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            using var input = JsonDocument.Parse(envelope.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()!);
            var root = input.RootElement; var final = root.GetProperty("requiredFinalEndTokenId").GetString()!;
            if (calls++ == 0)
            {
                Assert.Equal("t255", final);
                Assert.Equal(256, root.GetProperty("ownedTokens").GetArrayLength());
                Assert.Equal("t255", root.GetProperty("ownedTokens")[255][0].GetString());
                Assert.Equal(16, root.GetProperty("contextAfter").GetArrayLength());
                Assert.Equal(4, root.GetProperty("contextAfter")[15].GetArrayLength());
                Assert.Equal(2_710_000_000L, root.GetProperty("contextAfter")[15][2].GetInt64());
                if (returnContextBoundary) final = "t271";
            }
            else Assert.Equal("t271", final);
            return new(HttpStatusCode.OK) { Content = new StringContent(Codec.Serialize(new { choices = new[] { new { message = new { content = Codec.Serialize(new { endTokenIds = new[] { final } }) } } } })) };
        }));
        using var provider = new TranscriptionProvider(http);
        if (returnContextBoundary)
        {
            var error = await Assert.ThrowsAsync<ServiceFailure>(() => provider.ReviewBatch(transcript, version, new() { Endpoint = "https://fixture.invalid/v1", Model = "fixture" }, new ReviewBatch(0, 256, 0, 272, 0, true), 0, 2, "fixture", TestContext.Current.CancellationToken));
            Assert.Equal("invalid_boundary_response", error.Code); Assert.Contains("context-only", error.Message); Assert.Equal(1, calls);
        }
        else Assert.Equal(new[] { "t255" }, (await provider.ReviewBatch(transcript, version, new() { Endpoint = "https://fixture.invalid/v1", Model = "fixture" }, new ReviewBatch(0, 256, 0, 272, 0, true), 0, 2, "fixture", TestContext.Current.CancellationToken)).EndTokenIds);
        Assert.Equal(before, Codec.Serialize(version));
    }
    public sealed class AsyncHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => response(request);
    }
}
