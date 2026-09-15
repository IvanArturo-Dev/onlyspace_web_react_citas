import { HttpError } from '../errors';
import {
  normalizeModality,
  parseOfferedModalities,
  validateOfferedModalitiesArray,
  assertModalityOffered,
  assertBookingContact,
} from '../modality';

/**
 * Unit tests para utils/modality.ts (Task 2.1).
 *
 * Cubren: normalizeModality (tres valores), parseOfferedModalities (CSV/array/
 * legacy 'both'/vacio), validateOfferedModalitiesArray (validacion estricta del
 * array del panel), assertModalityOffered (permitido/rechazado y compat legacy)
 * y assertBookingContact (telefono obligatorio + domicilio con direccion+maps).
 *
 * **Validates: Requirements 1.1, 1.3, 2.1, 2.2, 2.4, 2.5, 3.1, 3.3, 3.4**
 */

describe('normalizeModality', () => {
  it("devuelve 'online' solo para el valor exacto 'online'", () => {
    expect(normalizeModality('online')).toBe('online');
  });

  it("devuelve 'home' para el valor exacto 'home'", () => {
    expect(normalizeModality('home')).toBe('home');
  });

  it("normaliza 'in_person' a 'in_person'", () => {
    expect(normalizeModality('in_person')).toBe('in_person');
  });

  it("normaliza valores desconocidos/null/undefined a 'in_person'", () => {
    expect(normalizeModality('telepatia')).toBe('in_person');
    expect(normalizeModality(null)).toBe('in_person');
    expect(normalizeModality(undefined)).toBe('in_person');
  });
});

describe('parseOfferedModalities', () => {
  it('parsea un CSV a lista de modalidades', () => {
    expect(parseOfferedModalities('in_person,home')).toEqual([
      'in_person',
      'home',
    ]);
  });

  it('acepta un array de modalidades', () => {
    expect(parseOfferedModalities(['online', 'home'])).toEqual([
      'online',
      'home',
    ]);
  });

  it('recorta espacios y elimina duplicados conservando el orden', () => {
    expect(parseOfferedModalities(' online , online , in_person ')).toEqual([
      'online',
      'in_person',
    ]);
  });

  it('descarta valores fuera del set permitido', () => {
    expect(parseOfferedModalities('home,telepatia,online')).toEqual([
      'home',
      'online',
    ]);
  });

  it("mapea el legacy 'both' a [in_person, online]", () => {
    expect(parseOfferedModalities('both')).toEqual(['in_person', 'online']);
    expect(parseOfferedModalities('  both  ')).toEqual(['in_person', 'online']);
  });

  it("cae a ['in_person'] con null, undefined, vacio o solo desconocidos", () => {
    expect(parseOfferedModalities(null)).toEqual(['in_person']);
    expect(parseOfferedModalities(undefined)).toEqual(['in_person']);
    expect(parseOfferedModalities('')).toEqual(['in_person']);
    expect(parseOfferedModalities('telepatia')).toEqual(['in_person']);
    expect(parseOfferedModalities([])).toEqual(['in_person']);
  });
});

describe('validateOfferedModalitiesArray', () => {
  it('devuelve la lista deduplicada para un array valido', () => {
    expect(
      validateOfferedModalitiesArray(['in_person', 'home', 'home'])
    ).toEqual(['in_person', 'home']);
  });

  it('lanza 400 VALIDATION_ERROR si no es array o esta vacio', () => {
    expect(() => validateOfferedModalitiesArray([])).toThrow(HttpError);
    expect(() => validateOfferedModalitiesArray('in_person')).toThrow(
      HttpError
    );
    try {
      validateOfferedModalitiesArray([]);
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(400);
      expect((e as HttpError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('lanza 400 VALIDATION_ERROR si algun valor es invalido', () => {
    expect(() =>
      validateOfferedModalitiesArray(['in_person', 'telepatia'])
    ).toThrow(HttpError);
  });
});

describe('assertModalityOffered', () => {
  it('permite la modalidad cuando esta en la lista ofrecida (CSV)', () => {
    expect(() =>
      assertModalityOffered('in_person,home', 'home')
    ).not.toThrow();
  });

  it('permite la modalidad cuando esta en la lista ofrecida (array)', () => {
    expect(() =>
      assertModalityOffered(['online', 'home'], 'online')
    ).not.toThrow();
  });

  it('rechaza con 400 MODALITY_NOT_OFFERED cuando no esta ofrecida', () => {
    try {
      assertModalityOffered('in_person,online', 'home');
      throw new Error('deberia haber lanzado');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).statusCode).toBe(400);
      expect((e as HttpError).code).toBe('MODALITY_NOT_OFFERED');
    }
  });

  it("mantiene compat legacy: 'both' permite in_person y online", () => {
    expect(() => assertModalityOffered('both', 'online')).not.toThrow();
    expect(() => assertModalityOffered('both', 'in_person')).not.toThrow();
  });

  it("rechaza 'home' cuando el negocio ofrece legacy 'both'", () => {
    expect(() => assertModalityOffered('both', 'home')).toThrow(HttpError);
  });

  it("un offered ausente/desconocido equivale a ['in_person']", () => {
    expect(() => assertModalityOffered(undefined, 'in_person')).not.toThrow();
    expect(() => assertModalityOffered(null, 'online')).toThrow(HttpError);
  });
});

describe('assertBookingContact', () => {
  it('acepta cuando hay telefono y la modalidad no es home', () => {
    expect(() =>
      assertBookingContact({ modality: 'in_person', contact_phone: '55512345' })
    ).not.toThrow();
  });

  it('no exige direccion/maps cuando la modalidad no es home', () => {
    expect(() =>
      assertBookingContact({
        modality: 'online',
        contact_phone: '55512345',
        home_address: null,
        maps_url: null,
      })
    ).not.toThrow();
  });

  it('lanza 400 CONTACT_PHONE_REQUIRED cuando falta el telefono', () => {
    for (const phone of [undefined, null, '', '   ']) {
      try {
        assertBookingContact({ modality: 'in_person', contact_phone: phone });
        throw new Error('deberia haber lanzado');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).statusCode).toBe(400);
        expect((e as HttpError).code).toBe('CONTACT_PHONE_REQUIRED');
      }
    }
  });

  it('acepta una cita a domicilio con direccion y URL de maps valida', () => {
    expect(() =>
      assertBookingContact({
        modality: 'home',
        contact_phone: '55512345',
        home_address: 'Calle Falsa 123',
        maps_url: 'https://maps.google.com/?q=19.4,-99.1',
      })
    ).not.toThrow();
  });

  it('lanza 400 HOME_DETAILS_REQUIRED si falta direccion o maps en home', () => {
    const cases = [
      { home_address: '', maps_url: 'https://maps.google.com/x' },
      { home_address: 'Calle 1', maps_url: '' },
      { home_address: '   ', maps_url: '   ' },
    ];
    for (const c of cases) {
      try {
        assertBookingContact({
          modality: 'home',
          contact_phone: '55512345',
          ...c,
        });
        throw new Error('deberia haber lanzado');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).statusCode).toBe(400);
        expect((e as HttpError).code).toBe('HOME_DETAILS_REQUIRED');
      }
    }
  });

  it('lanza 400 HOME_DETAILS_REQUIRED si la URL de maps no es http/https', () => {
    for (const badUrl of ['no-es-url', 'ftp://x.com', 'javascript:alert(1)']) {
      try {
        assertBookingContact({
          modality: 'home',
          contact_phone: '55512345',
          home_address: 'Calle Falsa 123',
          maps_url: badUrl,
        });
        throw new Error('deberia haber lanzado');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).code).toBe('HOME_DETAILS_REQUIRED');
      }
    }
  });
});
