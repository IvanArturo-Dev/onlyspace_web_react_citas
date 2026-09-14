// Mock the Prisma service so the module import does not open a real connection.
jest.mock('../../database/prisma.service', () => ({
  prisma: {
    tenant: {
      findUnique: jest.fn(),
    },
  },
}));

import {
  BOOKING_CODE_ALPHABET,
  BOOKING_CODE_LENGTH,
  generateBookingCode,
  normalizeBookingCode,
  assignUniqueBookingCode,
} from '../bookingCode';

// Property 3: Unicidad y formato del codigo
// Validates: Requirements 2.1, 2.2, 10.4
describe('bookingCode utility', () => {
  describe('generateBookingCode - formato', () => {
    const AMBIGUOUS = ['O', '0', 'I', '1'];
    const allowed = new Set(BOOKING_CODE_ALPHABET.split(''));

    it('siempre devuelve un codigo de longitud fija con caracteres del alfabeto permitido', () => {
      for (let i = 0; i < 1000; i++) {
        const code = generateBookingCode();

        // Longitud siempre 6.
        expect(code).toHaveLength(BOOKING_CODE_LENGTH);

        for (const ch of code) {
          // Todo caracter pertenece al alfabeto permitido.
          expect(allowed.has(ch)).toBe(true);
          // Nunca aparecen caracteres ambiguos.
          expect(AMBIGUOUS).not.toContain(ch);
        }
      }
    });

    it('el alfabeto no contiene caracteres ambiguos', () => {
      for (const ch of AMBIGUOUS) {
        expect(BOOKING_CODE_ALPHABET).not.toContain(ch);
      }
    });
  });

  describe('normalizeBookingCode', () => {
    it('recorta espacios y convierte a mayusculas', () => {
      expect(normalizeBookingCode('  ab3k9p ')).toBe('AB3K9P');
    });

    it('convierte minusculas a mayusculas', () => {
      expect(normalizeBookingCode('xyz789')).toBe('XYZ789');
    });

    it('es case-insensitive: la misma cadena en distinta caja normaliza igual', () => {
      expect(normalizeBookingCode('Ab3K9p')).toBe(normalizeBookingCode('aB3k9P'));
      expect(normalizeBookingCode(' ab3k9p ')).toBe(normalizeBookingCode('AB3K9P'));
    });
  });

  describe('assignUniqueBookingCode', () => {
    const allowed = new Set(BOOKING_CODE_ALPHABET.split(''));

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('reintenta ante colision y devuelve un codigo valido', async () => {
      const findUnique = jest
        .fn()
        // Primera consulta: colision (tenant existente).
        .mockResolvedValueOnce({ id: 'tenant-1', booking_code: 'ABCDEF' })
        // Segunda consulta: codigo libre.
        .mockResolvedValueOnce(null);

      const mockClient = { tenant: { findUnique } } as any;

      const code = await assignUniqueBookingCode(mockClient);

      expect(code).toHaveLength(BOOKING_CODE_LENGTH);
      for (const ch of code) {
        expect(allowed.has(ch)).toBe(true);
      }
      expect(findUnique.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('devuelve el primer codigo cuando no hay colision', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const mockClient = { tenant: { findUnique } } as any;

      const code = await assignUniqueBookingCode(mockClient);

      expect(code).toHaveLength(BOOKING_CODE_LENGTH);
      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it('lanza un Error si nunca encuentra un codigo libre (agotamiento)', async () => {
      const findUnique = jest
        .fn()
        .mockResolvedValue({ id: 'tenant-x', booking_code: 'ABCDEF' });
      const mockClient = { tenant: { findUnique } } as any;

      await expect(assignUniqueBookingCode(mockClient)).rejects.toThrow(
        /codigo de negocio unico/i
      );
    });
  });
});
