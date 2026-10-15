namespace LyricBridge;

/// <summary>Serializes work for a key and releases idle keys, including cancelled waiters.</summary>
public sealed class KeyedAsyncLock<TKey> where TKey : notnull
{
    private readonly object gate = new();
    private readonly Dictionary<TKey, Entry> entries = new();
    public int ActiveKeyCount { get { lock (gate) return entries.Count; } }

    public async Task<IDisposable> Acquire(TKey key, CancellationToken token = default)
    {
        Entry entry;
        lock (gate)
        {
            if (!entries.TryGetValue(key, out entry!)) entries.Add(key, entry = new Entry());
            entry.Users++;
        }
        try
        {
            await entry.Semaphore.WaitAsync(token);
            return new Lease(this, key, entry);
        }
        catch
        {
            Release(key, entry, acquired: false);
            throw;
        }
    }

    private void Release(TKey key, Entry entry, bool acquired)
    {
        lock (gate)
        {
            if (acquired) entry.Semaphore.Release();
            if (--entry.Users != 0) return;
            entries.Remove(key);
            entry.Semaphore.Dispose();
        }
    }

    private sealed class Entry
    {
        public readonly SemaphoreSlim Semaphore = new(1, 1);
        public int Users;
    }

    private sealed class Lease(KeyedAsyncLock<TKey> owner, TKey key, Entry entry) : IDisposable
    {
        private KeyedAsyncLock<TKey>? remaining = owner;
        public void Dispose() => Interlocked.Exchange(ref remaining, null)?.Release(key, entry, acquired: true);
    }
}
