// LZ-based string compression (UTF-16 safe) so large world saves fit in
// localStorage. Implementation follows the well known LZString algorithm.

const f = String.fromCharCode;

function _compress(uncompressed: string, bitsPerChar: number, getCharFromInt: (n: number) => string): string {
  if (uncompressed == null) return '';
  let i: number, value: number;
  const dictionary: Record<string, number> = {};
  const dictionaryToCreate: Record<string, boolean> = {};
  let c = '', wc = '', w = '';
  let enlargeIn = 2, dictSize = 3, numBits = 2;
  const data: string[] = [];
  let dataVal = 0, dataPosition = 0;

  const writeBit = (bit: number) => {
    dataVal = (dataVal << 1) | bit;
    if (dataPosition === bitsPerChar - 1) {
      dataPosition = 0;
      data.push(getCharFromInt(dataVal));
      dataVal = 0;
    } else dataPosition++;
  };
  const writeBits = (n: number, v: number) => {
    for (let k = 0; k < n; k++) {
      writeBit(v & 1);
      v >>= 1;
    }
  };

  for (let ii = 0; ii < uncompressed.length; ii++) {
    c = uncompressed.charAt(ii);
    if (!Object.prototype.hasOwnProperty.call(dictionary, c)) {
      dictionary[c] = dictSize++;
      dictionaryToCreate[c] = true;
    }
    wc = w + c;
    if (Object.prototype.hasOwnProperty.call(dictionary, wc)) {
      w = wc;
    } else {
      if (Object.prototype.hasOwnProperty.call(dictionaryToCreate, w)) {
        if (w.charCodeAt(0) < 256) {
          writeBits(numBits, 0);
          writeBits(8, w.charCodeAt(0));
        } else {
          writeBits(numBits, 1);
          writeBits(16, w.charCodeAt(0));
        }
        enlargeIn--;
        if (enlargeIn === 0) {
          enlargeIn = Math.pow(2, numBits);
          numBits++;
        }
        delete dictionaryToCreate[w];
      } else {
        writeBits(numBits, dictionary[w]);
      }
      enlargeIn--;
      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
      dictionary[wc] = dictSize++;
      w = String(c);
    }
  }
  if (w !== '') {
    if (Object.prototype.hasOwnProperty.call(dictionaryToCreate, w)) {
      if (w.charCodeAt(0) < 256) {
        writeBits(numBits, 0);
        writeBits(8, w.charCodeAt(0));
      } else {
        writeBits(numBits, 1);
        writeBits(16, w.charCodeAt(0));
      }
      enlargeIn--;
      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
      delete dictionaryToCreate[w];
    } else {
      writeBits(numBits, dictionary[w]);
    }
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
  }
  value = 2;
  writeBits(numBits, value);
  // flush
  for (;;) {
    dataVal = dataVal << 1;
    if (dataPosition === bitsPerChar - 1) {
      data.push(getCharFromInt(dataVal));
      break;
    } else dataPosition++;
  }
  void i!;
  return data.join('');
}

function _decompress(length: number, resetValue: number, getNextValue: (i: number) => number): string | null {
  const dictionary: string[] = [];
  let enlargeIn = 4, dictSize = 4, numBits = 3;
  let entry = '';
  const result: string[] = [];
  let w: string, c: string | number;
  const data = { val: getNextValue(0), position: resetValue, index: 1 };

  const readBits = (n: number) => {
    let bits = 0, maxpower = Math.pow(2, n), power = 1;
    while (power !== maxpower) {
      const resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }
    return bits;
  };

  for (let i = 0; i < 3; i++) dictionary[i] = String(i);
  const next = readBits(2);
  switch (next) {
    case 0: c = f(readBits(8)); break;
    case 1: c = f(readBits(16)); break;
    case 2: return '';
    default: return null;
  }
  dictionary[3] = c;
  w = c;
  result.push(c);
  for (;;) {
    if (data.index > length) return '';
    let cc = readBits(numBits);
    switch (cc) {
      case 0:
        dictionary[dictSize++] = f(readBits(8));
        cc = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        dictionary[dictSize++] = f(readBits(16));
        cc = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join('');
    }
    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
    if (dictionary[cc]) {
      entry = dictionary[cc];
    } else if (cc === dictSize) {
      entry = w + w.charAt(0);
    } else {
      return null;
    }
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
  }
}

export function compressToUTF16(input: string): string {
  return _compress(input, 15, (a) => f(a + 32)) + ' ';
}

export function decompressFromUTF16(compressed: string): string | null {
  if (!compressed) return '';
  return _decompress(compressed.length, 16384, (index) => compressed.charCodeAt(index) - 32);
}
