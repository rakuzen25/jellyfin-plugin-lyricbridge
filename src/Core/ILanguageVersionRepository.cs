namespace LyricBridge;

public interface ILanguageVersionRepository
{
    RichLyrics? GetDocument(string hash);
    Variant? GetVariant(string key);
    bool SaveSuppliedVariant(Variant variant, MixedOrigin origin, string choiceId, Guid? item = null, VersionSnapshot? expected = null);
    bool SelectAuxiliary(string choiceId, string hash, string kind, string language, string key);
    bool DeleteVariant(string key, string hash, string kind);
    bool SelectPendingLocal(string choiceId, string key);
}
