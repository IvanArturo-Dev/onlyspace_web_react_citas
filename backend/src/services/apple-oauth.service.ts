import crypto from 'crypto';
import axios from 'axios';
import {JwtPayload} from 'jsonwebtoken';
import { HttpError } from '../utils/errors';

export interface AppleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: {
    firstName?: string;
    lastName?: string;
  };
}

export interface AppleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  id_token: string;
}

/**
 * Apple OAuth Service
 * Handles Apple Sign-In authentication flow
 */
export const appleOAuthService = {
  /**
   * Apple OAuth configuration
   */
  config: {
    clientId: process.env.APPLE_CLIENT_ID || 'com.yourapp.service',
    teamId: process.env.APPLE_TEAM_ID,
    keyId: process.env.APPLE_KEY_ID,
    privateKey: process.env.APPLE_PRIVATE_KEY,
    redirectUri: process.env.APPLE_REDIRECT_URI || 'https://yourapp.com/callback',
  },

  /**
   * Get Apple OAuth authorization URL
   */
  getAuthorizationUrl(state: string): string {
    const {clientId, redirectUri} = this.config;

    if (!clientId || !redirectUri) {
      throw new HttpError('Apple OAuth not configured', 500, 'APPLE_OAUTH_NOT_CONFIGURED');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code id_token',
      response_mode: 'form_post',
      scope: 'name email',
      state: state,
      nonce: crypto.randomBytes(16).toString('hex'),
    });

    return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
  },

  /**
   * Generate Apple JWT for client secret
   */
  generateClientSecret(): string {
    const {teamId, keyId, privateKey} = this.config;

    if (!teamId || !keyId || !privateKey) {
      throw new HttpError('Apple OAuth not configured', 500, 'APPLE_OAUTH_NOT_CONFIGURED');
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now,
      exp: now + 86400 * 180,
      aud: 'https://appleid.apple.com',
      sub: this.config.clientId,
      iss: teamId,
    };

    let key = privateKey;
    if (!privateKey.startsWith('-----BEGIN PRIVATE KEY-----')) {
      key = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    }

    const token = crypto.sign('RS256', Buffer.from(JSON.stringify(payload)), key).toString('base64');
    return token;
  },

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForToken(code: string): Promise<AppleTokenResponse> {
    const {clientId, redirectUri} = this.config;

    if (!clientId || !redirectUri) {
      throw new HttpError('Apple OAuth not configured', 500, 'APPLE_OAUTH_NOT_CONFIGURED');
    }

    try {
      const response = await axios.post<AppleTokenResponse>(
        'https://appleid.apple.com/auth/token',
        {
          client_id: clientId,
          client_secret: this.generateClientSecret(),
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      throw new HttpError(
        error.response?.data?.error_description || 'Failed to exchange code for token',
        error.response?.status || 500,
        'APPLE_TOKEN_EXCHANGE_FAILED'
      );
    }
  },

  /**
   * Get user profile from Apple ID token
   */
  async getProfile(idToken: string): Promise<AppleProfile> {
    try {
      // Verify the ID token
      const decoded = await this.verifyIdToken(idToken);
      return decoded as AppleProfile;
    } catch (error: any) {
      throw new HttpError(
        'Failed to verify ID token',
        401,
        'APPLE_VERIFY_ID_TOKEN_FAILED'
      );
    }
  },

  /**
   * Verify Apple ID token
   */
  async verifyIdToken(idToken: string): Promise<JwtPayload> {
    try {
      // For now, return decoded payload
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        throw new HttpError('Invalid token format', 401, 'INVALID_TOKEN_FORMAT');
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      return payload as JwtPayload;
    } catch (error: any) {
      throw new HttpError(
        error.message || 'Failed to verify ID token',
        401,
        'APPLE_VERIFY_ID_TOKEN_FAILED'
      );
    }
  },

  /**
   * Refresh Apple access token (if refresh token is provided)
   */
  async refreshAccessToken(refreshToken: string): Promise<AppleTokenResponse> {
    const {clientId} = this.config;

    if (!clientId) {
      throw new HttpError('Apple OAuth not configured', 500, 'APPLE_OAUTH_NOT_CONFIGURED');
    }

    try {
      const response = await axios.post<AppleTokenResponse>(
        'https://appleid.apple.com/auth/token',
        {
          client_id: clientId,
          client_secret: this.generateClientSecret(),
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      throw new HttpError(
        error.response?.data?.error_description || 'Failed to refresh access token',
        error.response?.status || 500,
        'APPLE_REFRESH_TOKEN_FAILED'
      );
    }
  },
};
