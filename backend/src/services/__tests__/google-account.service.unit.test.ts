import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock: only the googleAccount delegate is touched by the service.
// (Same style as loyalty.service.unit.test.ts.)
// ---------------------------------------------------------------------------
const mockPrisma = {
  googleAccount: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// google-oauth.service mock: no real network. We assert the service calls it
// correctly and consumes its results.
// ---------------------------------------------------------------------------
const mockOAuth = {
  getWorkspaceAuthorizationUrl: jest.fn(),
  exchangeCodeForToken: jest.fn(),
  getProfile: jest.fn(),
  refreshAccessToken: jest.fn(),
  revokeToken: jest.fn(),
};

jest.mock('../google-oauth.service', () => ({
  googleOAuthService: mockOAuth,
}));

// ---------------------------------------------------------------------------
// crypto mock: deterministic, reversible transforms so we can assert that
// values are encrypted before storage and decrypted before use, WITHOUT
// exercising real AES (that is covered by crypto's own tests).
// enc(x) = "enc(" + x + ")"  /  dec("enc(" + x + ")") = x
// ---------------------------------------------------------------------------
jest.mock('../../utils/crypto', () => ({
  encrypt: (text: string) => `enc(${text})`,
  decrypt: (text: string) => {
    const m = /^enc\((.*)\)$/.exec(text);
    if (!m) throw new Error('cannot decrypt: bad ciphertext');
    return m[1];
  },
}));

import { googleAccountService } from '../google-account.service';

const TENANT = 'tenant-a';

/** Builds a fake GoogleAccount record (tokens are the "encrypted" form). */
function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ga-1',
    tenant_id: TENANT,
    google_email: 'owner@example.com',
    google_sub: 'sub-123',
    access_token: 'enc(access-old)',
    refresh_token: 'enc(refresh-1)',
    token_expiry: new Date(Date.now() + 3600_000),
    scopes: 'openid email',
    online_sessions: false,
    save_contacts: false,
    status: 'connected',
    created_at: new Date('2024-06-01T00:00:00.000Z'),
    updated_at: new Date('2024-06-01T00:00:00.000Z'),
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = 'test-secret';
  process.env.GOOGLE_CONNECT_REDIRECT_URI = 'https://app.test/connect/callback';
  mockPrisma.googleAccount.upsert.mockResolvedValue(account() as never);
  mockPrisma.googleAccount.update.mockResolvedValue(account() as never);
  mockPrisma.googleAccount.delete.mockResolvedValue(account() as never);
});

describe('googleAccountService.getStatus', () => {
  it('returns connected=true with toggles and no tokens when status is connected', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(
      account({ online_sessions: true, save_contacts: true }) as never
    );

    const status = await googleAccountService.getStatus(TENANT);

    expect(status).toEqual({
      connected: true,
      google_email: 'owner@example.com',
      online_sessions: true,
      save_contacts: true,
    });
    // Never expose tokens.
    expect(status).not.toHaveProperty('access_token');
    expect(status).not.toHaveProperty('refresh_token');
    expect(JSON.stringify(status)).not.toContain('enc(');
  });

  it('returns connected=false when there is no account', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(null as never);

    const status = await googleAccountService.getStatus(TENANT);

    expect(status).toEqual({
      connected: false,
      google_email: null,
      online_sessions: false,
      save_contacts: false,
    });
  });

  it('returns connected=false when status is revoked', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(
      account({ status: 'revoked' }) as never
    );

    const status = await googleAccountService.getStatus(TENANT);

    expect(status.connected).toBe(false);
  });

  it('isolates by tenant (queries where tenant_id)', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(null as never);

    await googleAccountService.getStatus(TENANT);

    expect(mockPrisma.googleAccount.findUnique).toHaveBeenCalledWith({
      where: { tenant_id: TENANT },
    });
  });
});

describe('googleAccountService.getConnectUrl', () => {
  it('returns an auth_url built from a signed state that encodes the tenant', () => {
    mockOAuth.getWorkspaceAuthorizationUrl.mockReturnValue('https://accounts.google.com/auth?x=1' as never);

    const result = googleAccountService.getConnectUrl(TENANT);

    expect(result.auth_url).toBe('https://accounts.google.com/auth?x=1');
    expect(typeof result.state).toBe('string');
    expect(result.state.length).toBeGreaterThan(0);
    // getWorkspaceAuthorizationUrl was called with the same state we return.
    expect(mockOAuth.getWorkspaceAuthorizationUrl).toHaveBeenCalledWith(result.state);
  });
});

describe('googleAccountService.handleCallback', () => {
  it('encrypts tokens and upserts the account (fresh connection)', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(null as never);
    mockOAuth.exchangeCodeForToken.mockResolvedValue({
      access_token: 'access-new',
      refresh_token: 'refresh-new',
      expires_in: 3600,
      scope: 'openid email calendar',
    } as never);
    mockOAuth.getProfile.mockResolvedValue({ id: 'sub-999', email: 'me@example.com' } as never);

    await googleAccountService.handleCallback(TENANT, 'the-code');

    // Exchanged with the CONNECT redirect uri.
    expect(mockOAuth.exchangeCodeForToken).toHaveBeenCalledWith(
      'the-code',
      'https://app.test/connect/callback'
    );

    const upsertArgs = mockPrisma.googleAccount.upsert.mock.calls[0][0] as any;
    expect(upsertArgs.where).toEqual({ tenant_id: TENANT });
    // Tokens stored ENCRYPTED, never plaintext.
    expect(upsertArgs.create.access_token).toBe('enc(access-new)');
    expect(upsertArgs.create.refresh_token).toBe('enc(refresh-new)');
    expect(upsertArgs.create.status).toBe('connected');
    expect(upsertArgs.create.google_email).toBe('me@example.com');
    expect(upsertArgs.create.token_expiry).toBeInstanceOf(Date);
    // Sanity: raw plaintext tokens are not present.
    expect(JSON.stringify(upsertArgs)).not.toContain('"access-new"');
    expect(JSON.stringify(upsertArgs)).not.toContain('"refresh-new"');
  });

  it('keeps the previous refresh token when Google does not return a new one', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(
      account({ refresh_token: 'enc(refresh-previous)' }) as never
    );
    mockOAuth.exchangeCodeForToken.mockResolvedValue({
      access_token: 'access-new',
      // no refresh_token this time
      expires_in: 3600,
      scope: 'openid email calendar',
    } as never);
    mockOAuth.getProfile.mockResolvedValue({ id: 'sub-999', email: 'me@example.com' } as never);

    await googleAccountService.handleCallback(TENANT, 'the-code');

    const upsertArgs = mockPrisma.googleAccount.upsert.mock.calls[0][0] as any;
    // Reuses the previously stored (already-encrypted) refresh token verbatim.
    expect(upsertArgs.update.refresh_token).toBe('enc(refresh-previous)');
    expect(upsertArgs.create.refresh_token).toBe('enc(refresh-previous)');
  });

  it('throws a clear error when there is no new nor previous refresh token', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(null as never);
    mockOAuth.exchangeCodeForToken.mockResolvedValue({
      access_token: 'access-new',
      expires_in: 3600,
      scope: 'openid email',
    } as never);
    mockOAuth.getProfile.mockResolvedValue({ id: 'sub-999', email: 'me@example.com' } as never);

    await expect(googleAccountService.handleCallback(TENANT, 'the-code')).rejects.toMatchObject({
      code: 'GOOGLE_REFRESH_TOKEN_MISSING',
      statusCode: 400,
    });
    expect(mockPrisma.googleAccount.upsert).not.toHaveBeenCalled();
  });
});

describe('googleAccountService.updateSettings', () => {
  it('updates only provided toggles', async () => {
    mockPrisma.googleAccount.findUnique
      .mockResolvedValueOnce(account() as never) // guard read
      .mockResolvedValueOnce(account({ online_sessions: true }) as never); // getStatus read

    await googleAccountService.updateSettings(TENANT, { online_sessions: true });

    expect(mockPrisma.googleAccount.update).toHaveBeenCalledWith({
      where: { tenant_id: TENANT },
      data: { online_sessions: true },
    });
  });

  it('throws 404 when the tenant is not connected', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(null as never);

    await expect(
      googleAccountService.updateSettings(TENANT, { save_contacts: true })
    ).rejects.toMatchObject({ code: 'GOOGLE_NOT_CONNECTED', statusCode: 404 });
    expect(mockPrisma.googleAccount.update).not.toHaveBeenCalled();
  });
});

describe('googleAccountService.disconnect', () => {
  it('revokes the token and deletes the record', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(account() as never);
    mockOAuth.revokeToken.mockResolvedValue(undefined as never);

    await googleAccountService.disconnect(TENANT);

    // Revokes the DECRYPTED refresh token.
    expect(mockOAuth.revokeToken).toHaveBeenCalledWith('refresh-1');
    expect(mockPrisma.googleAccount.delete).toHaveBeenCalledWith({
      where: { tenant_id: TENANT },
    });
  });

  it('still deletes the record when revoke fails (best-effort, no throw)', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(account() as never);
    mockOAuth.revokeToken.mockRejectedValue(new Error('google down') as never);

    await expect(googleAccountService.disconnect(TENANT)).resolves.toBeUndefined();

    expect(mockPrisma.googleAccount.delete).toHaveBeenCalledWith({
      where: { tenant_id: TENANT },
    });
  });

  it('is a no-op when there is no account', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(null as never);

    await googleAccountService.disconnect(TENANT);

    expect(mockOAuth.revokeToken).not.toHaveBeenCalled();
    expect(mockPrisma.googleAccount.delete).not.toHaveBeenCalled();
  });
});

describe('googleAccountService.ensureAccessToken', () => {
  it('returns the current access token when it is still valid', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(
      account({ access_token: 'enc(access-valid)', token_expiry: new Date(Date.now() + 3600_000) }) as never
    );

    const token = await googleAccountService.ensureAccessToken(TENANT);

    expect(token).toBe('access-valid');
    expect(mockOAuth.refreshAccessToken).not.toHaveBeenCalled();
    expect(mockPrisma.googleAccount.update).not.toHaveBeenCalled();
  });

  it('refreshes, re-encrypts, persists and returns the new token when expired', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(
      account({
        access_token: 'enc(access-old)',
        refresh_token: 'enc(refresh-1)',
        token_expiry: new Date(Date.now() - 1000), // expired
      }) as never
    );
    mockOAuth.refreshAccessToken.mockResolvedValue({
      access_token: 'access-refreshed',
      expires_in: 3600,
      scope: 'openid email',
    } as never);

    const token = await googleAccountService.ensureAccessToken(TENANT);

    // Refresh used the DECRYPTED refresh token.
    expect(mockOAuth.refreshAccessToken).toHaveBeenCalledWith('refresh-1');
    // Returns the fresh access token (transparent refresh).
    expect(token).toBe('access-refreshed');
    // Persisted the new access token ENCRYPTED with a new expiry.
    const updateArgs = mockPrisma.googleAccount.update.mock.calls[0][0] as any;
    expect(updateArgs.where).toEqual({ tenant_id: TENANT });
    expect(updateArgs.data.access_token).toBe('enc(access-refreshed)');
    expect(updateArgs.data.token_expiry).toBeInstanceOf(Date);
  });

  it('returns null when the tenant is not connected (no account)', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(null as never);

    const token = await googleAccountService.ensureAccessToken(TENANT);

    expect(token).toBeNull();
    expect(mockOAuth.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('returns null when status is revoked', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(
      account({ status: 'revoked' }) as never
    );

    const token = await googleAccountService.ensureAccessToken(TENANT);

    expect(token).toBeNull();
    expect(mockOAuth.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('marks status=revoked and returns null when the refresh token was revoked', async () => {
    mockPrisma.googleAccount.findUnique.mockResolvedValue(
      account({
        access_token: 'enc(access-old)',
        refresh_token: 'enc(refresh-1)',
        token_expiry: new Date(Date.now() - 1000), // expired -> needs refresh
      }) as never
    );
    mockOAuth.refreshAccessToken.mockRejectedValue(new Error('invalid_grant') as never);

    const token = await googleAccountService.ensureAccessToken(TENANT);

    expect(token).toBeNull();
    expect(mockPrisma.googleAccount.update).toHaveBeenCalledWith({
      where: { tenant_id: TENANT },
      data: { status: 'revoked' },
    });
  });
});
