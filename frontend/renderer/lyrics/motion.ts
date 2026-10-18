/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

export function easeMotion(value: number): number {
    const x = clamp01(value);
    return 0.5 - Math.cos(Math.PI * x) / 2;
}
