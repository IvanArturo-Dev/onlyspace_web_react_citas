import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Mocks: googleAccountService + verifyState, audit, prisma.
// The controller delegates all real work to googleAccountService; here we only
// verify the wiring, the tenant-mismatch guard on the callback, and that
// responses never leak tokens.
// ---------------------------------------------------------------------------
const mockGoogleAccountService = {
  getStatus: jest.fn(),
  getConnectUrl: jest.fn(),
  handleCallback: jest.fn(),
  updateSettings: jest.fn(),
  disconnect: jest.fn(),
};
const mockVerifyState = jest.fn();

jest.mock('../../services/google-account.service', () => ({
  googleAccountService: mockGoogleAccountService,
  verifyState: (state: string) => mockVerifyState(state),
}));

const mockWriteAudit = jest.fn();
jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: any[]) => mockWriteAudit(...args),
}));

jest.mock('../../database/prisma.service', () => ({ prisma: {} }));

/** Minimal Express response double capturing status + json payload. */
function makeRes() {
  const res: any = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload: any) => {
    res.body = payload;
    return res;
  });
  return res;
}

function makeReq(overrides: any = {}) {
  return {
    user: { id: 'user-1', tenant_id: 'tenant-1' },
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

describe('meController Google endpoints (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getGoogleStatus returns the service status without tokens', async () => {
    mockGoogleAccountService.getStatus.mockResolvedValue({
      connected: true,
      google_email: 'shop@example.com',
      online_sessions: true,
      save_contacts: false,
    } as any);

    const { meController } = await import('../me.controller');
    const req = makeReq();
    const res = makeRes();

    await meController.getGoogleStatus(req as any, res);

    expect(mockGoogleAccountService.getStatus).toHaveBeenCalledWith('tenant-1');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('refresh_token');
  });

  it('getGoogleConnectUrl returns auth_url + state', async () => {
    mockGoogleAccountService.getConnectUrl.mockReturnValue({
      auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
      state: 'signed.state',
    } as any);

    const { meController } = await import('../me.controller');
    const req = makeReq();
    const res = makeRes();

    await meController.getGoogleConnectUrl(req as any, res);

    expect(mockGoogleAccountService.getConnectUrl).toHaveBeenCalledWith('tenant-1');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
      state: 'signed.state',
    });
  });

  it('googleCallback verifies state, matches tenant, and completes the connection', async () => {
    mockVerifyState.mockReturnValue({ tenant_id: 'tenant-1' });
    mockGoogleAccountService.handleCallback.mockResolvedValue({
      connected: true,
      google_email: 'shop@example.com',
      online_sessions: false,
      save_contacts: false,
    } as any);

    const { meController } = await import('../me.controller');
    const req = makeReq({ query: { code: 'auth-code', state: 'signed.state' } });
    const res = makeRes();

    await meController.googleCallback(req as any, res);

    expect(mockVerifyState).toHaveBeenCalledWith('signed.state');
    expect(mockGoogleAccountService.handleCallback).toHaveBeenCalledWith(
      'tenant-1',
      'auth-code'
    );
    expect(mockWriteAudit).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('refresh_token');
  });

  it('googleCallback rejects a state whose tenant does not match the caller (403)', async () => {
    mockVerifyState.mockReturnValue({ tenant_id: 'other-tenant' });

    const { meController } = await import('../me.controller');
    const req = makeReq({ query: { code: 'auth-code', state: 'signed.state' } });
    const res = makeRes();

    await meController.googleCallback(req as any, res);

    expect(mockGoogleAccountService.handleCallback).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('OAUTH_STATE_TENANT_MISMATCH');
  });

  it('googleCallback returns 400 when code is missing', async () => {
    const { meController } = await import('../me.controller');
    const req = makeReq({ query: { state: 'signed.state' } });
    const res = makeRes();

    await meController.googleCallback(req as any, res);

    expect(mockVerifyState).not.toHaveBeenCalled();
    expect(mockGoogleAccountService.handleCallback).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('OAUTH_CODE_MISSING');
  });

  it('updateGoogleSettings forwards only provided toggles and audits', async () => {
    mockGoogleAccountService.updateSettings.mockResolvedValue({
      connected: true,
      google_email: 'shop@example.com',
      online_sessions: true,
      save_contacts: false,
    } as any);

    const { meController } = await import('../me.controller');
    const req = makeReq({ body: { online_sessions: true } });
    const res = makeRes();

    await meController.updateGoogleSettings(req as any, res);

    expect(mockGoogleAccountService.updateSettings).toHaveBeenCalledWith('tenant-1', {
      online_sessions: true,
      save_contacts: undefined,
    });
    expect(mockWriteAudit).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.online_sessions).toBe(true);
  });

  it('disconnectGoogle disconnects, audits, and returns { disconnected: true }', async () => {
    mockGoogleAccountService.disconnect.mockResolvedValue(undefined as any);

    const { meController } = await import('../me.controller');
    const req = makeReq();
    const res = makeRes();

    await meController.disconnectGoogle(req as any, res);

    expect(mockGoogleAccountService.disconnect).toHaveBeenCalledWith('tenant-1');
    expect(mockWriteAudit).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ disconnected: true });
  });
});
