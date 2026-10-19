using System.Xml.Linq;
using LyricBridge;
using Microsoft.Data.Sqlite;
using Xunit;

public sealed class StateUpgradesTests : StorageFixture
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private string Journal => Path.Combine(Root, "upgrades");
    private string Settings => Path.Combine(Root, "settings.xml");
    private void WriteSettings(int version) { Directory.CreateDirectory(Root); new XDocument(new XElement("Configuration", new XElement("SchemaVersion", version), new XElement("Secret", "private"))).Save(Settings); }
    private static void ValidateSettings(XDocument document) { if (document.Root?.Element("Secret")?.Value != "private") throw new InvalidDataException("Invalid transformed settings."); }
    [Fact]
    public void SettingsUpgradeIsBackedUpExactlyOnceAndNoticeSurvivesRestartAndAcknowledgement()
    {
        WriteSettings(11); var original = File.ReadAllBytes(Settings); var calls = 0;
        var runner = new StateUpgrades(Journal, "test-target", settingsSteps: [new(11, 12, document => { calls++; document.Root!.Add(new XElement("Added", true)); })]);
        new StateUpgrades(Journal, "test-source").Ready(); runner.Settings(Settings, 12, ValidateSettings, () => throw new Exception());
        var record = Assert.Single(runner.Records()); Assert.Equal("complete", record.State); Assert.False(record.Acknowledged); Assert.Equal("test-source", record.SourcePluginVersion);
        Assert.Equal(original, File.ReadAllBytes(record.BackupPath)); Assert.Equal(12, (int)XDocument.Load(Settings).Root!.Element("SchemaVersion")!);
        var restarted = new StateUpgrades(Journal, "test-target"); restarted.Settings(Settings, 12, ValidateSettings, () => throw new Exception());
        Assert.Equal(1, calls); Assert.Single(restarted.Records());
        restarted.Acknowledge(record.Id); Assert.True(new StateUpgrades(Journal, "test-target").Records()[0].Acknowledged);
        if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(record.BackupPath));
    }
    [Fact]
    public void SettingsFailurePreservesOriginalAndUnsupportedInputHasNoConversion()
    {
        WriteSettings(11); var original = File.ReadAllBytes(Settings);
        var runner = new StateUpgrades(Journal, "test", settingsSteps: [new(11, 12, _ => throw new InvalidOperationException("synthetic"))]);
        Assert.Throws<InvalidOperationException>(() => runner.Settings(Settings, 12, ValidateSettings, () => throw new Exception()));
        Assert.Equal(original, File.ReadAllBytes(Settings)); Assert.Equal("failed", Assert.Single(runner.Records()).State);
        Assert.Throws<InvalidDataException>(() => new StateUpgrades(Journal, "test").Settings(Settings, 12, ValidateSettings, () => throw new Exception()));
        Assert.Equal(original, File.ReadAllBytes(Settings));
    }
    [Theory]
    [InlineData(10, 11)]
    [InlineData(12, 12)]
    [InlineData(13, 12)]
    public void RegistryRejectsNonDirectSteps(int from, int to)
    {
        WriteSettings(11);
        var runner = new StateUpgrades(Journal, "test", settingsSteps: [new(from, to, _ => { })]);
        Assert.Throws<InvalidOperationException>(() => runner.Settings(Settings, 12, ValidateSettings, () => { }));
    }
    [Fact]
    public void RegistryRejectsMultiplePredecessorsAndDuplicateSteps()
    {
        WriteSettings(11);
        foreach (var from in new[] { 10, 11 })
        {
            var runner = new StateUpgrades(Journal, "test", settingsSteps: [new(from, 12, _ => { }), new(11, 12, _ => { })]);
            Assert.Throws<InvalidOperationException>(() => runner.Settings(Settings, 12, ValidateSettings, () => { }));
        }
    }
    [Fact]
    public void InterruptedCompletionIsRecoveredFromCommittedSchema()
    {
        WriteSettings(11); var runner = new StateUpgrades(Journal, "test", settingsSteps: [new(11, 12, _ => { })]);
        runner.Settings(Settings, 12, ValidateSettings, () => { });
        var path = Path.Combine(Journal, "journal.json"); var journal = Codec.Deserialize<UpgradeJournal>(File.ReadAllText(path))!;
        journal.Records[0].State = "running"; journal.Records[0].Completed = null; File.WriteAllText(path, Codec.Serialize(journal));
        var restarted = new StateUpgrades(Journal, "test"); restarted.Settings(Settings, 12, ValidateSettings, () => { });
        var recovered = Assert.Single(restarted.Records()); Assert.Equal("complete", recovered.State); Assert.NotNull(recovered.Completed);
    }
    [Fact]
    public void BackupDeletionRequiresCurrentPreviewAndExpiryRetainsSummary()
    {
        WriteSettings(11); var clock = new Clock();
        var runner = new StateUpgrades(Journal, "test", clock, [new(11, 12, _ => { })]);
        runner.Settings(Settings, 12, ValidateSettings, () => { }); var record = Assert.Single(runner.Records());
        Assert.Throws<InvalidOperationException>(() => runner.Delete(record.Id, "unpreviewed"));
        var preview = runner.PreviewDelete(record.Id); File.AppendAllText(record.BackupPath, " ");
        Assert.Throws<InvalidOperationException>(() => runner.Delete(record.Id, preview.Token));
        preview = runner.PreviewDelete(record.Id); runner.Delete(record.Id, preview.Token);
        Assert.False(File.Exists(record.BackupPath)); Assert.Equal("deleted", runner.Records()[0].BackupState);
        WriteSettings(11); runner.Settings(Settings, 12, ValidateSettings, () => { });
        clock.Now = clock.Now.AddDays(31); runner.Expire();
        Assert.Equal("expired", runner.Records()[1].BackupState); Assert.Equal("complete", runner.Records()[1].State);
        runner.Clear(); Assert.Empty(runner.Records());
    }
    [Fact]
    public void ExpiryRetriesFailuresAndReconcilesInterruptedCompletionWhileBlocked()
    {
        WriteSettings(11); var clock = new Clock();
        var runner = new StateUpgrades(Journal, "test", clock, [new(11, 12, _ => { })]);
        runner.Settings(Settings, 12, ValidateSettings, () => { });
        var record = Assert.Single(runner.Records()); var bytes = File.ReadAllBytes(record.BackupPath);
        clock.Now = clock.Now.AddDays(31);
        File.Delete(record.BackupPath); Directory.CreateDirectory(record.BackupPath);
        Assert.True(Record.Exception(() => runner.Expire()) is IOException or UnauthorizedAccessException); Assert.Equal("available", runner.Records()[0].BackupState);
        Directory.Delete(record.BackupPath); File.WriteAllBytes(record.BackupPath, bytes);
        var journalPath = Path.Combine(Journal, "journal.json"); var journal = Codec.Deserialize<UpgradeJournal>(File.ReadAllText(journalPath))!;
        journal.Records[0].State = "running"; journal.Records[0].Completed = null; File.WriteAllText(journalPath, Codec.Serialize(journal));
        runner.Expire(); Assert.Equal("complete", runner.Records()[0].State); Assert.Equal("expired", runner.Records()[0].BackupState);
    }
    [Fact]
    public void CommittedSettingsAreNotRepeatedWhenDatabaseUpgradeFails()
    {
        WriteSettings(11); using var database = Database(); var calls = 0;
        var runner = new StateUpgrades(Journal, "test", settingsSteps: [new(11, 12, _ => calls++)], databaseSteps: [new(11, 12, (_, _) => throw new InvalidOperationException("synthetic"))]);
        runner.Settings(Settings, 12, ValidateSettings, () => { });
        Assert.Throws<InvalidOperationException>(() => runner.Database(database, 12, ValidateDatabase));
        var restarted = new StateUpgrades(Journal, "test", databaseSteps: [new(11, 12, (_, _) => { })]);
        restarted.Settings(Settings, 12, ValidateSettings, () => { }); restarted.Database(database, 12, ValidateDatabase);
        Assert.Equal(1, calls); Assert.Equal(3, restarted.Records().Count);
    }
    private SqliteConnection Database()
    {
        Directory.CreateDirectory(Root); var connection = new SqliteConnection("Data Source=" + Path.Combine(Root, "data.sqlite")); connection.Open();
        using var command = connection.CreateCommand(); command.CommandText = "PRAGMA journal_mode=WAL; PRAGMA user_version=11; CREATE TABLE data(value TEXT); INSERT INTO data VALUES('preserved');"; command.ExecuteNonQuery(); return connection;
    }
    private static void ValidateDatabase(SqliteConnection connection, SqliteTransaction tx)
    {
        using var command = connection.CreateCommand(); command.Transaction = tx; command.CommandText = "SELECT value FROM data"; Assert.Equal("preserved", command.ExecuteScalar());
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void DatabaseBackupIncludesWalAndConversionCommitsOrRollsBackTogether(bool fail)
    {
        using var connection = Database();
        var runner = new StateUpgrades(Journal, "test", databaseSteps: [new(11, 12, (db, tx) =>
        {
            using var command = db.CreateCommand(); command.Transaction = tx; command.CommandText = "ALTER TABLE data ADD COLUMN added TEXT"; command.ExecuteNonQuery();
            if (fail) throw new InvalidOperationException("synthetic");
        })]);
        if (fail) Assert.Throws<InvalidOperationException>(() => runner.Database(connection, 12, ValidateDatabase));
        else runner.Database(connection, 12, ValidateDatabase);
        using var check = connection.CreateCommand(); check.CommandText = "PRAGMA user_version"; Assert.Equal(fail ? 11L : 12L, check.ExecuteScalar());
        check.CommandText = "SELECT count(*) FROM pragma_table_info('data')"; Assert.Equal(fail ? 1L : 2L, check.ExecuteScalar());
        var record = Assert.Single(runner.Records());
        using var backup = new SqliteConnection("Data Source=" + record.BackupPath); backup.Open(); using var backupCheck = backup.CreateCommand();
        backupCheck.CommandText = "SELECT value FROM data"; Assert.Equal("preserved", backupCheck.ExecuteScalar());
        backupCheck.CommandText = "PRAGMA user_version"; Assert.Equal(11L, backupCheck.ExecuteScalar());
        if (!fail) { runner.Database(connection, 12, ValidateDatabase); Assert.Single(runner.Records()); }
    }
}
