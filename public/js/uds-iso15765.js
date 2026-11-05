export function normalizeHex(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-F]/g, '');
}

export function hexToBytes(hex) {
  const clean = normalizeHex(hex);
  if (!clean) return new Uint8Array(0);
  if (clean.length % 2 !== 0) {
    throw new Error('Hex invalide : longueur impaire');
  }

  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bytes, spaced = true) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0').toUpperCase());
  return spaced ? hex.join(' ') : hex.join('');
}

export function parseElmHex(text) {
  const upper = String(text || '').toUpperCase();

  const cleaned = upper
    .replace(/ELM327[^\r\n]*/g, ' ')
    .replace(/BUS INIT[^\r\n]*/g, ' ')
    .replace(/SEARCHING[^\r\n]*/g, ' ')
    .replace(/DATA[^\r\n]*/g, ' ')
    .replace(/MESSAGE[^\r\n]*/g, ' ')
    .replace(/TIMEOUT[^\r\n]*/g, ' ')
    .replace(/NO RESPONSE[^\r\n]*/g, ' ')
    .replace(/\?/g, ' ');

  const contiguous = cleaned.match(/[0-9A-F]{2,}/g) || [];
  let hex = contiguous.filter(s => s.length % 2 === 0).join('');

  if (!hex) {
    const tokens = upper.match(/\b[0-9A-F]{2}\b/g) || [];
    hex = tokens.join('');
  }

  return hex;
}

export const NRC_DESCRIPTIONS = {
  0x10: 'General reject',
  0x11: 'Service not supported',
  0x12: 'Sub-function not supported',
  0x13: 'Incorrect message length or invalid format',
  0x22: 'Conditions not correct',
  0x24: 'Request sequence error',
  0x25: 'No key from output',
  0x26: 'Invalid key',
  0x27: 'Exceed number of attempts',
  0x28: 'Required time delay not expired',
  0x31: 'Request out of range',
  0x33: 'Security access denied',
  0x35: 'Invalid key',
  0x36: 'Exceed number of attempts',
  0x37: 'Required time delay not expired',
  0x70: 'Upload/download not accepted',
  0x71: 'Transfer data suspended',
  0x73: 'General programming failure',
  0x78: 'Request correctly received - response pending'
};

export function describeNrc(nrc) {
  const value = typeof nrc === 'number' ? nrc : parseInt(String(nrc), 16);
  return NRC_DESCRIPTIONS[value] || `NRC inconnu 0x${(value || 0).toString(16).toUpperCase().padStart(2, '0')}`;
}

export class IsoTpCodec {
  static encode(payload, opts = {}) {
    const bytes = payload instanceof Uint8Array ? payload : hexToBytes(payload);
    const txId = opts.txId || '7E0';
    const padding = parseInt(opts.padding || 'CC', 16);
    const maxLength = opts.maxLength || 8;
    const frames = [];

    if (bytes.length <= maxLength - 1) {
      const data = new Uint8Array(maxLength).fill(padding);
      data[0] = bytes.length;
      data.set(bytes, 1);
      frames.push({ id: txId, type: 'single', data });
      return frames;
    }

    const totalLength = bytes.length;
    const first = new Uint8Array(maxLength).fill(padding);
    first[0] = 0x10 | ((totalLength >> 8) & 0x0F);
    first[1] = totalLength & 0xFF;
    first.set(bytes.slice(0, maxLength - 2), 2);
    frames.push({ id: txId, type: 'first', data: first });

    let offset = maxLength - 2;
    let sequence = 1;

    while (offset < totalLength) {
      const frame = new Uint8Array(maxLength).fill(padding);
      const chunk = bytes.slice(offset, offset + maxLength - 1);
      frame[0] = 0x20 | (sequence & 0x0F);
      frame.set(chunk, 1);
      frames.push({ id: txId, type: 'consecutive', data: frame });
      offset += chunk.length;
      sequence = (sequence + 1) & 0x0F;
    }

    return frames;
  }

  static decode(frames) {
    if (!frames || !frames.length) return new Uint8Array(0);

    const first = frames[0];
    const pci = first.data[0];
    const type = (pci >> 4) & 0x0F;

    if (type === 0) {
      const len = pci & 0x0F;
      return first.data.slice(1, 1 + len);
    }

    if (type === 1) {
      const len = ((pci & 0x0F) << 8) | first.data[1];
      let out = Array.from(first.data.slice(2));
      let expected = 1;

      for (const frame of frames.slice(1)) {
        const seq = frame.data[0] & 0x0F;
        if (seq !== expected) break;
        out.push(...frame.data.slice(1));
        expected = (expected + 1) & 0x0F;
        if (out.length >= len) break;
      }

      return new Uint8Array(out.slice(0, len));
    }

    return new Uint8Array(0);
  }
}

export class ElmUdsChannel {
  constructor({ sendAt, sleep = ms => new Promise(r => setTimeout(r, ms)), timeout = 5000 } = {}) {
    if (typeof sendAt !== 'function') {
      throw new Error('ElmUdsChannel nécessite sendAt()');
    }

    this.sendAt = sendAt;
    this.sleep = sleep;
    this.timeout = timeout;
    this.lastTx = null;
    this.lastConfig = null;
  }

  async configure(txId, opts = {}) {
    const config = {
      protocol: opts.protocol ?? 6,
      padding: opts.padding || 'CC',
      blockSize: opts.blockSize ?? 0,
      stMin: opts.stMin ?? 0
    };

    const signature = `${txId}|${config.protocol}|${config.padding}|${config.blockSize}|${config.stMin}`;

    if (this.lastTx === txId && this.lastConfig === signature) return;

    await this.sendAt(`ATSP ${config.protocol}`);
    await this.sendAt(`ATSH ${txId}`);
    await this.sendAt(`ATFC SD ${config.blockSize} ${config.stMin}`);
    await this.sendAt('ATCAF 0');
    await this.sendAt(`ATCP ${config.padding}`);

    this.lastTx = txId;
    this.lastConfig = signature;
  }

  async request(txId, payloadHex, opts = {}) {
    await this.configure(txId, opts);

    const payload = normalizeHex(payloadHex);
    if (!payload) throw new Error('Payload UDS vide');

    const raw = await this.sendAt(payload);
    const hex = parseElmHex(raw);

    if (!hex) {
      throw new Error(`Réponse ELM vide ou non hex : ${String(raw).slice(0, 160)}`);
    }

    const bytes = hexToBytes(hex);

    if (bytes[0] === 0x7F) {
      const rejectedService = bytes[1];
      const nrc = bytes[2];
      const message = `NRC 0x${(nrc || 0).toString(16).toUpperCase().padStart(2, '0')} sur service 0x${(rejectedService || 0).toString(16).toUpperCase().padStart(2, '0')} : ${describeNrc(nrc)}`;

      if (nrc === 0x78) {
        throw new Error(`Réponse pendante non supportée automatiquement par ce canal : ${message}`);
      }

      throw new Error(message);
    }

    return bytes;
  }
}
