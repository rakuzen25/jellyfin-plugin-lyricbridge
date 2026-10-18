using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LyricBridge;

public sealed record CredentialChange(string Kind, string Id, string Action, string? Value = null);
public sealed record SettingsSnapshot(JsonObject Configuration, string Revision);
public sealed record SettingsWrite(Configuration Configuration, string Revision, IReadOnlyList<CredentialChange>? Credentials = null);

[ApiController, Authorize(Roles = Jellyfin.Api.Constants.UserRoles.Administrator), Route("LyricBridge/admin"), TypeFilter(typeof(SafeExceptionFilter))]
public sealed class AdminSettingsApi(Lazy<Plugin> plugin, Store store) : ControllerBase
{
    [HttpGet("settings")]
    public IActionResult Read() => new JsonResult(plugin.Value.ReadAdminSettings(), Codec.Json);
    [HttpPut("settings")]
    public IActionResult Save(SettingsWrite input) => new JsonResult(plugin.Value.SaveAdminSettings(input), Codec.Json);
    [HttpGet("requests")]
    public IActionResult Requests(string group = "active", int offset = 0, int limit = 50)
    {
        if (group is not ("active" or "finished") || offset < 0 || limit is < 1 or > 500)
            throw new WorkflowException(400, "invalid_pagination", "Choose an active or finished request group and valid pagination.");
        var jobs = store.All<Job>("job").Where(j => JobLifecycle.Terminal(j.State) == (group == "finished"))
            .OrderByDescending(j => j.Created).ThenBy(j => j.Id, StringComparer.Ordinal).ToList();
        return new JsonResult(new DataPage<Job>(jobs.Skip(offset).Take(limit).ToList(), jobs.Count, offset, limit), Codec.Json);
    }
}

public sealed partial class Plugin
{
    private readonly byte[] settingsKey = RandomNumberGenerator.GetBytes(32);
    private string settingsEpoch = Guid.NewGuid().ToString("N");
    private string SettingsStamp(string value) => Convert.ToHexString(HMACSHA256.HashData(settingsKey, Encoding.UTF8.GetBytes(value)));
    private string SettingsRevision() => SettingsStamp(settingsEpoch + JsonSerializer.Serialize(Configuration));
    public SettingsSnapshot ReadAdminSettings()
    {
        lock (configurationGate)
        {
            var json = JsonSerializer.SerializeToNode(Configuration)!.AsObject();
            void Clean(JsonNode? node)
            {
                if (node is JsonObject obj)
                {
                    foreach (var (key, child) in obj.ToList())
                    {
                        if (key is "ApiKey" or "Credential")
                        {
                            var secret = child?.GetValue<string>() ?? "";
                            obj[key] = "";
                            obj["CredentialPresent"] = secret.Length > 0;
                            obj["CredentialVersion"] = SettingsStamp(secret);
                        }
                        else Clean(child);
                    }
                }
                else if (node is JsonArray array) foreach (var child in array) Clean(child);
            }
            Clean(json);
            return new(json, SettingsRevision());
        }
    }
    public SettingsSnapshot SaveAdminSettings(SettingsWrite input)
    {
        lock (configurationGate)
        {
            if (dataMaintenance) throw new WorkflowException(409, "reset_in_progress", "Settings cannot be saved during a data reset.");
            if (input.Revision != SettingsRevision()) throw new WorkflowException(409, "settings_changed", "Saved settings changed. Compare your draft with the latest settings before saving.");
            var next = input.Configuration;
            if (next?.Sources == null || next.ServiceSetup?.Connections == null || next.ServiceSetup.Options == null || next.Sources.Any(s => s == null) || next.ServiceSetup.Connections.Any(c => c == null))
                throw new ArgumentException("Invalid settings.");
            // Work on a detached copy. A rejected save must never mutate live credentials.
            next = JsonSerializer.Deserialize<Configuration>(JsonSerializer.Serialize(next))!;
            if (next.Sources.Any(s => !string.IsNullOrEmpty(s.Credential)) || next.ServiceSetup.Connections.Any(c => !string.IsNullOrEmpty(c.ApiKey)))
                throw new ArgumentException("Use explicit credential operations.");
            foreach (var source in next.Sources) source.Credential = Configuration.Sources.FirstOrDefault(s => s.Name == source.Name)?.Credential ?? "";
            foreach (var connection in next.ServiceSetup.Connections) connection.ApiKey = Configuration.ServiceSetup.Connections.FirstOrDefault(c => c.Id == connection.Id)?.ApiKey ?? "";
            // Legacy credential-bearing configuration has no editor in the new interface.
            next.Services = JsonSerializer.Deserialize<ServiceConfig[]>(JsonSerializer.Serialize(Configuration.Services))!;
            next.Transcription = JsonSerializer.Deserialize<TranscriptionConfig>(JsonSerializer.Serialize(Configuration.Transcription))!;
            var operations = input.Credentials ?? [];
            if (operations.Count > 1000 || operations.Select(c => c.Kind + ":" + c.Id).Distinct().Count() != operations.Count)
                throw new ArgumentException("Invalid credential operations.");
            foreach (var change in operations)
            {
                if (change.Action is not ("keep" or "replace" or "clear") || change.Action == "replace" && string.IsNullOrWhiteSpace(change.Value))
                    throw new ArgumentException("Choose keep, replace, or clear for credentials.");
                var value = change.Action == "clear" ? "" : change.Value!;
                if (change.Kind == "source" && change.Id is "Spotify" or "AppleMusic" or "Musixmatch" && next.Sources.FirstOrDefault(s => s.Name == change.Id) is { } source)
                { if (change.Action != "keep") source.Credential = value; }
                else if (change.Kind == "connection" && next.ServiceSetup.Connections.FirstOrDefault(c => c.Id == change.Id) is { } connection)
                { if (change.Action != "keep") connection.ApiKey = value; }
                else throw new ArgumentException("Unknown credential target.");
            }
            UpdateConfiguration(next);
            return ReadAdminSettings();
        }
    }
}
