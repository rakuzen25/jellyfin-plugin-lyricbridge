using LyricBridge;
using Xunit;

public sealed class LyricRowsTests
{
    [Fact]
    public void AllKeepsBackgroundRowsBesideTheirLeadInSourceOrder()
    {
        var background = new LyricLine { Id = "backing", Text = "Echo" };
        var lead = new LyricLine { Id = "lead", Text = "Hello", Background = background };
        var next = new LyricLine { Id = "next", Text = "World" };
        var lyrics = new RichLyrics { Lines = [lead, next] };

        Assert.Equal(new[] { lead, background, next }, LyricRows.All(lyrics));
        Assert.Equal(new[] { lead, next }, lyrics.Lines);
        Assert.Empty(LyricRows.All(new RichLyrics()));
    }

    [Fact]
    public void GeneratedRowsMayArriveInADifferentOrder()
    {
        LyricRows.ValidateGenerated(["lead", "backing"], new() { ["backing"] = "Echo", ["lead"] = "Hello" });
        LyricRows.ValidateGenerated([], new());
    }

    [Theory]
    [InlineData("lead")]
    [InlineData("lead", "unknown")]
    [InlineData("lead", "backing", "extra")]
    public void GeneratedRowsRejectMissingReplacedOrExtraIdentities(params string[] received)
    {
        Assert.Throws<InvalidDataException>(() => LyricRows.ValidateGenerated(
            ["lead", "backing"], received.ToDictionary(id => id, _ => "Translated")));
    }
}
