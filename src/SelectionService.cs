using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Lyrics;
namespace LyricBridge;

public sealed class SelectionService(ISelectionRepository repository, Retrieval retrieval, Discovery discovery, ILyricManager native, LyricQueryService query)
{
    public IReadOnlyList<SavedOriginal> Originals(Guid item) => repository.SavedOriginals(item);
    public RichLyrics PreviewOriginal(Guid item, string hash) => repository.SavedDocument(item, hash);
    public void SelectOriginal(Guid item, string hash) { repository.SelectOriginal(item, hash); discovery.Invalidate(item); }
    public VersionSnapshot Snapshot(Guid item) => repository.Selection(item);
    public void ClearRejection(Guid item) => repository.ClearRejection(item);
    public void Mark(Guid item, bool clear) => discovery.Mark(item, clear);
    public void Reject(Guid item) { discovery.Invalidate(item); repository.ApplySelection(item, new(null, null, new MatchRejection())); }
    public async Task<(LyricOutcome Outcome, RichLyrics? Original)> Preview(Audio item, Candidate candidate, CancellationToken token)
    {
        var lyrics = discovery.Preview(candidate) ?? await retrieval.Fetch(candidate, token, JellyfinTrack.From(item));
        if (lyrics is null) throw new WorkflowException(422, "lyrics_unavailable", "This version has no usable lyrics.", true);
        return (new() { State = "ready", Lyrics = lyrics, Complete = true, Assessment = repository.PreviewAssessment(candidate)?.Candidate.Assessment }, await query.Read(item, token));
    }
    public async Task<RichLyrics> Select(Audio item, Candidate candidate, CancellationToken token)
    {
        var result = await retrieval.Select(item.Id, candidate, token, () => discovery.Invalidate(item.Id), JellyfinTrack.From(item));
        discovery.Invalidate(item.Id); return result;
    }
    public async Task<RichLyrics> Upgrade(Audio item, string? hash, string? baselineHash, CancellationToken token)
    {
        var expected = repository.Selection(item.Id);
        var offer = repository.Improvement(item.Id) ?? throw new WorkflowException(409, "upgrade_unavailable", "No improvement is currently available.", true);
        if ((hash != null && hash != offer.Lyrics.Hash) || (baselineHash != null && baselineHash != offer.BaselineHash)) throw new WorkflowException(409, "upgrade_offer_changed", "Reopen the changed improvement before applying.", true);
        var current = await query.Read(item, token);
        if (current is null || Codec.ContentHash(current) != offer.BaselineHash) throw new WorkflowException(409, "lyric_version_changed", "Reload the selected lyric version.", true);
        var conflict = repository.ApplyUpgrade(item.Id, expected, offer.Lyrics.Hash, offer.BaselineHash);
        if (conflict is not null) throw new WorkflowException(409, conflict, "The lyric state changed. Reload before applying the improvement.", true);
        discovery.Invalidate(item.Id);
        var applied = Codec.Deserialize<RichLyrics>(Codec.Serialize(offer.Lyrics))!;
        applied.Manual = true; return applied;
    }
    public async Task Import(Audio item, ImportLyricsInput input, CancellationToken token)
    {
        RichLyrics lyrics;
        if (input.ExistingLocal)
        {
            var response = await native.GetLyricsAsync(item, token);
            if (response?.Lyrics is not { Count: > 0 }) throw new WorkflowException(422, "local_lyrics_missing", "No existing Jellyfin lyrics were found. Import a file instead.");
            lyrics = new() { Source = "Local", Title = item.Name, Artist = string.Join(", ", item.Artists), Lines = response.Lyrics.Select((line, index) => new LyricLine { Id = $"l{index}", Text = line.Text, Start = line.Start, Cues = line.Cues?.Select(cue => new Cue(cue.Position, cue.EndPosition, cue.Start, cue.End)).ToList() ?? [], Language = Normalization.Detect(line.Text) }).ToList() };
        }
        else
        {
            if (string.IsNullOrWhiteSpace(input.Text) || System.Text.Encoding.UTF8.GetByteCount(input.Text) > 1_000_000) throw new WorkflowException(400, "invalid_import", "Choose a lyric file up to 1 MB.");
            lyrics = Normalization.Parse(new(input.Text, RawResponse: input.Text), new("Imported", "local", item.Name, string.Join(", ", item.Artists), item.Album, null, 100));
        }
        if (lyrics.Lines.Count == 0) throw new WorkflowException(422, "empty_import", "This file contains no sung lyric lines.");
        lyrics.Hash = Codec.ContentHash(lyrics); lyrics.Manual = true;
        discovery.Invalidate(item.Id); repository.ApplySelection(item.Id, new(lyrics, null), input.ExistingLocal ? null : new(input.Text, RawResponse: input.Text));
    }
}
