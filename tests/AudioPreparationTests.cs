using System.Reflection;
using LyricBridge;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.MediaEncoding;
using Xunit;

public sealed class AudioPreparationTests : TestHost
{
    private AudioPreparation Create(Store store, string script)
    {
        var encoder = DispatchProxy.Create<IMediaEncoder, EncoderProxy>(); ((EncoderProxy)(object)encoder).Path = script;
        return new(store, () => DispatchProxy.Create<ILibraryManager, EncoderProxy>(), () => encoder);
    }
    private string Script(string body)
    {
        var path = Path.Combine(Root, "ffmpeg-fixture"); File.WriteAllText(path, "#!/bin/sh\n" + body);
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Audio process fixtures target the supported Linux host.");
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute); return path;
    }
    [Fact]
    public async Task UploadOwnershipLimitsAndPreparationUseOnlyOpaqueIds()
    {
        var token = TestContext.Current.CancellationToken;
        using var store = Own(new Store(Root));
        var audio = Create(store, Script("for last do :; done\nprintf 'prepared' > \"$last\"\nprintf 'out_time_us=1200000\\n'\n"));
        var item = Guid.NewGuid(); var user = Guid.NewGuid();
        await using var stream = new MemoryStream([1, 2, 3]); var upload = await audio.Upload(item, user, stream, 10, token);
        Assert.Throws<WorkflowException>(() => audio.CheckUpload(upload.Id, item, Guid.NewGuid()));
        Assert.Throws<WorkflowException>(() => audio.CheckUpload("../input", item, user));
        await using var tooLarge = new MemoryStream([1, 2, 3]);
        await Assert.ThrowsAsync<WorkflowException>(() => audio.Upload(item, user, tooLarge, 2, token));
        var job = new Job { UserId = user, ItemId = item, Audio = new("upload", upload.Id), TaskKind = "transcription" };
        var prepared = await audio.Prepare(job, new(), new Progress<int>(), token);
        Assert.Equal(12_000_000, prepared.DurationTicks); Assert.Equal("prepared", await File.ReadAllTextAsync(prepared.Path, token));
        audio.Release(job); Assert.False(File.Exists(prepared.Path)); Assert.Throws<WorkflowException>(() => audio.CheckUpload(upload.Id, item, user));
    }
    [Fact]
    public async Task ReleasePreservesForeignAndSharedUploadInputs()
    {
        var token = TestContext.Current.CancellationToken;
        using var store = Own(new Store(Root)); var audio = Create(store, "unused");
        var item = Guid.NewGuid(); var user = Guid.NewGuid();
        await using var stream = new MemoryStream([1]);
        var upload = await audio.Upload(item, user, stream, 10, token);
        audio.Release(new Job { ItemId = item, UserId = Guid.NewGuid(), Audio = new("track", upload.Id) });
        audio.CheckUpload(upload.Id, item, user);
        Assert.Throws<WorkflowException>(() => audio.Release(new Job { ItemId = item, UserId = Guid.NewGuid(), Audio = new("upload", upload.Id) }));
        var pending = new Job { ItemId = item, UserId = user, State = "pending", TaskKind = "transcription", Audio = new("upload", upload.Id) };
        Assert.True(store.PersistRequest(pending, store.Epoch));
        audio.Release(new Job { ItemId = item, UserId = user, Audio = new("upload", upload.Id) });
        audio.CheckUpload(upload.Id, item, user);
    }
    [Fact]
    public async Task CancellationKillsTheOwnedProcessAndReleasesPreparation()
    {
        var token = TestContext.Current.CancellationToken;
        using var store = Own(new Store(Root));
        var marker = Path.Combine(Root, "entered");
        var audio = Create(store, Script("touch '" + marker + "'\nsleep 30\n"));
        var item = Guid.NewGuid(); var user = Guid.NewGuid(); await using var stream = new MemoryStream([1]);
        var upload = await audio.Upload(item, user, stream, 10, token);
        var job = new Job { ItemId = item, UserId = user, Audio = new("upload", upload.Id) };
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(token);
        var pending = audio.Prepare(job, new(), new Progress<int>(), stop.Token);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token); deadline.CancelAfter(TimeSpan.FromSeconds(5));
        while (!File.Exists(marker)) await Task.Delay(10, deadline.Token);
        stop.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending.WaitAsync(TimeSpan.FromSeconds(5), token));
        audio.Release(job);
    }
    [Fact]
    public async Task CleanupRetainsActiveUploadsAndExpiresUnclaimedAudio()
    {
        var token = TestContext.Current.CancellationToken;
        using var store = Own(new Store(Root)); var audio = Create(store, "unused");
        var item = Guid.NewGuid(); var user = Guid.NewGuid();
        await using var a = new MemoryStream([1]); await using var b = new MemoryStream([2]);
        var live = await audio.Upload(item, user, a, 10, token); var orphan = await audio.Upload(item, user, b, 10, token);
        var job = new Job { ItemId = item, UserId = user, TaskKind = "transcription", State = "pending", Audio = new("upload", live.Id) };
        Assert.True(store.PersistRequest(job, store.Epoch));
        foreach (var dir in Directory.GetDirectories(Path.Combine(Root, "audio-staging"))) Directory.SetLastWriteTimeUtc(dir, DateTime.UtcNow.AddDays(-8));
        audio.Cleanup(); audio.CheckUpload(live.Id, item, user); Assert.Throws<WorkflowException>(() => audio.CheckUpload(orphan.Id, item, user));
        audio.Clear(); Assert.False(Directory.Exists(Path.Combine(Root, "audio-staging")));
    }
    public class EncoderProxy : DispatchProxy
    {
        public string Path = "";
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => targetMethod?.Name == "get_EncoderPath" ? Path : null;
    }
}
