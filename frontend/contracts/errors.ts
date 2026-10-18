export interface RequestIssue {
    code: string;
    message: string;
    location?: string | null;
}

export interface RequestFailure {
    code: string;
    message: string;
    retryable?: boolean;
    diagnosticId?: string | null;
    retryAt?: string | null;
    issues?: RequestIssue[];
    issueCount?: number;
}
