using Lyricify.Lyrics.Models;
using MediaBrowser.Controller.Entities.Audio;
namespace LyricBridge;

public static class JellyfinTrack
{
    public static TrackMultiArtistMetadata From(Audio audio) => new() { Title = audio.Name, Artists = audio.Artists.ToList(), Album = audio.Album, AlbumArtists = audio.AlbumArtists.ToList(), DurationMs = audio.RunTimeTicks is long t ? (int)(t / 10000) : null };
}
