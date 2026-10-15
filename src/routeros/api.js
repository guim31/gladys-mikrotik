// -----------------------------------------------------------------------------
// The RouterOS API protocol (help.mikrotik.com, "API"), for RouterOS 6 and 7:
// a TCP connection on port 8728, or TLS on 8729 (`api-ssl` service).
// Written from the official documentation.
//
//   - A *word* is a length then that many bytes (UTF-8 here). The length is
//     1 to 5 bytes: < 0x80 on one byte, < 0x4000 on two with 0x8000 set,
//     < 0x200000 on three with 0xC00000 set, < 0x10000000 on four with
//     0xE0000000 set, else 0xF0 then four bytes.
//   - A *sentence* is words ended by an empty word (a zero byte). The first
//     word of a command is its path (`/interface/print`), then attributes
//     (`=name=value`, `=.proplist=a,b`).
//   - Replies: `!re` (one item), `!done` (end, may carry `=ret=`), `!trap`
//     (error, `=message=`, followed by `!done`), `!fatal` (the router closes
//     the connection), `!empty` (RouterOS 7.18+: no item, then `!done`).
//   - Login (6.43+): `/login =name= =password=` → `!done`. Before 6.43 the
//     router answers `!done =ret=<challenge>` instead, and expects
//     `/login =name= =response=00<md5(0x00 + password + challenge)>`.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { ERROR_KINDS, RouterOsError, kindOfMessage, networkError } from './errors.js';

/** Encode the length of a word. */
export function encodeLength(length) {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  if (length < 0x4000) {
    const value = length | 0x8000;
    return Buffer.from([(value >> 8) & 0xff, value & 0xff]);
  }
  if (length < 0x200000) {
    const value = length | 0xc00000;
    return Buffer.from([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
  }
  if (length < 0x10000000) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32BE((length | 0xe0000000) >>> 0);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = 0xf0;
  buffer.writeUInt32BE(length >>> 0, 1);
  return buffer;
}

/** Encode a sentence: its words, then the empty word. */
export function encodeSentence(words) {
  const parts = [];
  for (const word of words) {
    const bytes = Buffer.from(word, 'utf8');
    parts.push(encodeLength(bytes.length), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/**
 * Decode the length at `offset`.
 * @returns {{ length: number, size: number }|null} null when more bytes are needed
 */
export function decodeLength(buffer, offset) {
  if (offset >= buffer.length) {
    return null;
  }
  const first = buffer[offset];
  let size;
  let length;
  if ((first & 0x80) === 0) {
    return { length: first, size: 1 };
  }
  if ((first & 0xc0) === 0x80) {
    size = 2;
    length = first & 0x3f;
  } else if ((first & 0xe0) === 0xc0) {
    size = 3;
    length = first & 0x1f;
  } else if ((first & 0xf0) === 0xe0) {
    size = 4;
    length = first & 0x0f;
  } else if (first === 0xf0) {
    if (offset + 5 > buffer.length) {
      return null;
    }
    return { length: buffer.readUInt32BE(offset + 1), size: 5 };
  } else {
    // 0xF8 and above are control bytes the API never sends.
    throw new RouterOsError(
      ERROR_KINDS.PROTOCOL,
      `API: invalid length byte 0x${first.toString(16)}`,
    );
  }
  if (offset + size > buffer.length) {
    return null;
  }
  for (let i = 1; i < size; i += 1) {
    length = length * 256 + buffer[offset + i];
  }
  return { length, size };
}

/** Accumulates the bytes of a connection and cuts them into sentences. */
export class SentenceReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.words = [];
  }

  /**
   * @param {Buffer} chunk
   * @returns {string[][]} the sentences completed by this chunk
   */
  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const sentences = [];
    let offset = 0;
    for (;;) {
      const header = decodeLength(this.buffer, offset);
      if (!header || offset + header.size + header.length > this.buffer.length) {
        break;
      }
      const start = offset + header.size;
      offset = start + header.length;
      if (header.length === 0) {
        if (this.words.length) {
          sentences.push(this.words);
        }
        this.words = [];
        continue;
      }
      this.words.push(this.buffer.toString('utf8', start, offset));
    }
    this.buffer = this.buffer.subarray(offset);
    return sentences;
  }
}

/** `=key=value` words of a reply into an object (the value may contain `=`). */
export function attributes(words) {
  const result = {};
  for (const word of words) {
    if (!word.startsWith('=')) {
      continue; // `.tag=`, unknown words
    }
    const separator = word.indexOf('=', 1);
    if (separator === -1) {
      result[word.slice(1)] = '';
    } else {
      result[word.slice(1, separator)] = word.slice(separator + 1);
    }
  }
  return result;
}

/** The pre-6.43 challenge answer. */
export function challengeResponse(password, challengeHex) {
  const hash = createHash('md5')
    .update(Buffer.from([0]))
    .update(Buffer.from(password, 'utf8'))
    .update(Buffer.from(challengeHex, 'hex'))
    .digest('hex');
  return `00${hash}`;
}

// API-SSL without a certificate (the RouterOS default of the service) only
// offers anonymous Diffie-Hellman suites, which OpenSSL disables by default.
// Offered only when the user accepts unverified certificates: an anonymous
// suite authenticates the router no better than a self-signed certificate.
const ANONYMOUS_SUITES =
  'DEFAULT:ADH-AES256-GCM-SHA384:ADH-AES128-GCM-SHA256:ADH-AES256-SHA256:ADH-AES128-SHA256:@SECLEVEL=0';

/** TLS options of an API-SSL connection. */
export function tlsOptions({ host, insecure }) {
  return {
    rejectUnauthorized: !insecure,
    ...(net.isIP(host) ? {} : { servername: host }),
    ...(insecure ? { ciphers: ANONYMOUS_SUITES, maxVersion: 'TLSv1.2' } : {}),
  };
}

/** Open the socket (the tests replace it). */
export function connectSocket({ host, port, secure, insecure }) {
  return secure
    ? tls.connect({ host, port, ...tlsOptions({ host, insecure }) })
    : net.connect({ host, port });
}

export class ApiTransport {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} options.port
   * @param {boolean} options.secure API-SSL
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {string} options.username
   * @param {string} options.password
   * @param {Function} [options.connect] socket seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ host, port, secure, insecure = false, username, password, connect, timeoutMs }) {
    this.host = host;
    this.port = port;
    this.secure = secure;
    this.insecure = insecure;
    this.username = username;
    this.password = password;
    this.connect = connect ?? connectSocket;
    this.timeoutMs = timeoutMs ?? 10_000;
    this.label = secure ? 'API-SSL' : 'API';
    this.protocol = secure ? 'api_ssl' : 'api';
    this.socket = null;
    this.opening = null;
    this.queue = Promise.resolve();
    this.pending = null;
  }

  /** Connect and log in, once; later calls share the same session. */
  open() {
    if (this.socket) {
      return Promise.resolve();
    }
    this.opening ??= this.openSession().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  async openSession() {
    const socket = await new Promise((resolve, reject) => {
      let settled = false;
      const socketTimer = setTimeout(() => {
        fail(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' }));
      }, this.timeoutMs);
      const fail = (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(socketTimer);
          candidate.destroy();
          reject(networkError(err, this.label));
        }
      };
      const candidate = this.connect({
        host: this.host,
        port: this.port,
        secure: this.secure,
        insecure: this.insecure,
      });
      candidate.once('error', fail);
      candidate.once(this.secure ? 'secureConnect' : 'connect', () => {
        if (!settled) {
          settled = true;
          clearTimeout(socketTimer);
          candidate.removeListener('error', fail);
          resolve(candidate);
        }
      });
    });
    this.attach(socket);
    try {
      await this.login();
    } catch (err) {
      this.drop(err);
      throw err;
    }
  }

  attach(socket) {
    this.socket = socket;
    const reader = new SentenceReader();
    socket.on('data', (chunk) => {
      let sentences;
      try {
        sentences = reader.push(chunk);
      } catch (err) {
        this.drop(err);
        return;
      }
      for (const sentence of sentences) {
        this.receive(sentence);
      }
    });
    socket.on('error', (err) => this.drop(networkError(err, this.label)));
    socket.on('close', () =>
      this.drop(new RouterOsError(ERROR_KINDS.UNREACHABLE, `${this.label}: connection closed`)),
    );
  }

  /** The connection is gone: fail the command in progress, forget the socket. */
  drop(err) {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners('data');
      socket.destroy();
    }
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      // A refusal received just before the router hung up says more.
      pending.reject(pending.trap ?? err);
    }
  }

  receive(words) {
    const pending = this.pending;
    if (!pending) {
      return; // nothing asked: an unsolicited reply
    }
    const [type, ...rest] = words;
    if (type === '!re') {
      pending.items.push(attributes(rest));
    } else if (type === '!trap') {
      const { message = '' } = attributes(rest);
      pending.trap ??= new RouterOsError(
        kindOfMessage(message),
        `${this.label}: ${message.slice(0, 200) || 'refused'}`,
      );
    } else if (type === '!fatal') {
      this.drop(
        new RouterOsError(
          ERROR_KINDS.PROTOCOL,
          `${this.label}: fatal: ${rest.join(' ').slice(0, 200)}`,
        ),
      );
    } else if (type === '!done') {
      this.pending = null;
      clearTimeout(pending.timer);
      if (pending.trap) {
        pending.reject(pending.trap);
      } else {
        pending.resolve({ items: pending.items, done: attributes(rest) });
      }
    }
    // `!empty` (no item) and unknown reply words: wait for `!done`.
  }

  /** Send one sentence and collect its replies; one command at a time. */
  talk(words, timeoutMs = this.timeoutMs) {
    const run = this.queue.then(
      () =>
        new Promise((resolve, reject) => {
          if (!this.socket) {
            reject(new RouterOsError(ERROR_KINDS.UNREACHABLE, `${this.label}: not connected`));
            return;
          }
          const timer = setTimeout(() => {
            this.drop(
              new RouterOsError(
                ERROR_KINDS.UNREACHABLE,
                `${this.label}: no answer after ${timeoutMs} ms`,
              ),
            );
          }, timeoutMs);
          this.pending = { resolve, reject, items: [], trap: null, timer };
          this.socket.write(encodeSentence(words));
        }),
    );
    this.queue = run.catch(() => {});
    return run;
  }

  async login() {
    const first = await this.talk([
      '/login',
      `=name=${this.username}`,
      `=password=${this.password}`,
    ]);
    if (first.done.ret) {
      // RouterOS before 6.43: answer the challenge.
      await this.talk([
        '/login',
        `=name=${this.username}`,
        `=response=${challengeResponse(this.password, first.done.ret)}`,
      ]);
    }
  }

  async command(words, timeoutMs) {
    await this.open();
    return this.talk(words, timeoutMs);
  }

  /**
   * List a menu (`/interface`, `/ip/arp`…).
   * @param {string} menu
   * @param {{ proplist?: string[] }} [options]
   * @returns {Promise<object[]>}
   */
  async print(menu, { proplist } = {}) {
    const words = [`${menu}/print`];
    if (proplist?.length) {
      words.push(`=.proplist=${proplist.join(',')}`);
    }
    const { items } = await this.command(words);
    return items;
  }

  /**
   * Run a command of a menu (`/system/reboot`, `/ip/firewall/filter/set`).
   * @param {string} menu
   * @param {string} command
   * @param {Record<string, string>} [params]
   * @param {{ timeoutMs?: number }} [options]
   */
  async run(menu, command, params = {}, { timeoutMs } = {}) {
    const words = [`${menu}/${command}`];
    for (const [key, value] of Object.entries(params)) {
      words.push(`=${key}=${value}`);
    }
    const { items } = await this.command(words, timeoutMs);
    return items;
  }

  async close() {
    if (this.socket) {
      this.socket.end();
      this.drop(new RouterOsError(ERROR_KINDS.UNREACHABLE, `${this.label}: connection closed`));
    }
  }
}
