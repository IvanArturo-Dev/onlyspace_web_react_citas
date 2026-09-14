import axios from 'axios';
import {
  googleIntegrationService,
  AppointmentEventInput,
  ContactInput,
} from '../google-integration.service';
import { googleAccountService } from '../google-account.service';

/**
 * Unit tests for googleIntegrationService.
 *
 * All external I/O is mocked: axios (the Google REST client) and
 * googleAccountService.ensureAccessToken (the token source). No real network.
 *
 * Covers:
 * - syncAppointmentEvent: new in-person (POST) / new online (Meet) / existing (PATCH)
 *   / not connected (null, no axios call).
 * - deleteAppointmentEvent: DELETE by eventId / ignore 404 / no-op when not
 *   connected or no event id.
 * - upsertContact: POST to people:createContact / not connected (null).
 * - Authorization Bearer uses the token from ensureAccessToken.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 3.4, 4.2, 4.3**
 */

jest.mock('axios');
jest.mock('../google-account.service', () => ({
  googleAccountService: {
    ensureAccessToken: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedEnsureToken = googleAccountService.ensureAccessToken as jest.Mock;

const TENANT = 'tenant-123';
const TOKEN = 'access-token-abc';

const baseAppointment: AppointmentEventInput = {
  service_name: 'Corte de cabello',
  customer_name: 'Ana Perez',
  notes: 'Cliente frecuente',
  start_time: new Date('2025-01-10T15:00:00.000Z'),
  end_time: new Date('2025-01-10T15:30:00.000Z'),
  location: 'Sucursal Centro',
  modality: 'in_person',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('googleIntegrationService.syncAppointmentEvent', () => {
  it('creates a new in-person event via POST and returns event_id with null meet_url', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.post.mockResolvedValue({ data: { id: 'evt-1' } });

    const result = await googleIntegrationService.syncAppointmentEvent(
      TENANT,
      baseAppointment
    );

    expect(result).toEqual({ event_id: 'evt-1', meet_url: null });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events'
    );
    // In-person: no conferenceData, no conferenceDataVersion param, has location.
    expect(body.conferenceData).toBeUndefined();
    expect(body.location).toBe('Sucursal Centro');
    expect(body.summary).toBe('Corte de cabello - Ana Perez');
    expect(body.description).toBe('Cliente frecuente');
    expect(body.start.dateTime).toBe('2025-01-10T15:00:00.000Z');
    expect(body.start.timeZone).toBe('America/Mexico_City');
    expect(config?.params).toBeUndefined();
    expect(config?.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('respects an explicit time_zone', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.post.mockResolvedValue({ data: { id: 'evt-tz' } });

    await googleIntegrationService.syncAppointmentEvent(TENANT, {
      ...baseAppointment,
      time_zone: 'America/Bogota',
    });

    const [, body] = mockedAxios.post.mock.calls[0];
    expect(body.start.timeZone).toBe('America/Bogota');
    expect(body.end.timeZone).toBe('America/Bogota');
  });

  it('creates an online event with conferenceData + conferenceDataVersion=1 and returns meet_url', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.post.mockResolvedValue({
      data: {
        id: 'evt-online',
        conferenceData: {
          entryPoints: [
            { entryPointType: 'more', uri: 'https://meet.google.com/xxx/more' },
            { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' },
          ],
        },
      },
    });

    const result = await googleIntegrationService.syncAppointmentEvent(TENANT, {
      ...baseAppointment,
      modality: 'online',
      location: null,
    });

    expect(result).toEqual({
      event_id: 'evt-online',
      meet_url: 'https://meet.google.com/abc-defg-hij',
    });

    const [, body, config] = mockedAxios.post.mock.calls[0];
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe(
      'hangoutsMeet'
    );
    expect(typeof body.conferenceData.createRequest.requestId).toBe('string');
    expect(body.conferenceData.createRequest.requestId.length).toBeGreaterThan(0);
    // Online event should not carry a physical location.
    expect(body.location).toBeUndefined();
    expect(config?.params).toEqual({ conferenceDataVersion: 1 });
  });

  it('detects online modality from location "En linea"', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.post.mockResolvedValue({
      data: { id: 'evt-loc', hangoutLink: 'https://meet.google.com/from-hangout' },
    });

    const result = await googleIntegrationService.syncAppointmentEvent(TENANT, {
      ...baseAppointment,
      modality: null,
      location: 'En linea',
    });

    // Falls back to hangoutLink when no video entryPoint present.
    expect(result?.meet_url).toBe('https://meet.google.com/from-hangout');
    const [, , config] = mockedAxios.post.mock.calls[0];
    expect(config?.params).toEqual({ conferenceDataVersion: 1 });
  });

  it('updates an existing event via PATCH when google_event_id is present', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.patch.mockResolvedValue({ data: { id: 'evt-existing' } });

    const result = await googleIntegrationService.syncAppointmentEvent(TENANT, {
      ...baseAppointment,
      google_event_id: 'evt-existing',
    });

    expect(result).toEqual({ event_id: 'evt-existing', meet_url: null });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.patch).toHaveBeenCalledTimes(1);

    const [url, , config] = mockedAxios.patch.mock.calls[0];
    expect(url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-existing'
    );
    expect(config?.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('is a no-op returning null when ensureAccessToken is null (not connected)', async () => {
    mockedEnsureToken.mockResolvedValue(null);

    const result = await googleIntegrationService.syncAppointmentEvent(
      TENANT,
      baseAppointment
    );

    expect(result).toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.patch).not.toHaveBeenCalled();
  });
});

describe('googleIntegrationService.deleteAppointmentEvent', () => {
  it('calls DELETE with the eventId and Bearer token', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.delete.mockResolvedValue({ data: {} });

    await googleIntegrationService.deleteAppointmentEvent(TENANT, {
      ...baseAppointment,
      google_event_id: 'evt-del',
    });

    expect(mockedAxios.delete).toHaveBeenCalledTimes(1);
    const [url, config] = mockedAxios.delete.mock.calls[0];
    expect(url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-del'
    );
    expect(config?.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('ignores a 404 (event already deleted)', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.delete.mockRejectedValue({ response: { status: 404 } });

    await expect(
      googleIntegrationService.deleteAppointmentEvent(TENANT, {
        ...baseAppointment,
        google_event_id: 'evt-gone',
      })
    ).resolves.toBeUndefined();
  });

  it('ignores a 410 (event gone)', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.delete.mockRejectedValue({ response: { status: 410 } });

    await expect(
      googleIntegrationService.deleteAppointmentEvent(TENANT, {
        ...baseAppointment,
        google_event_id: 'evt-gone',
      })
    ).resolves.toBeUndefined();
  });

  it('propagates non-404/410 errors', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.delete.mockRejectedValue({ response: { status: 500 } });

    await expect(
      googleIntegrationService.deleteAppointmentEvent(TENANT, {
        ...baseAppointment,
        google_event_id: 'evt-err',
      })
    ).rejects.toBeDefined();
  });

  it('is a no-op when not connected', async () => {
    mockedEnsureToken.mockResolvedValue(null);

    await googleIntegrationService.deleteAppointmentEvent(TENANT, {
      ...baseAppointment,
      google_event_id: 'evt-x',
    });

    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no google_event_id (does not even fetch a token)', async () => {
    await googleIntegrationService.deleteAppointmentEvent(TENANT, baseAppointment);

    expect(mockedEnsureToken).not.toHaveBeenCalled();
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });
});

describe('googleIntegrationService.upsertContact', () => {
  const customer: ContactInput = {
    name: 'Ana Perez',
    phone: '+521234567890',
    email: 'ana@example.com',
  };

  it('POSTs to people:createContact with the customer data and returns resource_name', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.post.mockResolvedValue({
      data: { resourceName: 'people/c123' },
    });

    const result = await googleIntegrationService.upsertContact(TENANT, customer);

    expect(result).toEqual({ resource_name: 'people/c123' });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://people.googleapis.com/v1/people:createContact');
    expect(body.names).toEqual([{ givenName: 'Ana Perez' }]);
    expect(body.phoneNumbers).toEqual([{ value: '+521234567890' }]);
    expect(body.emailAddresses).toEqual([{ value: 'ana@example.com' }]);
    expect(config?.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('omits email when the customer has none', async () => {
    mockedEnsureToken.mockResolvedValue(TOKEN);
    mockedAxios.post.mockResolvedValue({ data: { resourceName: 'people/c999' } });

    await googleIntegrationService.upsertContact(TENANT, {
      name: 'Sin Correo',
      phone: '+520000000000',
    });

    const [, body] = mockedAxios.post.mock.calls[0];
    expect(body.emailAddresses).toBeUndefined();
    expect(body.names).toEqual([{ givenName: 'Sin Correo' }]);
  });

  it('is a no-op returning null when not connected', async () => {
    mockedEnsureToken.mockResolvedValue(null);

    const result = await googleIntegrationService.upsertContact(TENANT, customer);

    expect(result).toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
