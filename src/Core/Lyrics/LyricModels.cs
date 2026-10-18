using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace LyricBridge;

public sealed record Cue(int Position, int EndPosition, long Start, long? End);

public sealed class LyricLine
{
    public string Id { get; set; } = "";
    public string Text { get; set; } = "";
    public long? Start { get; set; }
    public long? End { get; set; }
    public string Language { get; set; } = "und";
    public string Alignment { get; set; } = "Unspecified";
    public List<Cue> Cues { get; set; } = [];
    public Dictionary<string, string> Translations { get; set; } = [];
    public string? Pronunciation { get; set; }
    public LyricLine? Background { get; set; }
}

public sealed class RichLyrics
{
    public string Hash { get; set; } = "";
    public string Source { get; set; } = "";
    public string ProviderId { get; set; } = "";
    public string Title { get; set; } = "";
    public string Artist { get; set; } = "";
    public string Language { get; set; } = "und";
    public List<LyricLine> Lines { get; set; } = [];
    public bool WordTimed => Lines.Any(l => l.Cues.Count > 0);
    public bool Manual { get; set; }
}
