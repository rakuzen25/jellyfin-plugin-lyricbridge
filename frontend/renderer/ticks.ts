/* This Source Code Form is subject to the Mozilla Public License, v. 2.0.
 * See https://mozilla.org/MPL/2.0/. Derived from the maintained LyricMotion fork. */
export function finiteTick(value: unknown): number | null {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") {
        return null;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

export function nullableTick(value: unknown): number | null {
    return finiteTick(value);
}
