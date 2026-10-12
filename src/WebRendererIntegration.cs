using System.Reflection;
using System.Runtime.Loader;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LyricBridge;

public sealed record WebRendererStatus(bool Enabled, string Mechanism, string WebRoot, string Result, string Severity = "info");

/// <summary>Owns renderer injection at the Jellyfin host boundary, never lyric storage.</summary>
public sealed class WebRendererIntegration : BackgroundService
{
    private readonly string webRoot;
    private readonly Func<bool> enabled;
    private readonly ILogger<WebRendererIntegration> logger;
    private readonly SemaphoreSlim gate = new(1);
    private readonly Channel<bool> changes = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });
    private readonly Func<bool> register;
    private readonly Action? detach;
    private readonly string revision;
    private WebRendererStatus status;
    private static WebRendererIntegration? active;
    public const string StartMarker = "<!-- LyricBridge managed assets -->";
    public const string EndMarker = "<!-- /LyricBridge managed assets -->";
    public static IReadOnlyList<string> Assets { get; } = Array.AsReadOnly<string>(["lyricbridge.css", "jellyfin-lyric-motion.css", "lyricbridge.js", "jellyfin-lyric-motion.js"]);
    private static readonly Regex Block = new(Regex.Escape(StartMarker) + ".*?" + Regex.Escape(EndMarker) + "\\r?\\n?", RegexOptions.Singleline | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
    private static readonly Regex Head = new("</head\\s*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));

    public WebRendererIntegration(IApplicationPaths paths, ILogger<WebRendererIntegration> logger)
        : this(paths.WebPath, () => Plugin.Instance.Configuration.EnableWebRenderer, logger, AssetRevision())
    {
        Plugin.Instance.ConfigurationUpdated += Changed;
        detach = () => Plugin.Instance.ConfigurationUpdated -= Changed;
    }

    public WebRendererIntegration(string webRoot, Func<bool> enabled, ILogger<WebRendererIntegration> logger, string revision, Func<bool>? register = null)
    {
        this.webRoot = webRoot;
        this.enabled = enabled;
        this.logger = logger;
        this.revision = revision;
        this.register = register ?? RegisterTransformation;
        status = new(enabled(), "none", webRoot, "Waiting for startup");
    }

    public WebRendererStatus Status => Volatile.Read(ref status);
    private void Changed() => changes.Writer.TryWrite(true);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Volatile.Write(ref active, this);
        try
        {
            // Reconcile immediately, then retry after other plugins have initialized.
            for (var attempt = 0; attempt < 3; attempt++)
            {
                if (attempt > 0) await Task.Delay(TimeSpan.FromSeconds(attempt * 2), stoppingToken);
                await Repair(stoppingToken);
                if (Status.Mechanism == "file-transformation") break;
            }
            await foreach (var _ in changes.Reader.ReadAllAsync(stoppingToken)) await Repair(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally { Interlocked.CompareExchange(ref active, null, this); }
    }

    public override void Dispose()
    {
        Interlocked.CompareExchange(ref active, null, this);
        detach?.Invoke();
        base.Dispose();
    }

    public async Task<WebRendererStatus> Repair(CancellationToken token)
    {
        await gate.WaitAsync(token);
        var transformed = false;
        try
        {
            var isEnabled = enabled();
            try { transformed = register(); }
            catch (Exception error) { logger.LogWarning("LyricBridge web transformation registration failed ({Type}); checking direct injection", error.GetType().Name); }
            var index = Path.Combine(webRoot, "index.html");
            if (!File.Exists(index))
                return Set(isEnabled, transformed && isEnabled ? "file-transformation" : "none", transformed ? "Transformation registered; local index unavailable" : "Web index not found; use the separate installer for a separately hosted client", transformed ? "info" : "error");
            var original = await File.ReadAllTextAsync(index, token);
            var clean = Normalize(original, false, revision);
            var updated = Normalize(original, isEnabled && !transformed, revision);
            token.ThrowIfCancellationRequested();
            if (updated != original) WriteIndex(index, original, updated);
            return Set(isEnabled, isEnabled ? transformed ? "file-transformation" : "direct" : "none",
                !isEnabled ? "Renderer disabled; reload browser clients" : transformed ? "Injected at serve time; reload browser clients" : updated == original ? "Direct injection already present" : clean == original ? "Direct injection installed; reload browser clients" : "Direct injection updated; reload browser clients");
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException or RegexMatchTimeoutException)
        {
            logger.LogWarning("LyricBridge web injection could not reconcile ({Type})", error.GetType().Name);
            return Set(enabled(), transformed && enabled() ? "file-transformation" : "none", transformed ? "Serve-time transformation registered, but disk cleanup failed; check web-root permissions before uninstall" : "Web index could not be updated; check web-root permissions and HTML, or install File Transformation compatible with your Jellyfin version", transformed ? "warning" : "error");
        }
        finally { gate.Release(); }
    }

    private WebRendererStatus Set(bool isEnabled, string mechanism, string result, string severity = "info")
    {
        var next = new WebRendererStatus(isEnabled, mechanism, webRoot, result, severity);
        Volatile.Write(ref status, next);
        return next;
    }

    public static string Normalize(string html, bool enabled, string revision)
    {
        var clean = Block.Replace(html, "");
        if (clean.Contains(StartMarker, StringComparison.Ordinal) || clean.Contains(EndMarker, StringComparison.Ordinal))
            throw new InvalidDataException("Incomplete LyricBridge marker block");
        if (!enabled) return clean;
        if (!Head.IsMatch(clean)) throw new InvalidDataException("Web index has no closing head tag");
        if (!Regex.IsMatch(revision, "^[a-f0-9]{16}$", RegexOptions.CultureInvariant)) throw new InvalidDataException("Invalid asset revision");
        var block = new StringBuilder(StartMarker + "\n");
        foreach (var asset in Assets)
        {
            var url = "../LyricBridge/assets/" + asset + "?v=" + revision;
            block.Append(asset.EndsWith(".css", StringComparison.Ordinal) ? $"<link rel=\"stylesheet\" href=\"{url}\">\n" : $"<script defer src=\"{url}\"></script>\n");
        }
        block.Append(EndMarker + "\n");
        return Head.Replace(clean, match => block + match.Value, 1);
    }

    public static void WriteIndex(string index, string original, string updated)
    {
        // Never restore the whole backup: it can predate unrelated web updates.
        var backup = index + ".lyricbridge-backup";
        if (!File.Exists(backup)) File.Copy(index, backup, false);
        var temporary = index + ".lyricbridge-" + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, updated, new UTF8Encoding(false));
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(temporary, File.GetUnixFileMode(index));
            if (File.ReadAllText(index) != original) throw new IOException("Web index changed during injection; retry repair");
            File.Move(temporary, index, true);
        }
        finally { File.Delete(temporary); }
    }

    public static string AssetRevision()
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var name in Assets)
        {
            using var stream = typeof(Plugin).Assembly.GetManifestResourceStream("Jellyfin.Plugin.LyricBridge.Web." + name) ?? throw new InvalidDataException("Missing renderer asset");
            using var contents = new MemoryStream();
            stream.CopyTo(contents);
            hash.AppendData(contents.ToArray());
        }
        return Convert.ToHexStringLower(hash.GetHashAndReset())[..16];
    }

    public sealed class TransformationInput { public string? Contents { get; set; } }
    public static string TransformIndexHtml(TransformationInput? input)
    {
        var original = input?.Contents ?? "";
        try
        {
            var owner = Volatile.Read(ref active);
            return owner == null ? original : Normalize(original, owner.enabled(), owner.revision);
        }
        catch { return original; }
    }

    public static bool RegisterWith(Assembly assembly)
    {
        var register = assembly.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface")?.GetMethods(BindingFlags.Public | BindingFlags.Static)
            .SingleOrDefault(method => method.Name == "RegisterTransformation" && method.GetParameters().Length == 1);
        if (register == null) return false;
        var parse = register.GetParameters()[0].ParameterType.GetMethod("Parse", BindingFlags.Public | BindingFlags.Static, [typeof(string)]);
        if (parse == null) return false;
        var payload = JsonSerializer.Serialize(new
        {
            id = typeof(Plugin).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().Single(attribute => attribute.Key == "LyricBridgeGuid").Value,
            fileNamePattern = "index.html",
            callbackAssembly = typeof(WebRendererIntegration).Assembly.FullName,
            callbackClass = typeof(WebRendererIntegration).FullName,
            callbackMethod = nameof(TransformIndexHtml)
        });
        register.Invoke(null, [parse.Invoke(null, [payload])]);
        return true;
    }

    private static bool RegisterTransformation()
    {
        var assembly = AssemblyLoadContext.All.SelectMany(context => context.Assemblies)
            .FirstOrDefault(candidate => candidate.GetName().Name == "Jellyfin.Plugin.FileTransformation");
        return assembly != null && RegisterWith(assembly);
    }
}
