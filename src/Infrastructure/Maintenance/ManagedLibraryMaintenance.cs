namespace LyricBridge;

public sealed class ManagedLibraryMaintenance(Store store, Discovery discovery, Generation generation, LocalPronunciation local, Retrieval retrieval, IAudioPreparation? audio = null)
{
    public OriginalDeletion DeleteOriginal(Guid item, string hash, long? expectedRevision = null)
    {
        var result = store.DeleteOriginal(item, hash, expectedRevision);
        NotifyOriginalDeletion(item, result);
        return result;
    }
    public void NotifyOriginalDeletion(Guid item, OriginalDeletion result)
    {
        using var operation = store.Operation(store.FreshAdmission(item));
        discovery.InvalidateDeleted(item, result.Revision);
        generation.CancelDeleted(result.CancelledJobs);
        foreach (var deletedHash in result.DeletedHashes) local.InvalidateDeleted(deletedHash);
        retrieval.ClearMissingCache();
    }
    public async Task<int?> Reset()
    {
        if (!store.BeginReset()) return null;
        try
        {
            await discovery.StopAll();
            await generation.StopAll();
            await local.StopAll();
            if (audio != null) { await audio.StopUploads(); audio.Clear(); }
            var deleted = store.ResetManagedLibrary();
            retrieval.ClearMissingCache();
            return deleted;
        }
        finally { store.EndReset(); }
    }
}
