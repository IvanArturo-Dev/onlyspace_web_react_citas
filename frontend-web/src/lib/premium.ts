/**
 * Helpers para el gating premium en el frontend.
 *
 * El backend responde 403 con error.code === "PREMIUM_REQUIRED" cuando un tenant
 * free intenta crear un recurso premium (colaborador, programa de lealtad o una
 * segunda sucursal). Estas utilidades mapean ese error a un mensaje claro y
 * especifico por vista, cayendo al fallback si no es un error premium.
 */

export const PREMIUM_REQUIRED_CODE = "PREMIUM_REQUIRED";

/** Lee el codigo de error del backend, con la forma { error: { code } }. */
export function readErrorCode(err: any): string | undefined {
  return err?.response?.data?.error?.code;
}

/** true si el error es un 403 PREMIUM_REQUIRED del backend. */
export function isPremiumRequired(err: any): boolean {
  return readErrorCode(err) === PREMIUM_REQUIRED_CODE;
}

/**
 * Devuelve `premiumMessage` cuando el error es PREMIUM_REQUIRED; si no, devuelve
 * el mensaje del backend/genérico o el `fallback`.
 */
export function mapPremiumError(err: any, premiumMessage: string, fallback?: string): string {
  if (isPremiumRequired(err)) return premiumMessage;
  return err?.response?.data?.error?.message || err?.message || fallback || premiumMessage;
}
