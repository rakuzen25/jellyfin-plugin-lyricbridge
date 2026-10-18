export interface CredentialState {
    CredentialPresent?: boolean;
    CredentialVersion?: string;
    CredentialAction?: "keep" | "replace" | "clear";
}
export interface ServiceConnection extends CredentialState {
    Id: string;
    Name: string;
    Provider: string;
    Endpoint: string;
    ApiKey: string;
}
export interface ServiceOption {
    Id: string;
    Name: string;
    Capability: string;
    Provider: string;
    ConnectionId: string | null;
    Enabled: boolean;
    Model: string;
    TimeoutSeconds: number;
    ModelContextWindow?: number;
    DetectModelLimits?: boolean | null;
    ModelCompletionLimit?: number | null;
    ReasoningEffort: string;
    ContextBefore: number;
    ContextAfter: number;
    UploadFormat: string;
    MaxUploadMb: number;
    MaxInputMb: number;
}
export interface ServiceSetup {
    Version: number;
    Connections: ServiceConnection[];
    Options: ServiceOption[];
}
interface SourceConfiguration extends CredentialState {
    Name: string;
    Enabled: boolean;
    Credential: string;
}
interface ServiceConfiguration {
    Name: string;
    Enabled: boolean;
    Endpoint: string;
    ApiKey: string;
    Model: string;
    ContextBefore: number;
    ContextAfter: number;
    ReasoningEffort: string;
    TimeoutSeconds: number;
}
interface DisplayDefaults {
    [key: string]: string | number | boolean;
    SourceLanguage: string;
    TranslationLanguage: string;
    RowOrder: string;
    OriginalSize: number;
    PronunciationSize: number;
    TranslationSize: number;
    RowSpacing: number;
    ShowPronunciation: boolean;
    ShowTranslation: boolean;
    JapaneseRomaji: boolean;
}
interface TranscriptionConfiguration {
    Enabled: boolean;
    Endpoint: string;
    Model: string;
    ApiKey: string;
    UploadFormat: string;
    MaxUploadMb: number;
    MaxInputMb: number;
    TimeoutSeconds: number;
    ReviewUsesAiService: boolean;
    Review: ServiceConfiguration;
}
export interface Configuration {
    ServiceSetup: ServiceSetup;
    Transcription: TranscriptionConfiguration;
    [key: string]: unknown;
    EnableWebRenderer: boolean;
    StoragePath: string;
    MinimumMatch: number;
    ScheduledRetrieval: boolean;
    AutoGeneratePronunciation: boolean;
    AllowUserRequests: boolean;
    AutoApproveUserRequests: boolean;
    UserRequestDailyQuota: number;
    UserRequestActiveCap: number;
    Sources: SourceConfiguration[];
    Services: ServiceConfiguration[];
    Defaults: DisplayDefaults;
}
export interface JobSummary {
    title?: string;
    artist?: string;
    outputDeleted?: boolean;
    outputDeletedAt?: string | null;
    id: string;
    state: string;
    progress: number;
    request: { kind: string; language: string };
    audio?: { chunkCount: number; allowChunking: boolean };
    taskKind?: string;
    stage?: string;
    reviewPlan?: { requestCount: number };
    error?: string;
    failure?: { diagnosticId?: string };
}
export interface HostFailure {
    message?: string;
    status?: number;
    details?: { diagnosticId?: string };
    responseJSON?: { error?: { message?: string; diagnosticId?: string } };
    responseText?: string;
    response?: { data?: string; status?: number };
    json?: () => Promise<unknown>;
    clone?: () => Response;
}
export function hostFailure(value: unknown): HostFailure {
    return value && typeof value === "object" ? (value as HostFailure) : { message: String(value) };
}
declare global {
    const ApiClient: {
        ajax(options: { type: string; url: string; dataType: string; contentType: string; data?: string }): Promise<unknown>;
        getUrl(path: string): string;
        getPluginConfiguration(id: string): Promise<Configuration>;
        updatePluginConfiguration(id: string, value: Configuration): Promise<unknown>;
    };
}

export interface WebRendererStatus {
    severity?: "info" | "warning" | "error";
    enabled: boolean;
    mechanism: string;
    webRoot: string;
    result: string;
}
