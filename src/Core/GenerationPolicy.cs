namespace LyricBridge;

public sealed record GenerationPolicy(bool AllowUserRequests, bool AutoApproveUserRequests, int UserRequestDailyQuota, int UserRequestActiveCap);
