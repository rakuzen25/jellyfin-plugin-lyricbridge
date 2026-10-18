namespace LyricBridge;

public sealed record SavedOriginal(Guid ItemId, string Hash, string Source, string ProviderId, string Title, string Artist, bool WordTimed, DateTimeOffset SavedAt, SelectionAssessment? Assessment, long Revision, bool AutoSaved = false);
public sealed record OriginalDeletion(bool SharedContentRetained, IReadOnlyList<string> CancelledJobs, long Revision, IReadOnlyList<string> DeletedHashes);
public sealed record StoreAdmission(long Epoch, long Revision, Guid? ItemId = null);
