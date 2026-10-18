using LyricBridge;
using Xunit;

public sealed class CompositionTests
{
    private static (RichLyrics Original, RichLyrics Donor) Lyrics() => (
        new RichLyrics { Lines = [new() { Id = "a", Text = "Hello!", Start = 0 }, new() { Id = "b", Text = "World", Start = 10000000 }] },
        new RichLyrics { Lines = [new() { Id = "x", Text = "hello", Start = 0, Translations = new() { { "zh", "你好" } } }, new() { Id = "y", Text = "World", Start = 10000000, Translations = new() { { "zh", "世界" } } }] }
    );

    [Fact]
    public void SuggestMatchesNormalizedTextInSourceOrder()
    {
        var (original, donor) = Lyrics();
        var mapping = LyricComposition.Suggest(original, donor);
        Assert.Equal("x", mapping["a"]);
        Assert.Equal("y", mapping["b"]);
    }

    [Fact]
    public void MixUsesUniqueLanguageFamilyAndPreservesTiming()
    {
        var (original, donor) = Lyrics();
        var mapping = LyricComposition.Suggest(original, donor);
        var mixed = LyricComposition.Mix(original, donor, new("a", "b", "translation", "zh-Hans", mapping));
        Assert.Equal("你好", mixed["a"]);
        Assert.Equal("世界", mixed["b"]);
        Assert.Equal(10000000L, original.Lines[1].Start);
    }

    [Fact]
    public void MixRejectsReorderedDonorRows()
    {
        var (original, donor) = Lyrics();
        var mapping = new Dictionary<string, string> { { "a", "y" }, { "b", "x" } };
        Assert.Throws<ArgumentException>(() => LyricComposition.Mix(original, donor, new("a", "b", "translation", "zh", mapping)));
    }

    [Fact]
    public void SuggestLeavesAmbiguousRowsForManualMapping()
    {
        var (original, donor) = Lyrics();
        donor.Lines.Add(new() { Id = "z", Text = "hello", Start = 0 });
        Assert.DoesNotContain("a", LyricComposition.Suggest(original, donor).Keys);
    }

    [Fact]
    public void SuggestUsesTimingToDisambiguateRepeatedWords()
    {
        var (original, donor) = Lyrics();
        donor.Lines.Add(new() { Id = "z", Text = "Ｈｅｌｌｏ", Start = 90000000 });
        Assert.Equal("x", LyricComposition.Suggest(original, donor)["a"]);
    }
}
