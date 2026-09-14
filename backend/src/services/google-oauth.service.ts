import axios from 'axios';
import { HttpError } from '../utils/errors';

export interface GoogleProfile {
  id: string;
  email: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  verified_email: boolean;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  id_token: string;
  token_type: string;
}

/**
 * Google OAuth Service
 * Handles Google Sign-In authentication flow
 */
export const googleOAuthService = {
  /**
   * Get Google OAuth authorization URL
   */
  getAuthorizationUrl(state: string): string {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    
    if (!clientId || !redirectUri) {
      throw new HttpError('Google OAuth not configured', 500, 'GOOGLE_OAUTH_NOT_CONFIGURED');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state: state,
      prompt: 'consent',
      access_type: 'offline',
      include_granted_scopes: 'true',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  },

  /**
   * Get Google OAuth authorization URL for the Workspace CONNECT flow.
   *
   * This is analogous to `getAuthorizationUrl` (the login flow) but requests the
   * additional Workspace scopes (`calendar.events` + `contacts`) needed by the
   * emprendedor to sync appointments with Google Calendar/Meet and Contacts.
   *
   * Key differences from the login flow:
   * - Uses `GOOGLE_CONNECT_REDIRECT_URI` (a dedicated redirect for the connect
   *   flow) instead of the login `GOOGLE_REDIRECT_URI`, so the two flows never
   *   collide on the same callback endpoint.
   * - Forces `access_type=offline` + `prompt=consent` to guarantee we obtain a
   *   refresh token (required to keep syncing without re-consent).
   * - Adds `include_granted_scopes=true` for incremental authorization.
   *
   * Reuses the same `GOOGLE_CLIENT_ID` as the login flow.
   */
  getWorkspaceAuthorizationUrl(state: string): string {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_CONNECT_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new HttpError('Google OAuth not configured', 500, 'GOOGLE_OAUTH_NOT_CONFIGURED');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/contacts',
      ].join(' '),
      state: state,
      prompt: 'consent',
      access_type: 'offline',
      include_granted_scopes: 'true',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  },

  /**
   * Exchange authorization code for access token.
   *
   * The `redirectUri` used here MUST match the one used to obtain the code.
   * The login flow uses `GOOGLE_REDIRECT_URI` (the default), while the Workspace
   * connect flow uses `GOOGLE_CONNECT_REDIRECT_URI`. To avoid duplicating the
   * exchange logic, callers of the connect flow pass their redirect explicitly
   * via the optional `redirectUri` parameter; login callers omit it and keep the
   * existing behavior (no breaking change).
   *
   * @param code Authorization code returned by Google.
   * @param redirectUri Optional redirect URI override. Defaults to
   *   `GOOGLE_REDIRECT_URI` (login flow).
   */
  async exchangeCodeForToken(
    code: string,
    redirectUri: string | undefined = process.env.GOOGLE_REDIRECT_URI
  ): Promise<GoogleTokenResponse> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new HttpError('Google OAuth not configured', 500, 'GOOGLE_OAUTH_NOT_CONFIGURED');
    }

    try {
      const response = await axios.post<GoogleTokenResponse>(
        'https://oauth2.googleapis.com/token',
        {
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
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
        'GOOGLE_TOKEN_EXCHANGE_FAILED'
      );
    }
  },

  /**
   * Get user profile from Google using access token
   */
  async getProfile(accessToken: string): Promise<GoogleProfile> {
    try {
      const response = await axios.get<GoogleProfile>(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return response.data;
    } catch (error: any) {
      throw new HttpError(
        error.response?.data?.error_description || 'Failed to get user profile',
        error.response?.status || 500,
        'GOOGLE_GET_PROFILE_FAILED'
      );
    }
  },

  /**
   * Verify Google ID token
   * Used for server-side verification of client-side tokens
   */
  async verifyIdToken(idToken: string): Promise<GoogleProfile> {
    const clientId = process.env.GOOGLE_CLIENT_ID;

    if (!clientId) {
      throw new HttpError('Google OAuth not configured', 500, 'GOOGLE_OAUTH_NOT_CONFIGURED');
    }

    try {
      const response = await axios.get<GoogleProfile>(
        'https://www.googleapis.com/oauth2/v3/tokeninfo',
        {
          params: {
            id_token: idToken,
          },
        }
      );

      const data = response.data as any;
      // if (data.audience !== clientId) {
      //   throw new HttpError('Invalid audience', 401, 'INVALID_AUDIENCE');
      // }

      return data;
    } catch (error: any) {
      throw new HttpError(
        error.response?.data?.error_description || 'Failed to verify ID token',
        error.response?.status || 500,
        'GOOGLE_VERIFY_ID_TOKEN_FAILED'
      );
    }
  },

  /**
   * Verify a Firebase-issued ID token.
   *
   * Firebase issues ID tokens that are valid Google JWTs and can be validated
   * through the same Google tokeninfo endpoint used by `verifyIdToken`. The
   * `aud` claim of a Firebase ID token is the Firebase project id (e.g.
   * `citas-e86bb`), not a Google OAuth client id.
   *
   * @param idToken Firebase ID token obtained on the client.
   * @param expectedProjectId Firebase project id to validate the `aud` claim
   *   against. Defaults to `process.env.FIREBASE_PROJECT_ID` or 'citas-e86bb'.
   */
  async verifyFirebaseIdToken(
    idToken: string,
    expectedProjectId: string = process.env.FIREBASE_PROJECT_ID || 'citas-e86bb'
  ): Promise<{ email: string; name: string; picture: string; sub: string }> {
    let data: any;

    try {
      const response = await axios.get(
        'https://www.googleapis.com/oauth2/v3/tokeninfo',
        {
          params: {
            id_token: idToken,
          },
        }
      );
      data = response.data;
    } catch (error: any) {
      throw new HttpError(
        error.response?.data?.error_description || 'Failed to verify Firebase ID token',
        error.response?.status || 500,
        'GOOGLE_VERIFY_ID_TOKEN_FAILED'
      );
    }

    // Validate that the email has been verified by Google. The tokeninfo
    // endpoint can return this either as a boolean `true` or the string "true".
    const emailVerified = data.email_verified === true || data.email_verified === 'true';
    if (!emailVerified) {
      throw new HttpError('Email not verified', 401, 'EMAIL_NOT_VERIFIED');
    }

    // Validate the audience against the configured Firebase project id. If no
    // project id is configured we skip this check (and warn), otherwise the
    // `aud` claim must match exactly.
    if (expectedProjectId) {
      if (data.aud !== expectedProjectId) {
        throw new HttpError('Invalid audience', 401, 'INVALID_AUDIENCE');
      }
    } else {
      console.warn('FIREBASE_PROJECT_ID not configured; skipping audience validation');
    }

    return {
      email: data.email,
      name: data.name,
      picture: data.picture,
      sub: data.sub,
    };
  },

  /**
   * Refresh Google access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new HttpError('Google OAuth not configured', 500, 'GOOGLE_OAUTH_NOT_CONFIGURED');
    }

    try {
      const response = await axios.post<GoogleTokenResponse>(
        'https://oauth2.googleapis.com/token',
        {
          client_id: clientId,
          client_secret: clientSecret,
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
        'GOOGLE_REFRESH_TOKEN_FAILED'
      );
    }
  },

  /**
   * Revoke Google token
   */
  async revokeToken(token: string): Promise<void> {
    try {
      await axios.post(
        `https://oauth2.googleapis.com/revoke?token=${token}`,
        {},
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
    } catch (error: any) {
      // Ignore errors during revocation (token might already be expired)
      console.warn('Failed to revoke Google token:', error.message);
    }
  },
};
