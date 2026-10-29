
export function throwJitMemFault() {
    throw null;
}

export function invokeJitBlock(run, stateBase, directChain) {
    try {
        // Direct-chain functions carry a third virtual-entry-PC argument. The host root uses the
        // handoff-backed path (root=1), so pass an explicit zero for the ignored fast-call value.
        return directChain ? run(stateBase, 1, 0n) : run(stateBase);
    } catch {
        return NaN;
    }
}
