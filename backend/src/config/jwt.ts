import jwt from 'jsonwebtoken';

export interface JwtPayload {
  user_id: string;
  tenant_id: string;
  role: string;
  permissions: string[];
  // Claim opcional: userId del super admin que impersona a este tenant (auditoria).
  impersonated_by?: string;
}

export const generateAccessToken = (
  payload: JwtPayload,
  // Opciones opcionales de firma (p.ej. expiracion corta para tokens de impersonacion).
  options?: { expiresIn?: string | number }
): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  // Si no se pasan opciones, se mantiene el comportamiento actual (sin expiracion explicita).
  const token = options
    ? jwt.sign(payload as object, secret as string, options as jwt.SignOptions)
    : jwt.sign(payload as object, secret as string);
  return token;
};

export const generateRefreshToken = (userId: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  const token = jwt.sign({ user_id: userId } as object, secret as string);
  return token;
};

export const verifyAccessToken = (token: string): JwtPayload => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.verify(token, secret) as JwtPayload;
};

export const verifyRefreshToken = (token: string): { user_id: string } => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.verify(token, secret) as { user_id: string };
};
