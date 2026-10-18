/** Stable owner views expose collections for reading without copying them per frame. */
export type ReadView<T> = {
    readonly [K in keyof T]: T[K] extends Map<infer Key, infer Value>
        ? ReadonlyMap<Key, Value>
        : T[K] extends Set<infer Value>
          ? ReadonlySet<Value>
          : T[K] extends (infer Value)[]
            ? readonly Value[]
            : T[K];
};

/** Freeze a stable accessor facade once; owner commands continue updating private data. */
export function readView<T extends object>(state: T): ReadView<T> {
    const descriptors: PropertyDescriptorMap = {};
    for (const key of Object.keys(state) as (keyof T & string)[]) descriptors[key] = { enumerable: true, get: () => state[key] };
    return Object.freeze(Object.defineProperties({}, descriptors)) as ReadView<T>;
}
