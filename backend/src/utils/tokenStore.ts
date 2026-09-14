// Simple in-memory token store (no Redis required)
// In production, use Redis for production-grade token management

interface TokenStore {
  [key: string]: {
    token: string;
    expiresAt: number;
  };
}

const refreshTokens: TokenStore = {};
const blockedTokens: Set<string> = new Set();

export const storeRefreshToken = async (
  userId: string,
  refreshToken: string,
  deviceId: string
): Promise<void> => {
  const key = `refresh_token:${userId}:${deviceId}`;
  const ttl = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || '7d');
  const expiresAt = Date.now() + ttl * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  
  refreshTokens[key] = { token: refreshToken, expiresAt };
};

export const getRefreshToken = async (
  userId: string,
  deviceId: string
): Promise<string | null> => {
  const key = `refresh_token:${userId}:${deviceId}`;
  const tokenRecord = refreshTokens[key];
  
  if (!tokenRecord) {
    return null;
  }
  
  // Check if token has expired
  if (Date.now() > tokenRecord.expiresAt) {
    delete refreshTokens[key];
    return null;
  }
  
  return tokenRecord.token;
};

export const deleteRefreshToken = async (
  userId: string,
  deviceId: string
): Promise<void> => {
  const key = `refresh_token:${userId}:${deviceId}`;
  delete refreshTokens[key];
};

export const deleteAllRefreshTokens = async (userId: string): Promise<void> => {
  const pattern = `refresh_token:${userId}:`;
  Object.keys(refreshTokens).forEach(key => {
    if (key.startsWith(pattern)) {
      delete refreshTokens[key];
    }
  });
};

export const invalidateToken = async (token: string): Promise<void> => {
  // Simple in-memory block - in production use Redis for persistent blocking
  blockedTokens.add(token);
};

export const isTokenBlocked = async (token: string): Promise<boolean> => {
  return blockedTokens.has(token);
};
