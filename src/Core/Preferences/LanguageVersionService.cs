namespace LyricBridge;

public sealed class LanguageVersionService(ILanguageVersionRepository repository)
{
    public static string ChoiceKey(Guid user, string hash, string kind, string language) => user.ToString("N") + ":" + hash + ":" + kind + ":" + language;
    public void Mix(Guid user, Guid item, VersionSnapshot expected, RichLyrics? original, MixInput input, string translationLanguage)
    {
        RequireCurrent(original, input.Hash);
        if (input.Kind is not ("translation" or "pronunciation") || !PreferenceService.LanguageTag(input.Language)) throw new WorkflowException(400, "invalid_mix", "Choose a lyric kind and language.");
        var donor = repository.GetDocument(input.DonorHash) ?? throw new WorkflowException(409, "donor_unavailable", "Preview the donor lyrics again.", true);
        Dictionary<string, string> text;
        try { text = LyricComposition.Mix(original!, donor, input); }
        catch (ArgumentException error) { throw new WorkflowException(400, "invalid_alignment", error.Message); }
        var key = "mix:" + Guid.NewGuid().ToString("N");
        var variant = new Variant(key, input.Hash, input.Kind, input.Kind == "pronunciation" ? donor.Language : input.Language, donor.Source, "Supplied · " + donor.ProviderId, text, CreatedAt: DateTime.UtcNow, Origin: new SuppliedOrigin(donor.Source, donor.ProviderId, input.DonorHash), OriginType: "supplied");
        if (!repository.SaveSuppliedVariant(variant, new(input.DonorHash, input.Mapping), ChoiceKey(user, input.Hash, input.Kind, input.Kind == "translation" ? translationLanguage : ""), item, expected)) throw new WorkflowException(409, "lyric_version_changed", "Reload the original and preview the donor again.", true);
    }
    public void Select(Guid user, RichLyrics? lyrics, AuxiliarySelectionInput input, string translationLanguage)
    {
        RequireCurrent(lyrics, input.Hash);
        if (input.Kind is not ("translation" or "pronunciation")) throw new WorkflowException(400, "invalid_request", "Choose translation or pronunciation.");
        var language = input.Kind == "translation" ? translationLanguage : "";
        if (input.Key == "provider" && !EmbeddedVersions.Available(lyrics, input.Kind, language)) throw new WorkflowException(409, "language_version_unavailable", "This original has no included rows for the selected language.", true);
        if (!repository.SelectAuxiliary(ChoiceKey(user, input.Hash, input.Kind, language), input.Hash, input.Kind, language, input.Key)) throw new WorkflowException(409, "language_version_unavailable", "Reload and choose an available version.", true);
    }
    public void Delete(RichLyrics? lyrics, AuxiliarySelectionInput input)
    {
        RequireCurrent(lyrics, input.Hash);
        if (input.Kind is not ("translation" or "pronunciation") || input.Key is "auto" or "provider") throw new WorkflowException(400, "invalid_request", "Choose a saved language version.");
        var version = repository.GetVariant(input.Key);
        if (version is null || version.Hash != input.Hash || version.Kind != input.Kind) throw new WorkflowException(404, "language_version_unavailable", "This version is no longer available.");
        if (version.Service == "Kawazu") throw new WorkflowException(400, "automatic_pronunciation", "Disable local pronunciation in Display settings instead.");
        if (!repository.DeleteVariant(input.Key, input.Hash, input.Kind)) throw new WorkflowException(409, "language_version_unavailable", "This version changed. Reload before deleting.", true);
    }
    public void SelectPendingLocal(Guid user, string hash, string key)
    {
        if (!repository.SelectPendingLocal(ChoiceKey(user, hash, "pronunciation", ""), key)) throw new WorkflowException(409, "reset_in_progress", "The lyric state changed. Retry after reset.", true);
    }
    private static void RequireCurrent(RichLyrics? lyrics, string hash)
    {
        if (lyrics is null || Codec.ContentHash(lyrics) != hash) throw new WorkflowException(409, "lyric_version_changed", "Reload the current original lyrics.", true);
    }
}
