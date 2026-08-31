
export function throwJitMemFault() {
    throw null;
}

export function invokeJitBlock(run, stateBase, directChain) {
    try {
        return directChain ? run(stateBase, 1) : run(stateBase);
    } catch {
        return NaN;
    }
}
