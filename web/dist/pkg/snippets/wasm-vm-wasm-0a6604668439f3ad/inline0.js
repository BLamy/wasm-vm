
export function throwJitMemFault() {
    throw null;
}

export function invokeJitBlock(run, stateBase) {
    try {
        return run(stateBase);
    } catch {
        return NaN;
    }
}
