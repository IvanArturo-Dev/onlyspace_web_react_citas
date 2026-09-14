import { randomInt } from 'crypto';
import { prisma } from '../database/prisma.service';

/**
 * Alfabeto para los codigos de negocio.
 * Excluye caracteres ambiguos (O, 0, I, 1) para evitar confusiones al escribir/leer.
 */
export const BOOKING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Longitud fija del codigo de negocio. */
export const BOOKING_CODE_LENGTH = 6;

/** Numero maximo de intentos para encontrar un codigo unico antes de fallar. */
const MAX_ATTEMPTS = 20;

/**
 * Genera un codigo de negocio de 6 caracteres eligiendo aleatoriamente del
 * alfabeto permitido. Usa `crypto.randomInt` para aleatoriedad de calidad.
 * El codigo siempre esta en mayusculas (el alfabeto ya lo es).
 */
export function generateBookingCode(): string {
  let code = '';
  for (let i = 0; i < BOOKING_CODE_LENGTH; i++) {
    code += BOOKING_CODE_ALPHABET[randomInt(BOOKING_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Normaliza un codigo para su resolucion case-insensitive:
 * recorta espacios y lo convierte a mayusculas.
 */
export function normalizeBookingCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Genera un codigo de negocio unico verificando contra la tabla `Tenant`.
 * Reintenta ante colision hasta `MAX_ATTEMPTS` veces.
 *
 * @param client Cliente Prisma (inyectable para pruebas). Por defecto el real.
 * @returns Un codigo de negocio unico.
 * @throws Error si no logra encontrar un codigo libre tras el limite de intentos.
 */
export async function assignUniqueBookingCode(client = prisma): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateBookingCode();
    const existing = await client.tenant.findUnique({
      where: { booking_code: code },
    });
    if (!existing) {
      return code;
    }
  }
  throw new Error(
    `No se pudo generar un codigo de negocio unico tras ${MAX_ATTEMPTS} intentos`
  );
}

/**
 * Genera un codigo de sucursal unico verificando contra la tabla `Branch`.
 * Reutiliza el mismo alfabeto/longitud que los codigos de negocio para
 * mantener consistencia y evitar caracteres ambiguos. Reintenta ante
 * colision hasta `MAX_ATTEMPTS` veces.
 *
 * @param client Cliente Prisma (inyectable para pruebas). Por defecto el real.
 * @returns Un codigo de sucursal unico contra `Branch.booking_code`.
 * @throws Error si no logra encontrar un codigo libre tras el limite de intentos.
 */
export async function assignUniqueBranchCode(client = prisma): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateBookingCode();
    const existing = await client.branch.findUnique({
      where: { booking_code: code },
    });
    if (!existing) {
      return code;
    }
  }
  throw new Error(
    `No se pudo generar un codigo de sucursal unico tras ${MAX_ATTEMPTS} intentos`
  );
}
