/** Credential keep and absent actions represent the same editor value. */
export function sameEditorValues(left: unknown, right: unknown) {
    const normalize = (value: unknown) => {
        const json = JSON.stringify(value, (key, item: unknown) => (key === "CredentialAction" && item === "keep" ? undefined : item));
        return json === undefined ? undefined : (JSON.parse(json) as unknown);
    };
    return same(normalize(left), normalize(right));
}

/** Three-way configuration rebase. Arrays with stable identities merge by identity, not index. */
interface DraftConflict {
    path: string;
    label: string;
    local: unknown;
    latest: unknown;
    credential?: boolean;
}
export function same(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, i) => same(value, right[i]));
    if (object(left) && object(right)) {
        const keys = Object.keys(left);
        return keys.length === Object.keys(right).length && keys.every((key) => same(left[key], right[key]));
    }
    return false;
}
function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
export function rebaseSettings<T>(base: T, local: T, latest: T, choices: ReadonlyMap<string, "local" | "latest"> = new Map()) {
    const conflicts: DraftConflict[] = [];
    function safe(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(safe);
        if (object(value))
            return Object.fromEntries(
                Object.entries(value)
                    .filter(([key]) => key !== "CredentialVersion")
                    .map(([key, child]) => [
                        key,
                        ["ApiKey", "Credential"].includes(key) ? (child ? "Replacement supplied" : "Value undisclosed") : safe(child),
                    ]),
            );
        return value;
    }
    function conflict(path: string, mine: unknown, theirs: unknown, credential = false) {
        if (!choices.has(path))
            conflicts.push({
                path,
                label: path.replaceAll("/", " · "),
                local: credential ? "Your instruction: " + String(object(mine) ? mine.CredentialAction : "keep") : safe(mine),
                latest: credential ? "Latest saved credential" : safe(theirs),
                credential,
            });
        return choices.get(path) === "latest" ? theirs : mine;
    }
    function merge(old: unknown, mine: unknown, theirs: unknown, path: string): unknown {
        if (same(mine, old)) return theirs;
        if (same(theirs, old) || same(mine, theirs)) return mine;
        if (Array.isArray(old) && Array.isArray(mine) && Array.isArray(theirs)) {
            const all = [...old, ...mine, ...theirs];
            const key = all.every((v) => object(v) && typeof v.Id === "string")
                ? "Id"
                : all.every((v) => object(v) && typeof v.Name === "string")
                  ? "Name"
                  : null;
            if (!key) return conflict(path, mine, theirs);
            const identity = (v: unknown) => String((v as Record<string, unknown>)[key]);
            const oldOrder = old.map(identity),
                mineOrder = mine.map(identity),
                theirOrder = theirs.map(identity);
            // Only common identities participate in an order conflict; independent additions merge.
            const common = oldOrder.filter((id) => mineOrder.includes(id) && theirOrder.includes(id));
            const order = merge(
                common,
                mineOrder.filter((id) => common.includes(id)),
                theirOrder.filter((id) => common.includes(id)),
                path + "/order",
            ) as string[];
            const ids = [...new Set([...order, ...mineOrder, ...theirOrder])];
            return ids
                .map((id) =>
                    merge(
                        old.find((v) => identity(v) === id),
                        mine.find((v) => identity(v) === id),
                        theirs.find((v) => identity(v) === id),
                        path + "/" + id,
                    ),
                )
                .filter((v) => v !== undefined);
        }
        if (object(old) && object(mine) && object(theirs)) {
            const result: Record<string, unknown> = {};
            const secretConflict = mine.CredentialAction && mine.CredentialAction !== "keep" && old.CredentialVersion !== theirs.CredentialVersion;
            const instruction = secretConflict ? (conflict(path + "/credential", mine, theirs, true) as Record<string, unknown>) : mine;
            for (const key of new Set([...Object.keys(old), ...Object.keys(mine), ...Object.keys(theirs)])) {
                let value: unknown;
                if (key === "CredentialVersion" || key === "CredentialPresent") value = theirs[key];
                else if (secretConflict && ["Credential", "ApiKey", "CredentialAction"].includes(key)) value = instruction[key];
                else value = merge(old[key], mine[key], theirs[key], path ? path + "/" + key : key);
                if (value !== undefined) result[key] = value;
            }
            return result;
        }
        return conflict(path, mine, theirs);
    }
    return { configuration: merge(base, local, latest, "") as T, conflicts };
}
