using System.Text.RegularExpressions;
using Jellyfin.Api.Extensions;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Lyrics;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
namespace LyricBridge;

public sealed class NativeCache : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (context, following) =>
        {
            using var operation = context.RequestServices.GetRequiredService<Store>().Operation();
            var match = Regex.Match(context.Request.Path.Value ?? "", @"/Audio/([a-fA-F0-9-]+)/Lyrics$", RegexOptions.IgnoreCase);
            if (context.Request.Method != "GET" || !match.Success || !Guid.TryParse(match.Groups[1].Value, out var id)) { await following(); return; }
            var output = context.Response.Body; await using var buffered = new MemoryStream(); context.Response.Body = buffered;
            try
            {
                await following();
                if (context.User.Identity?.IsAuthenticated == true)
                {
                    var retrieval = context.RequestServices.GetRequiredService<Retrieval>(); var selected = retrieval.Selected(id); var mark = context.RequestServices.GetRequiredService<Store>().Get<InstrumentalEvidence>("instrumental", id.ToString("N")); var instrumental = mark != null && (mark.Manual || mark.Expires > DateTime.UtcNow);
                    if (context.Response.StatusCode is 404 or 204 || selected?.Manual == true || instrumental)
                    {
                        var item = context.RequestServices.GetRequiredService<LibraryAccess>().FindAudio(id, context.User);
                        if (item != null)
                        {
                            if (instrumental && !mark!.Manual)
                            {
                                // Read the typed model: buffered HTTP bytes may already be compressed.
                                var local = await context.RequestServices.GetRequiredService<ILyricManager>().GetLyricsAsync(item, context.RequestAborted);
                                if (local?.Lyrics is { Count: > 0 } localLines && !(localLines.Count == 1 && Lyricify.Lyrics.Helpers.InstrumentalHelper.IsInstrumental(localLines[0].Text)))
                                {
                                    instrumental = false;
                                    selected = context.Response.StatusCode == 200 ? null : new RichLyrics { Source = "Local", Title = item.Name, Artist = string.Join(", ", item.Artists), Lines = localLines.Select((l, i) => new LyricLine { Id = $"l{i}", Text = l.Text, Start = l.Start, Cues = l.Cues?.Select(c => new Cue(c.Position, c.EndPosition, c.Start, c.End)).ToList() ?? [] }).ToList() };
                                }
                            }
                            if (instrumental) { context.Response.StatusCode = 404; context.Response.ContentType = "application/json"; context.Response.ContentLength = null; context.Response.Headers.Remove("Content-Encoding"); context.Response.Headers.Remove("ETag"); buffered.SetLength(0); await buffered.WriteAsync("{}"u8.ToArray(), context.RequestAborted); }
                            var lyrics = instrumental ? null : selected;
                            if (lyrics != null)
                            {
                                context.Response.StatusCode = 200; context.Response.ContentType = "application/json"; context.Response.ContentLength = null; buffered.SetLength(0);
                                context.Response.Headers.Remove("Content-Encoding"); context.Response.Headers.Remove("ETag");
                                await System.Text.Json.JsonSerializer.SerializeAsync(buffered, new { Metadata = new { Title = lyrics.Title, Artist = lyrics.Artist, IsSynced = lyrics.Lines.Any(l => l.Start != null) }, Lyrics = lyrics.Lines.Select(l => new { l.Text, l.Start, l.End, Cues = l.Cues.Select(c => new { c.Position, c.EndPosition, c.Start, c.End }) }) }, cancellationToken: context.RequestAborted);
                            }
                        }
                    }
                }
                buffered.Position = 0; await buffered.CopyToAsync(output, context.RequestAborted);
            }
            finally { context.Response.Body = output; }
        }); next(app);
    };
}
