using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace LyricBridge;

public sealed record Variant(string Key, string Hash, string Kind, string Language, string Service, string Model, Dictionary<string, string> Text, int ContextBefore = 0, int ContextAfter = 0, string ReasoningEffort = "", int PromptVersion = 0, string? CacheKey = null, DateTime? CreatedAt = null, SuppliedOrigin? Origin = null, Dictionary<string, string>? SkippedRows = null, GenerationProfile? Profile = null, string OriginType = "generated", string? OptionName = null);

public sealed record SuppliedOrigin(string Source, string ProviderId, string? DonorHash = null);

public sealed record MixedOrigin(string DonorHash, Dictionary<string, string>? Mapping = null);

public sealed record AuxiliarySelectionInput(string Hash, string Kind, string Key);

public sealed record AuxiliarySelection(string Key);
