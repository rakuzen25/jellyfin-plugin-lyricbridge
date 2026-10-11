namespace LyricBridge;

public sealed class ManagedLibraryMaintenance(Store store, Discovery discovery, Generation generation, LocalPronunciation local, Retrieval retrieval)
{
    public async Task<int?> Reset()
    {
        if (!store.BeginReset()) return null;
        try
        {
            await discovery.StopAll();
            await generation.StopAll();
            await local.StopAll();
            var deleted = store.ResetManagedLibrary();
            retrieval.ClearMissingCache();
            return deleted;
        }
        finally { store.EndReset(); }
    }
}
