using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LyricBridge;

[ApiController, Authorize(Roles = Jellyfin.Api.Constants.UserRoles.Administrator), Route("LyricBridge/admin"), TypeFilter(typeof(SafeExceptionFilter))]
public sealed class UpgradeApi(Lazy<Plugin> plugin) : ControllerBase
{
    [HttpGet("startup")]
    public IActionResult Startup() => new JsonResult(plugin.Value.Startup, Codec.Json);
    [HttpGet("upgrades")]
    public IActionResult Upgrades() => new JsonResult(plugin.Value.Upgrades.Records(), Codec.Json);
    [HttpPost("upgrades/{id}/acknowledge")]
    public IActionResult Acknowledge(string id) { plugin.Value.Upgrades.Acknowledge(id); return new JsonResult(new { acknowledged = true }, Codec.Json); }
    [HttpPost("upgrades/{id}/backup-deletion-preview")]
    public IActionResult Preview(string id) => new JsonResult(plugin.Value.Upgrades.PreviewDelete(id), Codec.Json);
    [HttpDelete("upgrades/{id}/backup")]
    public IActionResult Delete(string id, [FromBody] BackupDeleteInput input) { plugin.Value.Upgrades.Delete(id, input.Token); return new JsonResult(new { deleted = true }, Codec.Json); }
}
public sealed record BackupDeleteInput(string Token);

[ApiController, Route("LyricBridge")]
public sealed class AssetApi : ControllerBase
{
    [AllowAnonymous, HttpGet("assets/{name}")]
    public IActionResult Asset(string name) { if (name is not ("lyricbridge.js" or "lyricbridge.css" or "jellyfin-lyric-motion.js" or "jellyfin-lyric-motion.css")) return NotFound(); var stream = typeof(Plugin).Assembly.GetManifestResourceStream("Jellyfin.Plugin.LyricBridge.Web." + name); return stream == null ? NotFound() : File(stream, name.EndsWith(".js") ? "application/javascript" : name.EndsWith(".css") ? "text/css" : "text/html"); }
}
