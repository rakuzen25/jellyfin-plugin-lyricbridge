namespace LyricBridge;

public sealed class ManagedLibraryMaintenance(Store store, Discovery discovery, Generation generation, LocalPronunciation local, Retrieval retrieval, IAudioPreparation? audio = null)
{
    public OriginalDeletion DeleteOriginal(Guid item, string hash, long? expectedRevision = null)
    {
        var result = store.DeleteOriginal(item, hash, expectedRevision);
        using var operation = store.Operation(store.FreshAdmission(item));
        discovery.InvalidateDeleted(item, result.Revision);
        generation.CancelDeleted(result.CancelledJobs);
        foreach (var deletedHash in result.DeletedHashes) local.InvalidateDeleted(deletedHash);
        retrieval.ClearMissingCache();
        return result;
    }
    public async Task<int?> Reset()
    {
        if (!store.BeginReset()) return null;
        try
        {
            await discovery.StopAll();
            await generation.StopAll();
            await local.StopAll();
            audio?.Clear();
            var deleted = store.ResetManagedLibrary();
            retrieval.ClearMissingCache();
            return deleted;
        }
        finally { store.EndReset(); }
    }
}
