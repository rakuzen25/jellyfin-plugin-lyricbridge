using Jellyfin.Api.Extensions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LyricBridge;

[ApiController, Authorize(Roles = Jellyfin.Api.Constants.UserRoles.Administrator), Route("LyricBridge/admin/data"), TypeFilter(typeof(SafeExceptionFilter))]
public sealed class DataManagementApi(DataManagementService data) : ControllerBase
{
    private IActionResult JsonData(object? value) => new JsonResult(value, Codec.Json);
    [HttpGet("overview")]
    public IActionResult Overview() => JsonData(data.Overview());
    [HttpGet("configuration")]
    public IActionResult Configuration() => JsonData(data.Configuration());
    [HttpGet("songs")]
    public IActionResult Songs(string? search = null, string? category = null, bool missing = false, int offset = 0, int limit = 50) => JsonData(data.Entities(false, search, category, missing, offset, limit));
    [HttpGet("accounts")]
    public IActionResult Accounts(string? search = null, string? category = null, bool missing = false, int offset = 0, int limit = 50) => JsonData(data.Entities(true, search, category, missing, offset, limit));
    [HttpGet("records")]
    public IActionResult Records(string? category = null, Guid? itemId = null, Guid? userId = null, int offset = 0, int limit = 50) => JsonData(data.Records(category, itemId, userId, offset, limit));
    [HttpGet("detail")]
    public IActionResult Detail(string kind, string id) => JsonData(data.Detail(new(kind, id)));
    [HttpPost("requests/{id}/cancel")]
    public IActionResult CancelRequest(string id) => JsonData(data.CancelRequest(id));
    [HttpPost("preview")]
    public IActionResult Preview(DataSelection input) => JsonData(data.Preview(User.GetUserId(), input));
    [HttpPost("execute")]
    public async Task<IActionResult> Execute(DataExecution input) => JsonData(await data.Execute(User.GetUserId(), input));
}
