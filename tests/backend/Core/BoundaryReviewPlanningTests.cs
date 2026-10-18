using System.Net;
using System.Text;
using System.Text.Json;
using LyricBridge;
using Xunit;

public sealed class BoundaryReviewPlanningTests
{
    private static readonly GenerationProfile Profile = new("AI", "fixture", "model", "boundary-review", "", "ja", "", 0, 0, 3);
    private static Transcript Source(int count = 60)
    {
        var tokens = Enumerable.Range(0, count).Select(i => new TimedToken("t" + i, i % 10 == 9 ? "ね。" : "あ", "", i + i / 10, i + i / 10 + (i % 10 == 9 ? 2 : 1), i * 10_000_000L, i * 10_000_000L + 2_000_000)).ToList();
        return new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid().ToString("N"), TranscriptBoundaries.CanonicalText(tokens), "", "ja", "word", tokens, [], Profile, [], DateTimeOffset.UtcNow);
    }
    private static BoundaryVersion Version(Transcript source) => TranscriptBoundaries.Version(source, "local", new(), source.Tokens.Where((_, i) => i % 10 == 9 || i == source.Tokens.Count - 1).Select(t => t.Id).ToList(), "test");
    [Fact]
    public void WholeSongFitsOneCompactRequestAndPlanIsStable()
    {
        var source = Source(300); var version = Version(source); var config = new ServiceConfig { Model = "fixture" };
        var plan = BoundaryReviewPlanning.Create(source, version, config);
        Assert.Single(plan.Batches); Assert.Equal(source.Tokens.Count, plan.Batches[0].Last);
        Assert.Equal(plan, BoundaryReviewPlanning.Create(source, version, config) with { Batches = plan.Batches });
        var wire = JsonSerializer.Serialize(BoundaryReviewPlanning.Request(source, version, config, plan.Batches[0]), BoundaryReviewPlanning.WireJson);
        Assert.DoesNotContain("ownedTokenIds", wire); Assert.DoesNotContain("endPosition", wire); Assert.DoesNotContain("max_tokens", wire); Assert.DoesNotContain("max_completion_tokens", wire);
        config.ModelContextWindow *= 2; Assert.NotEqual(plan.Identity, BoundaryReviewPlanning.Create(source, version, config).Identity);
    }
    [Fact]
    public void BatchesCoverEveryTokenAndFitBudgetWithNaturalSeams()
    {
        var source = Source(600); var version = Version(source); var config = new ServiceConfig { Model = "fixture", ModelContextWindow = 8192 };
        var plan = BoundaryReviewPlanning.Create(source, version, config);
        Assert.True(plan.RequestCount > 1);
        Assert.Equal(Enumerable.Range(0, 600), plan.Batches.SelectMany(b => Enumerable.Range(b.First, b.Last - b.First)));
        foreach (var batch in plan.Batches)
        {
            Assert.True(batch.EstimatedInputTokens <= (int)(8192 * .8) - 2048);
            Assert.True(batch.ContextFirst <= batch.First && batch.ContextLast >= batch.Last);
            if (batch.Last < 600) { Assert.EndsWith("。", source.Tokens[batch.Last - 1].Text); Assert.False(batch.WeakSeam); }
        }
    }
    [Fact]
    public void IndivisibleOversizeTextIsRejectedWithoutTruncation()
    {
        var source = Source(1); var token = source.Tokens[0] with { Text = new string('あ', 40000), EndPosition = 40000 };
        source = source with { Tokens = [token], Text = token.Text };
        var error = Assert.Throws<WorkflowException>(() => BoundaryReviewPlanning.Create(source, Version(source), new()));
        Assert.Equal("review_input_too_large", error.Code); Assert.Equal(40000, source.Tokens[0].Text.Length);
    }
}
