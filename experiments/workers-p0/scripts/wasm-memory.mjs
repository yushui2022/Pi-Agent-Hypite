// Inspect declared linear memory without instantiating the media engine.
export function wasmMemories(bytes) {
  if (bytes.length < 8 || Buffer.from(bytes.subarray(0, 8)).toString('hex') !== '0061736d01000000') throw new Error('Invalid Wasm header');
  let offset = 8;
  const integer = () => {
    let result = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      if (offset >= bytes.length) throw new Error('Truncated Wasm integer');
      const value = bytes[offset++];
      result += (value & 0x7f) * 2 ** shift;
      if (!(value & 0x80)) return result;
    }
    throw new Error('Invalid Wasm integer');
  };
  while (offset < bytes.length) {
    const section = bytes[offset++];
    const length = integer();
    const end = offset + length;
    if (end > bytes.length) throw new Error('Truncated Wasm section');
    if (section === 5) {
      const count = integer();
      if (count !== 1) throw new Error('Expected exactly one declared memory');
      const flags = integer();
      if (flags & ~3) throw new Error('Unsupported Wasm memory flags');
      const initialPages = integer();
      const maximumPages = flags & 1 ? integer() : null;
      if (offset !== end) throw new Error('Invalid Wasm memory section');
      return [{ initialBytes: initialPages * 65536, maximumBytes: maximumPages === null ? null : maximumPages * 65536, shared: Boolean(flags & 2) }];
    }
    offset = end;
  }
  throw new Error('A self-contained declared memory is required');
}
