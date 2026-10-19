using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Lyrics;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Tasks;
namespace LyricBridge;

public sealed class MissingLyricsTask(ILibraryManager library, ILyricManager local, Retrieval retrieval, Discovery discovery, Lazy<Plugin> plugin) : IScheduledTask
{
    public string Name => "LyricBridge: retrieve missing lyrics";
    public string Key => "LyricBridgeMissing";
    public string Description => "Retrieve existing provider lyrics into separate plugin storage. Disabled until enabled in LyricBridge settings.";
    public string Category => "Library";
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => [new() { Type = TaskTriggerInfoType.IntervalTrigger, IntervalTicks = TimeSpan.FromDays(1).Ticks }];
    public async Task ExecuteAsync(IProgress<double> progress, CancellationToken token)
    {
        if (plugin.Value.Startup.State != "ready") { progress.Report(100); return; }
        if (!plugin.Value.Configuration.ScheduledRetrieval) { progress.Report(100); return; }
        int start = 0;
        while (true)
        {
            var items = library.GetItemList(new InternalItemsQuery { IncludeItemTypes = [BaseItemKind.Audio], Recursive = true, StartIndex = start, Limit = 100 });
            if (items.Count == 0) break;
            foreach (var audio in items.OfType<Audio>())
            {
                token.ThrowIfCancellationRequested();
                if (retrieval.Selected(audio.Id) != null) continue;
                var lyrics = await local.GetLyricsAsync(audio, token); if (lyrics?.Lyrics?.Count > 0) continue;
                var outcome = discovery.Start(audio.Id, JellyfinTrack.From(audio)); while (!outcome.Complete) { await Task.Delay(250, token); outcome = discovery.Status(audio.Id); }
            }
            start += items.Count; progress.Report(Math.Min(99, start / 100.0));
        }
        progress.Report(100);
    }
}
