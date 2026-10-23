
const clockU8 = Uint8Array;
const clockTyped = Object.getPrototypeOf(clockU8.prototype);
const clockTag = Object.getOwnPropertyDescriptor(clockTyped, Symbol.toStringTag).get;
const clockBuffer = Object.getOwnPropertyDescriptor(clockTyped, 'buffer').get;
const clockLength = Object.getOwnPropertyDescriptor(clockTyped, 'length').get;
const clockOffset = Object.getOwnPropertyDescriptor(clockTyped, 'byteOffset').get;
const clockAbLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
export function ownedClockOriginBytes(value, limit) {
  if (clockTag.call(value) !== 'Uint8Array') throw Error('clock origin byte type');
  const buffer = clockBuffer.call(value);
  clockAbLength.call(buffer); // Reject shared buffers before the Rust copy, including shadowed properties.
  const length = clockLength.call(value), offset = clockOffset.call(value);
  if (length > limit) throw Error('clock origin byte bound');
  return new clockU8(buffer, offset, length);
}
