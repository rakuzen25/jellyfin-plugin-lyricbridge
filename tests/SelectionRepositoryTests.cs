using LyricBridge;
using Microsoft.Data.Sqlite;
using Xunit;

public sealed class SelectionRepositoryTests
{
    [Fact]
    public void SuppliedVariantReferencesFollowAtomicSelectionAndDeletion()
    {
        var directory = Path.Combine(Path.GetTempPath(), "lyricbridge-variants-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new Store(directory); var now = DateTimeOffset.UtcNow;
            var donor = new RichLyrics { Source = "fixture", ProviderId = "donor", Lines = [new() { Id = "line", Text = "donor" }] };
            donor.Hash = Codec.ContentHash(donor);
            var target = new RichLyrics { Source = "fixture", Lines = [new() { Id = "line", Text = "original" }] };
            store.Save(Guid.NewGuid(), target);
            var variant = new Variant("supplied", target.Hash, "translation", "en", "fixture", "", new() { ["line"] = "translation" }, Origin: new("fixture", "donor", donor.Hash));
            var origin = new MixedOrigin(donor.Hash);
            Assert.False(store.SaveSuppliedVariant(variant, origin, "choice"));
            Assert.Null(store.Get<Variant>("variant", variant.Key));
            store.CachePreview(new(new("fixture", "donor", "title", "artist", "", null, 100), donor, new("donor")), now.AddDays(-2));
            Assert.True(store.SaveSuppliedVariant(variant, origin, "choice"));
            store.ExpireTransientData(now);
            Assert.NotNull(store.Get<RichLyrics>("document", donor.Hash));
            Assert.False(store.SelectAuxiliary("wrong", "another-track", "translation", "en", variant.Key));
            Assert.True(store.DeleteVariant(variant.Key, variant.Hash, variant.Kind));
            Assert.Null(store.Get<AuxiliarySelection>("auxiliary-choice", "choice"));
            Assert.Null(store.Get<MixedOrigin>("mixed-origin", variant.Key));
            Assert.False(store.SelectAuxiliary("choice", variant.Hash, variant.Kind, "en", variant.Key));
            store.ExpireTransientData(now);
            Assert.Null(store.Get<RichLyrics>("document", donor.Hash));
        }
        finally { SqliteConnection.ClearAllPools(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }

    [Fact]
    public void SelectionsClearClassificationAndTransactionsRollBack()
    {
        var directory = Path.Combine(Path.GetTempPath(), "lyricbridge-selection-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new Store(directory); var item = Guid.NewGuid(); var id = item.ToString("N");
            var lyrics = new RichLyrics { Source = "fixture", Lines = [new() { Id = "line", Text = "original" }] };
            store.ApplySelection(item, new(lyrics, null), new("original"));
            store.ApplySelection(item, new(null, null, new MatchRejection()));
            store.SelectOriginal(item, Codec.ContentHash(lyrics));
            Assert.Equal("original", store.Selection(item).Lyrics!.Lines[0].Text);
            Assert.Null(store.Selection(item).Rejected);
            store.ApplySelection(item, new(null, null, new MatchRejection()));
            Assert.NotNull(store.Selection(item).Rejected); Assert.Null(store.Selection(item).Lyrics);
            using (var connection = new SqliteConnection("Data Source=" + Path.Combine(directory, "index.sqlite")))
            {
                connection.Open(); using var command = connection.CreateCommand();
                command.CommandText = "CREATE TRIGGER fail_selection BEFORE INSERT ON records WHEN NEW.kind='selected' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;";
                command.ExecuteNonQuery();
            }
            var before = Codec.Serialize(store.Selection(item));
            Assert.Throws<SqliteException>(() => store.ApplySelection(item, new(lyrics, null)));
            Assert.NotNull(store.Selection(item).Rejected);
            Assert.Equal(before, Codec.Serialize(store.Selection(item)));
            Assert.Empty(store.All<VersionSnapshot>("previous"));
        }
        finally { SqliteConnection.ClearAllPools(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
