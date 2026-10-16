// Independent literal expectations; complete source lives in fixtures.json.
export const SEEDS = [0x6a09e667, 0xbb67ae85, 0x3c6ef372];
export const VERTEX = 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nIMM[0] FLT32 {.25,.5,.5,1}\nMOV OUT[0], IN[0]\nMOV OUT[1], IMM[0]\nEND\n';
export const FRAGMENT = 'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nMOV OUT[0], IN[0]\nEND\n';
export const clone = value => JSON.parse(JSON.stringify(value));
export function literalBank(fixture) {
 const words = Array(Math.min(fixture.declaredCount, 46) * 4).fill(0);
 for (const entry of fixture.components) words[entry.register * 4 + entry.component] = entry.word;
 return words;
}
