import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  appointment: {
    findMany: jest.fn(),
  },
  branch: {
    findMany: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// brandingService mock — only getBranding is exercised by these tests.
// ---------------------------------------------------------------------------
const mockBrandingService = {
  getBranding: jest.fn(),
};

jest.mock('../../services/branding.service', () => ({
  brandingService: mockBrandingService,
}));

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

describe('meController.getMyAppointments (unit) - Property 8: client privacy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries appointments filtered by the authenticated user email and only returns those', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ email: 'client@example.com' } as any);
    mockPrisma.appointment.findMany.mockResolvedValue([
      {
        id: 'appt-1',
        start_time: new Date('2025-01-10T10:00:00Z'),
        end_time: new Date('2025-01-10T10:30:00Z'),
        status: 'PENDING',
        modality: 'online',
        video_call_url: 'https://meet.google.com/abc-defg-hij',
        branch_id: 'branch-1',
        service: { name: 'Corte' },
        tenant: { name: 'Barberia X', logo_url: 'https://cdn.example.com/logo.png' },
      },
      {
        id: 'appt-2',
        start_time: new Date('2025-01-09T09:00:00Z'),
        end_time: new Date('2025-01-09T09:30:00Z'),
        status: 'CONFIRMED',
        modality: 'in_person',
        video_call_url: null,
        branch_id: null,
        service: { name: 'Tinte' },
        tenant: { name: 'Barberia X', logo_url: 'https://cdn.example.com/logo.png' },
      },
    ] as any);
    mockPrisma.branch.findMany.mockResolvedValue([
      { id: 'branch-1', name: 'Sucursal Centro', maps_url: 'https://maps.google.com/?q=centro', address: 'Av. Centro 100' },
    ] as any);

    const { meController } = await import('../me.controller');

    const req: any = { user: { id: 'user-1' } };
    const res = makeRes();

    await meController.getMyAppointments(req, res);

    // The user email is resolved from the JWT user id.
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { email: true },
    });

    // Property 8: the query filters strictly by the caller's own email.
    const call = mockPrisma.appointment.findMany.mock.calls[0][0] as any;
    expect(call.where).toEqual({ booked_by_email: 'client@example.com' });
    expect(call.orderBy).toEqual({ start_time: 'desc' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toEqual({
      id: 'appt-1',
      start_time: new Date('2025-01-10T10:00:00Z'),
      end_time: new Date('2025-01-10T10:30:00Z'),
      status: 'PENDING',
      service_name: 'Corte',
      business_name: 'Barberia X',
      // Req 1.2/3.1: sucursal y logo del negocio para el rediseno de /mis-citas.
      branch_name: 'Sucursal Centro',
      logo_url: 'https://cdn.example.com/logo.png',
      // Req 3.2: the client now sees the video-call URL and modality.
      video_call_url: 'https://meet.google.com/abc-defg-hij',
      modality: 'online',
      // Req 2.2/2.3: ubicacion enriquecida para el detalle de la cita del cliente.
      home_address: null,
      maps_url: null,
      branch_maps_url: 'https://maps.google.com/?q=centro',
      branch_address: 'Av. Centro 100',
    });
  });

  it('returns an empty list when the user has no email on record', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as any);

    const { meController } = await import('../me.controller');

    const req: any = { user: { id: 'ghost' } };
    const res = makeRes();

    await meController.getMyAppointments(req, res);

    expect(mockPrisma.appointment.findMany).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('never widens the filter: the where clause always pins booked_by_email to the caller', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ email: 'a@example.com' } as any);
    mockPrisma.appointment.findMany.mockResolvedValue([] as any);

    const { meController } = await import('../me.controller');

    const req: any = { user: { id: 'user-a' } };
    const res = makeRes();

    await meController.getMyAppointments(req, res);

    const call = mockPrisma.appointment.findMany.mock.calls[0][0] as any;
    expect(Object.keys(call.where)).toEqual(['booked_by_email']);
    expect(call.where.booked_by_email).toBe('a@example.com');
  });
});

/**
 * Property 1 (Estado premium expuesto): GET /me/tenant devuelve is_premium
 * consistente con isPremiumEffective del tenant.
 *
 * **Validates: Requirements 1.1**
 */
describe('meController.getTenant (unit) - Property 1: is_premium expuesto', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns is_premium=true for an active tenant with no expiry', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      name: 'Barberia X',
      booking_code: 'bx',
      booking_enabled: true,
      subscription_status: 'active',
      subscription_expires_at: null,
    } as any);

    const { meController } = await import('../me.controller');

    const req: any = { user: { tenant_id: 't1' } };
    const res = makeRes();

    await meController.getTenant(req, res);

    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: {
        id: true,
        name: true,
        booking_code: true,
        booking_enabled: true,
        subscription_status: true,
        subscription_expires_at: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.is_premium).toBe(true);
    expect(res.body.data.portal_path).toBe('/reservar/bx');
  });

  it('returns is_premium=false for an inactive tenant', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      name: 'Barberia X',
      booking_code: 'bx',
      booking_enabled: true,
      subscription_status: 'inactive',
      subscription_expires_at: null,
    } as any);

    const { meController } = await import('../me.controller');

    const req: any = { user: { tenant_id: 't1' } };
    const res = makeRes();

    await meController.getTenant(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.is_premium).toBe(false);
  });

  it('returns is_premium=false for an active tenant whose expiry has passed', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 't1',
      name: 'Barberia X',
      booking_code: 'bx',
      booking_enabled: true,
      subscription_status: 'active',
      subscription_expires_at: new Date('2000-01-01T00:00:00Z'),
    } as any);

    const { meController } = await import('../me.controller');

    const req: any = { user: { tenant_id: 't1' } };
    const res = makeRes();

    await meController.getTenant(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.is_premium).toBe(false);
  });
});

/**
 * Property 2 (Branding default en free): getBranding devuelve un branding DEFAULT
 * (todos los campos en null) cuando el tenant es free, sin borrar la DB; cuando
 * es premium devuelve los datos guardados por brandingService.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3**
 */
describe('meController.getBranding (unit) - Property 2: branding default en free', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const savedBranding = {
    logo_url: 'https://cdn.example.com/logo.png',
    brand_color: '#112233',
    banner_title: 'Bienvenido',
    banner_text: 'Reserva ya',
    banner_link: 'https://example.com',
  };

  it('returns DEFAULT branding (all null) for a free tenant without hitting brandingService', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'inactive',
      subscription_expires_at: null,
    } as any);

    const { meController } = await import('../me.controller');

    const req: any = { user: { tenant_id: 't1' } };
    const res = makeRes();

    await meController.getBranding(req, res);

    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { subscription_status: true, subscription_expires_at: true },
    });
    // Free never reads/writes the stored branding (Property 2: DB untouched).
    expect(mockBrandingService.getBranding).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        logo_url: null,
        brand_color: null,
        banner_title: null,
        banner_text: null,
        banner_link: null,
      },
    });
  });

  it('returns DEFAULT branding for an active tenant whose expiry has passed', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: new Date('2000-01-01T00:00:00Z'),
    } as any);

    const { meController } = await import('../me.controller');

    const req: any = { user: { tenant_id: 't1' } };
    const res = makeRes();

    await meController.getBranding(req, res);

    expect(mockBrandingService.getBranding).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.logo_url).toBeNull();
    expect(res.body.data.brand_color).toBeNull();
  });

  it('returns the stored branding for a premium tenant', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      subscription_status: 'active',
      subscription_expires_at: null,
    } as any);
    mockBrandingService.getBranding.mockResolvedValue(savedBranding as any);

    const { meController } = await import('../me.controller');

    const req: any = { user: { tenant_id: 't1' } };
    const res = makeRes();

    await meController.getBranding(req, res);

    expect(mockBrandingService.getBranding).toHaveBeenCalledWith('t1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: savedBranding });
  });
});
