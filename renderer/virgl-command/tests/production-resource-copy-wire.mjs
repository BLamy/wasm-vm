import {decodeProductionSubmission, decodeStandardStreamOutputSubmission} from '../decoder.mjs';

// Independent packet transcriptions use the pinned virgl_protocol.h RCR layout.
export function runResourceCopyWire(fixtures) {
  let assertions = 0;
  const need = (value, message) => { assertions++; if (!value) throw Error(message); };
  const unhex = text => Uint8Array.from(text.match(/../g), byte => parseInt(byte, 16));
  const changed = (bytes, index, value) => {
    const copy = bytes.slice(); new DataView(copy.buffer).setUint32(index * 4, value, true); return copy;
  };
  const reject = (bytes, message) => {
    const result = decodeProductionSubmission(bytes);
    need(!result.ok && !Object.hasOwn(result, 'commands'), message + ' rejects the whole submission');
  };
  need(fixtures.schema === 'omarchy-wallpaper-native-copy-v1', 'original wallpaper fixture schema');
  need(fixtures.jobs.length === 2, 'both original refused jobs retained');
  const jobs = [];
  for (const fixture of fixtures.jobs) {
    const bytes = unhex(fixture.commandsHex), result = decodeProductionSubmission(bytes);
    need(result.ok, 'complete captured job ' + fixture.traceLine + ': ' + JSON.stringify(result.error));
    need(result.commands.length === fixture.packetCount, 'complete captured packet count');
    const copies = result.commands.filter(command => command.opcode === 17);
    need(copies.length === 1, 'one original base image copy');
    const copy = copies[0], {source, destination} = copy.fields;
    need(source.width === 1422 && source.height === 800 && source.depth === 1, 'original full source plane');
    need(source.level === 0 && destination.level === 0 && destination.resourceHandle === source.resourceHandle + 1,
      'original source and destination identities and levels');
    const packet = bytes.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
    need(decodeStandardStreamOutputSubmission(packet).ok === false, 'historical facet does not admit new copy command');
    reject(packet.slice(0, -4), 'truncated original copy');
    reject(changed(packet, 0, (13 << 16) | (1 << 8) | 17), 'nonzero object type');
    for (const index of [1, 6]) reject(changed(packet, index, 0), 'zero resource handle ' + index);
    for (const index of [11, 12, 13]) for (const value of [0, 0x80000000, 0xffffffff])
      reject(changed(packet, index, value), 'nonpositive extent ' + index + '/' + value);
    const extra = new Uint8Array(packet.length + 4); extra.set(packet);
    new DataView(extra.buffer).setUint32(0, (14 << 16) | 17, true); reject(extra, 'extra payload dword');
    for (const offset of [1, 7, 13]) {
      const enclosing = new Uint8Array(bytes.length + offset + 3).fill(0x9b); enclosing.set(bytes, offset);
      const selected = decodeProductionSubmission(enclosing.subarray(offset, offset + bytes.length));
      need(selected.ok && selected.commands.length === fixture.packetCount, 'exact nonzero host byte view ' + offset);
    }
    jobs.push({traceLine: fixture.traceLine, packets: result.commands.length, copyOffset: copy.byteOffset,
      mipBlits: result.commands.filter(command => command.opcode === 16).length});
  }
  return {status: 'passed', assertions, jobs};
}
