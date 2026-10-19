using System.Text.Json;
using System.Xml.Linq;
using Microsoft.Data.Sqlite;

namespace LyricBridge;

public sealed record SettingsUpgrade(int FromVersion, int ToVersion, Action<XDocument> Apply);
public sealed record DatabaseUpgrade(int FromVersion, int ToVersion, Action<SqliteConnection, SqliteTransaction> Apply);
public sealed class UpgradeRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Domain { get; set; } = "";
    public string SourcePath { get; set; } = "";
    public int FromVersion { get; set; }
    public int ToVersion { get; set; }
    public string SourcePluginVersion { get; set; } = "";
    public string TargetPluginVersion { get; set; } = "";
    public DateTimeOffset Created { get; set; }
    public DateTimeOffset Expires { get; set; }
    public DateTimeOffset? Completed { get; set; }
    public bool Acknowledged { get; set; }
    public string State { get; set; } = "preparing";
    public string BackupState { get; set; } = "pending";
    public string BackupPath { get; set; } = "";
    public long BackupBytes { get; set; }
}
public sealed class UpgradeJournal
{
    public string LastReadyPluginVersion { get; set; } = "";
    public List<UpgradeRecord> Records { get; set; } = [];
}
public sealed record BackupDeletion(string Token, string Id, string Path, long Bytes, DateTimeOffset Expires);

/// <summary>The only boundary permitted to convert persisted state. Production has no registered steps.</summary>
public sealed class StateUpgrades(string directory, string pluginVersion, TimeProvider? timeProvider = null,
    SettingsUpgrade[]? settingsSteps = null, DatabaseUpgrade[]? databaseSteps = null)
{
    private readonly object gate = new();
    private readonly TimeProvider clock = timeProvider ?? TimeProvider.System;
    private readonly Dictionary<string, (string Id, string Stamp, DateTimeOffset Expires)> deletions = [];
    private string JournalPath => Path.Combine(directory, "journal.json");
    private UpgradeJournal Read() => File.Exists(JournalPath)
        ? JsonSerializer.Deserialize<UpgradeJournal>(File.ReadAllBytes(JournalPath), Codec.Json) ?? throw new InvalidDataException("Invalid upgrade journal.") : new();
    private void Save(UpgradeJournal journal) => AtomicWrite(JournalPath, stream => JsonSerializer.Serialize(stream, journal, Codec.Json));
    public static void AtomicWrite(string path, Action<Stream> write)
    {
        var parent = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(parent);
        var temporary = Path.Combine(parent, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var stream = PrivateFile(temporary)) { write(stream); stream.Flush(true); }
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private static FileStream PrivateFile(string path)
    {
        var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None };
        if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        return new(path, options);
    }
    private FileStream Exclusive()
    {
        Directory.CreateDirectory(directory);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        return new FileStream(Path.Combine(directory, ".lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }
    private static void Validate(int current, IEnumerable<(int From, int To)> steps)
    {
        var list = steps.ToList();
        if (list.Count > 1 || list.Any(s => s.From < 1 || s.From >= current || s.To != current))
            throw new InvalidOperationException("An upgrade domain permits one explicit predecessor and one direct step to current.");
    }
    private UpgradeRecord Begin(UpgradeJournal journal, string domain, string path, int from, int to)
    {
        var record = new UpgradeRecord { Domain = domain, SourcePath = Path.GetFullPath(path), FromVersion = from, ToVersion = to,
            SourcePluginVersion = journal.LastReadyPluginVersion, TargetPluginVersion = pluginVersion,
            Created = clock.GetUtcNow(), Expires = clock.GetUtcNow().AddDays(30) };
        record.BackupPath = Path.Combine(Path.GetFullPath(directory), record.Id + (domain == "settings" ? ".xml" : ".sqlite"));
        journal.Records.Add(record); Save(journal); return record;
    }
    private void Recover(UpgradeJournal journal, string domain, string path, int version)
    {
        foreach (var record in journal.Records.Where(r => r.Domain == domain && r.SourcePath == Path.GetFullPath(path) && r.State is "preparing" or "running"))
        {
            record.State = version == record.ToVersion ? "complete" : "failed";
            if (record.State == "complete") record.Completed = clock.GetUtcNow();
            if (File.Exists(record.BackupPath)) { record.BackupState = record.BackupState == "pending" ? "incomplete" : "available"; record.BackupBytes = new FileInfo(record.BackupPath).Length; }
            else record.BackupState = "unavailable";
        }
        Save(journal);
    }
    public void Settings(string path, int current, Action<XDocument> validate, Action create)
    {
        lock (gate)
        {
            using var exclusive = Exclusive();
            var steps = settingsSteps ?? []; Validate(current, steps.Select(s => (s.FromVersion, s.ToVersion)));
            if (!File.Exists(path)) { create(); return; }
            var document = XDocument.Load(path);
            var version = (int?)document.Root?.Element("SchemaVersion") ?? 0;
            var journal = Read(); Recover(journal, "settings", path, version);
            if (version == current) { validate(document); return; }
            var step = steps.SingleOrDefault(s => s.FromVersion == version) ?? throw new InvalidDataException($"Unsupported settings schema {version}; required schema is {current}. Preserve the settings file and use fresh settings or a compatible plugin release.");
            var record = Begin(journal, "settings", path, version, current);
            var committed = false;
            try
            {
                using (var output = PrivateFile(record.BackupPath)) { using var input = File.OpenRead(path); input.CopyTo(output); output.Flush(true); }
                record.BackupBytes = new FileInfo(record.BackupPath).Length; record.BackupState = "available"; record.State = "running"; Save(journal);
                step.Apply(document); document.Root!.SetElementValue("SchemaVersion", current); validate(document);
                AtomicWrite(path, stream => document.Save(stream)); committed = true;
                record.State = "complete"; record.Completed = clock.GetUtcNow(); Save(journal);
            }
            catch { Failed(record, committed); Save(journal); throw; }
        }
    }
    public void Database(SqliteConnection connection, int current, Action<SqliteConnection, SqliteTransaction> validate)
    {
        lock (gate)
        {
            using var exclusive = Exclusive();
            var steps = databaseSteps ?? []; Validate(current, steps.Select(s => (s.FromVersion, s.ToVersion)));
            using var command = connection.CreateCommand(); command.CommandText = "PRAGMA user_version";
            var version = Convert.ToInt32(command.ExecuteScalar());
            command.CommandText = "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
            var empty = Convert.ToInt32(command.ExecuteScalar()) == 0;
            var journal = Read(); Recover(journal, "database", connection.DataSource, version);
            if (version == 0 && empty) return;
            if (version == current) { using var tx = connection.BeginTransaction(); validate(connection, tx); tx.Commit(); return; }
            var step = steps.SingleOrDefault(s => s.FromVersion == version) ?? throw new InvalidDataException($"Unsupported database schema {version}; required schema is {current}. Stop Jellyfin, back up storage and configure an empty directory or install a compatible release.");
            var record = Begin(journal, "database", connection.DataSource, version, current);
            var committed = false;
            try
            {
                using (PrivateFile(record.BackupPath)) { }
                using (var backup = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = record.BackupPath, Pooling = false }.ToString())) { backup.Open(); connection.BackupDatabase(backup); }
                record.BackupBytes = new FileInfo(record.BackupPath).Length; record.BackupState = "available"; record.State = "running"; Save(journal);
                using (var tx = connection.BeginTransaction())
                {
                    step.Apply(connection, tx); validate(connection, tx);
                    command.Transaction = tx; command.CommandText = $"PRAGMA user_version={current}"; command.ExecuteNonQuery(); tx.Commit(); committed = true;
                }
                record.State = "complete"; record.Completed = clock.GetUtcNow(); Save(journal);
            }
            catch { Failed(record, committed); Save(journal); throw; }
        }
    }
    public IReadOnlyList<UpgradeRecord> Records() { lock (gate) { return Read().Records; } }
    private static void Failed(UpgradeRecord record, bool committed)
    {
        record.State = committed ? "running" : "failed";
        if (record.BackupState == "pending")
        {
            record.BackupState = File.Exists(record.BackupPath) ? "incomplete" : "unavailable";
            if (File.Exists(record.BackupPath)) record.BackupBytes = new FileInfo(record.BackupPath).Length;
        }
    }
    public void Ready() { lock (gate) { using var exclusive = Exclusive(); var journal = Read(); journal.LastReadyPluginVersion = pluginVersion; Save(journal); } }
    public void Acknowledge(string id)
    {
        lock (gate) { using var exclusive = Exclusive(); var journal = Read(); var record = journal.Records.Single(r => r.Id == id); record.Acknowledged = true; Save(journal); }
    }
    private static string Stamp(string path) { var file = new FileInfo(path); return file.Exists ? file.Length + ":" + file.LastWriteTimeUtc.Ticks : "missing"; }
    private UpgradeRecord Backup(UpgradeJournal journal, string id)
    {
        var record = journal.Records.SingleOrDefault(r => r.Id == id) ?? throw new ArgumentException("Unknown backup.");
        if (record.State is "preparing" or "running" || record.BackupState is not ("available" or "incomplete")) throw new InvalidOperationException("This backup is unavailable or in use.");
        if (!Guid.TryParseExact(record.Id, "N", out _) || record.BackupPath != Path.Combine(Path.GetFullPath(directory), record.Id + (record.Domain == "settings" ? ".xml" : ".sqlite"))) throw new InvalidDataException("Invalid backup location.");
        return record;
    }
    public BackupDeletion PreviewDelete(string id)
    {
        lock (gate)
        {
            var record = Backup(Read(), id); var token = Guid.NewGuid().ToString("N"); var expires = clock.GetUtcNow().AddMinutes(5);
            deletions.Clear(); deletions[token] = (id, Stamp(record.BackupPath), expires);
            return new(token, id, record.BackupPath, new FileInfo(record.BackupPath).Length, expires);
        }
    }
    public void Delete(string id, string token)
    {
        lock (gate)
        {
            using var exclusive = Exclusive(); var journal = Read(); var record = Backup(journal, id);
            if (!deletions.Remove(token, out var ticket) || ticket.Id != id || ticket.Expires <= clock.GetUtcNow() || ticket.Stamp != Stamp(record.BackupPath)) throw new InvalidOperationException("Preview this backup again before deletion.");
            File.Delete(record.BackupPath); record.BackupState = "deleted"; Save(journal);
        }
    }
    public void Expire()
    {
        lock (gate)
        {
            using var exclusive = Exclusive(); var journal = Read();
            // Holding the exclusive lease means these intents belong to interrupted processes.
            foreach (var pending in journal.Records.Where(r => r.State is "preparing" or "running").Select(r => (r.Domain, r.SourcePath)).Distinct().ToList())
            {
                int version = 0;
                if (File.Exists(pending.SourcePath))
                {
                    if (pending.Domain == "settings") version = (int?)XDocument.Load(pending.SourcePath).Root?.Element("SchemaVersion") ?? 0;
                    else
                    {
                        using var database = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = pending.SourcePath, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
                        database.Open(); using var command = database.CreateCommand(); command.CommandText = "PRAGMA user_version"; version = Convert.ToInt32(command.ExecuteScalar());
                    }
                }
                Recover(journal, pending.Domain, pending.SourcePath, version);
            }
            foreach (var item in journal.Records.Where(r => r.State is not ("preparing" or "running") && (r.BackupState is "available" or "incomplete") && r.Expires <= clock.GetUtcNow()))
            {
                var record = Backup(journal, item.Id); File.Delete(record.BackupPath); record.BackupState = "expired"; Save(journal);
            }
        }
    }
    public void Clear()
    {
        lock (gate)
        {
            using var exclusive = Exclusive(); var journal = Read();
            foreach (var item in journal.Records.Where(r => r.BackupState is "available" or "incomplete")) File.Delete(Backup(journal, item.Id).BackupPath);
            Save(new() { LastReadyPluginVersion = pluginVersion }); deletions.Clear();
        }
    }
}
