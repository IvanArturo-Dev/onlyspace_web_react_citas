import { encrypt, decrypt } from '../crypto';

/**
 * Unit tests para la utilidad de cifrado de tokens (AES-256-GCM).
 *
 * Cubre round-trip, no-reversibilidad aparente (ciphertext != plaintext),
 * IV aleatorio por llamada, verificacion de integridad (authTag) y validacion
 * de la clave de entorno.
 *
 * **Validates: Requirements 5.1**
 */

// Clave de prueba de 32 bytes en base64 (solo para tests).
const TEST_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
// Misma longitud pero en hex (32 bytes -> 64 hex chars).
const TEST_KEY_HEX = Buffer.alloc(32, 9).toString('hex');

describe('crypto util (AES-256-GCM)', () => {
  const originalKey = process.env.GOOGLE_TOKEN_ENC_KEY;

  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENC_KEY = TEST_KEY_BASE64;
  });

  afterAll(() => {
    if (originalKey === undefined) {
      delete process.env.GOOGLE_TOKEN_ENC_KEY;
    } else {
      process.env.GOOGLE_TOKEN_ENC_KEY = originalKey;
    }
  });

  it('round-trip: decrypt(encrypt(x)) devuelve el original', () => {
    const plaintext = 'refresh-token-secreto-123';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('round-trip funciona con cadena vacia y unicode', () => {
    for (const plaintext of ['', 'ñ-áé-💾-token', 'a'.repeat(4096)]) {
      expect(decrypt(encrypt(plaintext))).toBe(plaintext);
    }
  });

  it('el ciphertext difiere del texto plano', () => {
    const plaintext = 'un-token-cualquiera';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.includes(plaintext)).toBe(false);
  });

  it('dos cifrados del mismo texto producen salidas distintas (IV aleatorio)', () => {
    const plaintext = 'mismo-texto';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    // Ambos siguen descifrando al mismo original.
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('acepta la clave en formato hex', () => {
    process.env.GOOGLE_TOKEN_ENC_KEY = TEST_KEY_HEX;
    const plaintext = 'token-con-clave-hex';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('decrypt con authTag manipulado lanza error', () => {
    const encrypted = encrypt('token-integro');
    const [iv, authTag, data] = encrypted.split(':');
    // Alteramos el authTag por otro valido en longitud pero distinto.
    const tamperedTag = Buffer.alloc(16, 1).toString('base64');
    const tampered = [iv, tamperedTag, data].join(':');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('decrypt con ciphertext manipulado lanza error', () => {
    const encrypted = encrypt('token-integro');
    const [iv, authTag, data] = encrypted.split(':');
    const dataBuf = Buffer.from(data, 'base64');
    dataBuf[0] = dataBuf[0] ^ 0xff; // flip de un byte
    const tampered = [iv, authTag, dataBuf.toString('base64')].join(':');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('decrypt con formato invalido lanza error', () => {
    expect(() => decrypt('esto-no-tiene-formato')).toThrow(/formato/i);
  });

  it('encrypt sin GOOGLE_TOKEN_ENC_KEY lanza error claro', () => {
    delete process.env.GOOGLE_TOKEN_ENC_KEY;
    expect(() => encrypt('x')).toThrow(/GOOGLE_TOKEN_ENC_KEY/);
  });

  it('encrypt con clave de longitud invalida lanza error claro', () => {
    process.env.GOOGLE_TOKEN_ENC_KEY = Buffer.alloc(16, 3).toString('base64');
    expect(() => encrypt('x')).toThrow(/32 bytes/);
  });
});
