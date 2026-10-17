namespace LyricBridge;

/// <summary>Storage contract used by generation workers, independent of database or host types.</summary>
public interface IGenerationRepository : IJobRepository
{
    StoreAdmission Admit(Guid? item = null);
    bool IsAdmitted(StoreAdmission ticket, string hash);
    bool IsResetting { get; }
    long Epoch { get; }
    bool PersistRequest(Job job, long expectedEpoch, RichLyrics? lyrics = null, bool requireExisting = false);
    RichLyrics? GetDocument(string hash);
    Variant? GetVariant(string key);
    List<Variant> Variants(string hash);
    void SaveJob(Job job);
    bool CompleteGeneration(Job job, Variant? variant);
}

/// <summary>Indexed access to retained generation history and active admissions.</summary>
public interface IJobRepository
{
    Job? GetJob(string id);
    IReadOnlyList<Job> JobHistory(Guid? user, int offset, int limit);
    IReadOnlyList<Job> ActiveJobs(Guid? user = null);
    Job? FindActiveJob(Guid user, string cacheKey);
    int CountAdmissions(Guid user, DateTime since);
    int CountActiveJobs(Guid user);
    IReadOnlyList<Job> RemoveFinishedJobs(IReadOnlyList<string> ids, Guid? user = null, DateTimeOffset? before = null);
}

public interface ILanguageVersionRepository
{
    RichLyrics? GetDocument(string hash);
    Variant? GetVariant(string key);
    bool SaveSuppliedVariant(Variant variant, MixedOrigin origin, string choiceId, Guid? item = null, VersionSnapshot? expected = null);
    bool SelectAuxiliary(string choiceId, string hash, string kind, string language, string key);
    bool DeleteVariant(string key, string hash, string kind);
    bool SelectPendingLocal(string choiceId, string key);
}

public interface ILyricQueryRepository
{
    IReadOnlyList<SavedOriginal> SavedOriginals(Guid item);
    bool DiscoverySuppressed(Guid item);
    string ActiveStoragePath { get; }
    MatchRejection? Rejection(Guid item);
    InstrumentalEvidence? Instrumental(Guid item);
    void RecordInstrumental(Guid item, InstrumentalEvidence evidence);
    void SaveDocument(RichLyrics lyrics);
    StoreAdmission Admit(Guid? item = null);
    void SaveAutomaticOriginal(Guid item, RichLyrics lyrics, StoreAdmission admission);
    IReadOnlyList<Variant> Versions(string hash);
    AuxiliarySelection? AuxiliaryChoice(Guid user, string hash, string kind, string language);
    TimingCorrection? Timing(Guid item, string hash);
}

public interface ISelectionRepository
{
    IReadOnlyList<SavedOriginal> SavedOriginals(Guid item);
    RichLyrics SavedDocument(Guid item, string hash);
    void SelectOriginal(Guid item, string hash);
    VersionSnapshot Selection(Guid item);
    ImprovementOffer? Improvement(Guid item);
    ImprovementOffer? TryOffer(Guid item, VersionSnapshot expected, ImprovementOffer offer, RawLyrics? raw = null, Candidate? assessedBaseline = null, RichLyrics? displayedBaseline = null);
    SelectionAssessment? PreviewAssessment(Candidate candidate);
    void ClearRejection(Guid item);
    string? ApplyUpgrade(Guid item, VersionSnapshot expected, string offerHash, string baselineHash);
    bool SaveTiming(Guid item, VersionSnapshot expected, TimingCorrection correction);
    void ApplySelection(Guid item, VersionSnapshot selection, RawLyrics? raw = null);
}

public interface IPreferenceRepository
{
    Preferences? AccountPreferences(Guid user);
    void SaveAccountPreferences(Guid user, Preferences preferences);
    SongLanguagePreferences SongPreferences(Guid user, Guid item);
    void SaveSongPreferences(Guid user, Guid item, SongLanguagePreferences? preferences);
}
