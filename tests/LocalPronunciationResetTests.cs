using LyricBridge;
using Xunit;

public sealed class LocalPronunciationResetTests
{
    [Fact]
    public async Task RunningConversionCannotRestoreDataAfterReset()
    {
        var directory=Path.Combine(Path.GetTempPath(),"lyricbridge-local-reset-"+Guid.NewGuid().ToString("N"));
        var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var store=new Store(directory);
        using var worker=new LocalPronunciation(store,async (_,_)=>{entered.TrySetResult();await release.Task;return "nihongo";});
        var lyrics=new RichLyrics{Hash="original",Lines=[new(){Id="line",Text="日本語",Language="ja"}]};
        var preferences=new Preferences();
        try
        {
            await worker.StartAsync(CancellationToken.None);
            Assert.Equal("queued",worker.Ensure(lyrics,preferences).State);
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var admittedEpoch=store.Epoch;
            Assert.True(store.BeginReset());store.ResetManagedLibrary();store.EndReset();
            // Deliberately finish after reset has ended, not merely while writes are blocked.
            release.TrySetResult();
            await worker.StopAll().WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Empty(store.All<Variant>("variant"));
            Assert.False(store.SaveLocalVariant(new("late",lyrics.Hash,"pronunciation","ja","Kawazu","fixture",new()),admittedEpoch));
            Assert.Equal("unavailable",worker.Status(lyrics,preferences).State);
            Assert.Equal("queued",worker.Ensure(lyrics,preferences).State);
            for(var attempt=0;attempt<100&&worker.Status(lyrics,preferences).State!="complete";attempt++)await Task.Delay(10);
            Assert.Equal("complete",worker.Status(lyrics,preferences).State);
        }
        finally
        {
            release.TrySetResult();await worker.StopAsync(CancellationToken.None);
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if(Directory.Exists(directory))Directory.Delete(directory,true);
        }
    }
}
