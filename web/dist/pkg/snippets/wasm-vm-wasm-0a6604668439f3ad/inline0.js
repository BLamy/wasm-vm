
export function throwJitMemFault() {
    throw null;
}

export function invokeJitBlock(run) {
    try {
        return run(0);
    } catch {
        return NaN;
    }
}
