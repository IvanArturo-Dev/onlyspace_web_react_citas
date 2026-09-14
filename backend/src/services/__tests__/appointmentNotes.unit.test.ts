import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Prisma mock — only the delegates the note methods touch.
// appointment.findUnique backs getAppointment (tenant-scoped load);
// appointmentNote.* back create/list/delete.
// ---------------------------------------------------------------------------
const mockPrisma = {
  appointment: {
    findUnique: jest.fn(),
  },
  appointmentNote: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// writeAudit is mocked so the unit test never touches the audit log. The
// service does not call it (the controller does); mocked to keep the module
// graph isolated and consistent with the other service unit tests.
const mockWriteAudit = jest.fn(async () => undefined);
jest.mock('../../utils/audit', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

// branchService is imported by appointment.service; mock it so the module
// loads cleanly (the note methods never call it).
jest.mock('../branch.service', () => ({
  branchService: {
    get: jest.fn(),
  },
}));

import { appointmentService } from '../appointment.service';
import { HttpError } from '../../utils/errors';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const APPT = 'appt-1';
const AUTHOR = 'user-1';

/** Builds a fake Appointment record as getAppointment would return it. */
function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: APPT,
    tenant_id: TENANT,
    customer_id: 'cust-1',
    service_id: 'svc-1',
    branch_id: null,
    professional_id: null,
    start_time: new Date('2024-06-01T10:00:00.000Z'),
    end_time: new Date('2024-06-01T10:30:00.000Z'),
    status: 'PENDING',
    ...overrides,
  } as never;
}

/** Builds a fake AppointmentNote record. */
function note(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    tenant_id: TENANT,
    appointment_id: APPT,
    author_id: AUTHOR,
    body: 'a note',
    created_at: new Date('2024-06-01T11:00:00.000Z'),
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: appointment belongs to the caller tenant.
  mockPrisma.appointment.findUnique.mockResolvedValue(appointment());
  mockPrisma.appointmentNote.create.mockImplementation(async (args: any) => ({
    ...note(),
    ...args.data,
    id: 'note-created',
  }));
  mockPrisma.appointmentNote.findMany.mockResolvedValue([] as never);
  mockPrisma.appointmentNote.findFirst.mockResolvedValue(note() as never);
  mockPrisma.appointmentNote.delete.mockResolvedValue(note() as never);
});

// ---------------------------------------------------------------------------
// addNote — Requirement 4.1, 4.4 (author + timestamp), 4.3 (tenant scope)
// ---------------------------------------------------------------------------
describe('appointmentService.addNote', () => {
  it('creates a note scoped to the tenant + appointment with the given author', async () => {
    const result: any = await appointmentService.addNote(TENANT, APPT, 'hello', AUTHOR);

    const createArgs = mockPrisma.appointmentNote.create.mock.calls[0][0] as any;
    expect(createArgs.data.tenant_id).toBe(TENANT);
    expect(createArgs.data.appointment_id).toBe(APPT);
    expect(createArgs.data.author_id).toBe(AUTHOR);
    expect(createArgs.data.body).toBe('hello');
    expect(result.id).toBe('note-created');

    // Loaded the appointment scoped by tenant first (Property 6).
    const findArgs = mockPrisma.appointment.findUnique.mock.calls[0][0] as any;
    expect(findArgs.where.tenant_id).toBe(TENANT);
    expect(findArgs.where.id).toBe(APPT);
  });

  it('trims the body before storing it', async () => {
    await appointmentService.addNote(TENANT, APPT, '   spaced   ', AUTHOR);
    const createArgs = mockPrisma.appointmentNote.create.mock.calls[0][0] as any;
    expect(createArgs.data.body).toBe('spaced');
  });

  it('rejects an empty body with 400 VALIDATION_ERROR and does not create', async () => {
    await expect(
      appointmentService.addNote(TENANT, APPT, '   ', AUTHOR)
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' } as any);

    expect(mockPrisma.appointmentNote.create).not.toHaveBeenCalled();
  });

  it('rejects a non-string body with 400 VALIDATION_ERROR', async () => {
    await expect(
      appointmentService.addNote(TENANT, APPT, undefined as any, AUTHOR)
    ).rejects.toBeInstanceOf(HttpError);

    expect(mockPrisma.appointmentNote.create).not.toHaveBeenCalled();
  });

  it('throws APPOINTMENT_NOT_FOUND for a foreign appointment and never creates', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue(null as never);

    await expect(
      appointmentService.addNote(OTHER_TENANT, APPT, 'hello', AUTHOR)
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' } as any);

    expect(mockPrisma.appointmentNote.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listNotes — Requirement 4.1, 4.3 (tenant-scoped, ordered by created_at desc)
// ---------------------------------------------------------------------------
describe('appointmentService.listNotes', () => {
  it('returns notes scoped by tenant + appointment ordered by created_at desc', async () => {
    const notes = [
      note({ id: 'n2', created_at: new Date('2024-06-02T00:00:00.000Z') }),
      note({ id: 'n1', created_at: new Date('2024-06-01T00:00:00.000Z') }),
    ];
    mockPrisma.appointmentNote.findMany.mockResolvedValue(notes as never);

    const result: any = await appointmentService.listNotes(TENANT, APPT);
    expect(result).toHaveLength(2);

    const findManyArgs = mockPrisma.appointmentNote.findMany.mock.calls[0][0] as any;
    expect(findManyArgs.where.tenant_id).toBe(TENANT);
    expect(findManyArgs.where.appointment_id).toBe(APPT);
    expect(findManyArgs.orderBy).toEqual({ created_at: 'desc' });
  });

  it('throws APPOINTMENT_NOT_FOUND for a foreign appointment and never lists', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue(null as never);

    await expect(
      appointmentService.listNotes(OTHER_TENANT, APPT)
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' } as any);

    expect(mockPrisma.appointmentNote.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteNote — Requirement 4.5 (tenant isolation on delete)
// ---------------------------------------------------------------------------
describe('appointmentService.deleteNote', () => {
  it('deletes an existing note that belongs to the tenant + appointment', async () => {
    mockPrisma.appointmentNote.findFirst.mockResolvedValue(note({ id: 'note-9' }) as never);

    const result = await appointmentService.deleteNote(TENANT, APPT, 'note-9');
    expect(result).toEqual({ id: 'note-9' });

    const findFirstArgs = mockPrisma.appointmentNote.findFirst.mock.calls[0][0] as any;
    expect(findFirstArgs.where.id).toBe('note-9');
    expect(findFirstArgs.where.tenant_id).toBe(TENANT);
    expect(findFirstArgs.where.appointment_id).toBe(APPT);

    const deleteArgs = mockPrisma.appointmentNote.delete.mock.calls[0][0] as any;
    expect(deleteArgs.where.id).toBe('note-9');
  });

  it('throws NOTE_NOT_FOUND for a foreign/absent note and never deletes', async () => {
    // Appointment is valid for the tenant, but the note does not belong to it.
    mockPrisma.appointmentNote.findFirst.mockResolvedValue(null as never);

    await expect(
      appointmentService.deleteNote(TENANT, APPT, 'foreign-note')
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOTE_NOT_FOUND' } as any);

    expect(mockPrisma.appointmentNote.delete).not.toHaveBeenCalled();
  });

  it('throws APPOINTMENT_NOT_FOUND for a foreign appointment and never touches notes', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValue(null as never);

    await expect(
      appointmentService.deleteNote(OTHER_TENANT, APPT, 'note-1')
    ).rejects.toMatchObject({ statusCode: 404, code: 'APPOINTMENT_NOT_FOUND' } as any);

    expect(mockPrisma.appointmentNote.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.appointmentNote.delete).not.toHaveBeenCalled();
  });
});
