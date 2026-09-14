import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { googleOAuthService } from '../google-oauth.service';
import { HttpError } from '../../utils/errors';

/**
 * Unit tests for the Workspace CONNECT authorization URL builder.
 *
 * These tests exercise only the URL construction (no network), verifying that
 * the connect flow requests the Workspace scopes, uses the dedicated connect
 * redirect, and forces offline access + consent to obtain a refresh token.
 */
describe('googleOAuthService.getWorkspaceAuthorizationUrl (unit)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CONNECT_REDIRECT_URI = 'https://app.example.com/google/callback';
    // The login redirect must NOT be used by the connect flow.
    process.env.GOOGLE_REDIRECT_URI = 'https://app.example.com/auth/google/callback';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('builds a URL that includes the Workspace scopes (calendar.events + contacts)', () => {
    const url = googleOAuthService.getWorkspaceAuthorizationUrl('state-123');
    const params = new URL(url).searchParams;
    const scope = params.get('scope') || '';

    expect(scope).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(scope).toContain('https://www.googleapis.com/auth/contacts');
    // Identity scopes are still present.
    expect(scope).toContain('openid');
    expect(scope).toContain('email');
    expect(scope).toContain('profile');
  });

  it('forces offline access and consent to obtain a refresh token', () => {
    const url = googleOAuthService.getWorkspaceAuthorizationUrl('state-123');
    const params = new URL(url).searchParams;

    expect(params.get('access_type')).toBe('offline');
    expect(params.get('prompt')).toBe('consent');
    expect(params.get('include_granted_scopes')).toBe('true');
    expect(params.get('response_type')).toBe('code');
    expect(params.get('state')).toBe('state-123');
  });

  it('uses the dedicated CONNECT redirect and the shared client id (not the login redirect)', () => {
    const url = googleOAuthService.getWorkspaceAuthorizationUrl('state-123');
    const params = new URL(url).searchParams;

    expect(params.get('redirect_uri')).toBe('https://app.example.com/google/callback');
    expect(params.get('redirect_uri')).not.toBe(process.env.GOOGLE_REDIRECT_URI);
    expect(params.get('client_id')).toBe('test-client-id');
  });

  it('throws GOOGLE_OAUTH_NOT_CONFIGURED (500) when the connect redirect is missing', () => {
    delete process.env.GOOGLE_CONNECT_REDIRECT_URI;

    expect(() => googleOAuthService.getWorkspaceAuthorizationUrl('state-123')).toThrow(HttpError);
    try {
      googleOAuthService.getWorkspaceAuthorizationUrl('state-123');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(500);
      expect((err as HttpError).code).toBe('GOOGLE_OAUTH_NOT_CONFIGURED');
    }
  });

  it('throws GOOGLE_OAUTH_NOT_CONFIGURED (500) when the client id is missing', () => {
    delete process.env.GOOGLE_CLIENT_ID;

    expect(() => googleOAuthService.getWorkspaceAuthorizationUrl('state-123')).toThrow(HttpError);
  });
});
