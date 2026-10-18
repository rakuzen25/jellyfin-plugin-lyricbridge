using System.Security.Claims;
using Jellyfin.Api.Extensions;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;

namespace LyricBridge;

/// <summary>Host authentication and library visibility are enforced at every HTTP boundary.</summary>
public sealed class LibraryAccess(ILibraryManager library)
{
    public static bool IsAdministrator(ClaimsPrincipal user) => user.IsInRole(Jellyfin.Api.Constants.UserRoles.Administrator);
    public Audio? FindAudio(Guid id, ClaimsPrincipal user)
    {
        if (user.Identity?.IsAuthenticated != true) return null;
        var userId = user.GetUserId();
        // Jellyfin administrator API keys may have no associated user account.
        return userId == Guid.Empty && IsAdministrator(user)
            ? library.GetItemById<Audio>(id)
            : userId == Guid.Empty ? null : library.GetItemById<Audio>(id, userId);
    }
    public static bool Owns(Guid owner, ClaimsPrincipal user) => IsAdministrator(user) || owner == user.GetUserId();
}
