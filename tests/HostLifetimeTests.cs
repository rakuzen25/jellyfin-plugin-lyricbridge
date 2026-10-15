using LyricBridge;
using Xunit;

public sealed class HostLifetimeTests
{
    [Fact]
    public void DisposingAnUnusedStoreDoesNotInitializeStorage()
    {
        var initialized = false;
        using var store = new Store(() => { initialized = true; throw new InvalidOperationException("Storage must remain unopened"); });
        store.Dispose();
        store.Dispose();
        Assert.False(initialized);
        Assert.Throws<ObjectDisposedException>(() => store.Get<Preferences>("preferences", "fixture"));
    }

    [Fact]
    public async Task HostsKeepConfigurationAndStorageIndependentWhileOverlapping()
    {
        await using var first = new TestHost();
        await using var second = new TestHost();
        var firstStore = first.Own(new Store(Path.Combine(first.Root, "data")));
        var secondStore = second.Own(new Store(Path.Combine(second.Root, "data")));
        first.Plugin.UpdateConfiguration(new Configuration { ScheduledRetrieval = true, UserRequestDailyQuota = 7 });
        second.Plugin.UpdateConfiguration(new Configuration { UserRequestDailyQuota = 2 });
        await Task.WhenAll(
            Task.Run(() => { firstStore.Put("preferences", "same", new Preferences { TranslationLanguage = "ar" }); Assert.Equal(7, first.Policy().UserRequestDailyQuota); }, TestContext.Current.CancellationToken),
            Task.Run(() => { secondStore.Put("preferences", "same", new Preferences { TranslationLanguage = "ja" }); Assert.Equal(2, second.Policy().UserRequestDailyQuota); }, TestContext.Current.CancellationToken));
        Assert.Equal("ar", firstStore.Get<Preferences>("preferences", "same")?.TranslationLanguage);
        Assert.Equal("ja", secondStore.Get<Preferences>("preferences", "same")?.TranslationLanguage);
        await first.DisposeAsync();
        secondStore.Put("preferences", "after-dispose", new Preferences());
        Assert.NotNull(secondStore.Get<Preferences>("preferences", "after-dispose"));
        Assert.Throws<ObjectDisposedException>(() => firstStore.Get<Preferences>("preferences", "same"));
    }

    [Fact]
    public async Task GenerationDetachesFromTheSameConfigurationOwnerOnDisposal()
    {
        await using var host = new TestHost();
        var store = host.Own(new Store(Path.Combine(host.Root, "data")));
        var languages = host.Own(new LanguageServices(() => host.Plugin.Configuration.Services));
        using var generation = new Generation(host.Policy, store, languages);
        var subscriptions = 0;
        generation.ObserveConfiguration(
            handler => { host.Plugin.ConfigurationUpdated += handler; subscriptions++; },
            handler => { host.Plugin.ConfigurationUpdated -= handler; subscriptions--; });
        Assert.Equal(1, subscriptions);
        generation.Dispose();
        Assert.Equal(0, subscriptions);
        host.Plugin.UpdateConfiguration(new Configuration());
    }
}
