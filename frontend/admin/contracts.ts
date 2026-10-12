interface SourceConfiguration {
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
export interface Configuration {
    [key: string]: unknown;
    EnableWebRenderer: boolean;
    StoragePath: string;
    MinimumMatch: number;
    ScheduledRetrieval: boolean;
    AllowUserRequests: boolean;
    AutoApproveUserRequests: boolean;
    UserRequestDailyQuota: number;
    UserRequestActiveCap: number;
    Sources: SourceConfiguration[];
    Services: ServiceConfiguration[];
    Defaults: DisplayDefaults;
}
export interface JobSummary {
    outputDeleted?: boolean;
    outputDeletedAt?: string | null;
    id: string;
    state: string;
    progress: number;
    request: { kind: string; language: string };
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
