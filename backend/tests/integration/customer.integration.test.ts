import request from 'supertest';
import { describe, it, expect, beforeEach, jest, afterAll } from '@jest/globals';
import app from '../../src/app';

describe('Customer API Integration Tests', () => {
  let customerId: string;
  let accessToken: string;

  afterAll(async () => {
    // Clean up test data
    if (customerId) {
      await request(app).delete(`/v1/customers/${customerId}`).set('Authorization', `Bearer ${accessToken}`);
    }
  });

  beforeEach(async () => {
    // First, login to get access token
    const loginResponse = await request(app)
      .post('/v1/auth/login')
      .send({
        email: 'test@example.com',
        password: 'Password123!',
        device_id: 'test-device',
        device_name: 'Test Device',
        platform: 'ios',
      });

    if (loginResponse.status === 200) {
      accessToken = loginResponse.body.access_token;
    }
  });

  describe('GET /v1/customers', () => {
    it('should list customers', async () => {
      const response = await request(app)
        .get('/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('customers');
      expect(response.body.data).toHaveProperty('total');
    });
  });

  describe('POST /v1/customers', () => {
    it('should create a new customer', async () => {
      const response = await request(app)
        .post('/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Test Customer',
          email: `test-${Date.now()}@example.com`,
          phone: '+1234567890',
          address: '123 Test St',
          city: 'Test City',
          state: 'TS',
          zip_code: '12345',
          notes: 'Test customer for integration tests',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe('Test Customer');
      expect(response.body.data.email).toBe(`test-${Date.now()}@example.com`);

      customerId = response.body.data.id;
    });

    it('should return 409 if email already exists', async () => {
      // Create first customer
      const email = `duplicate-${Date.now()}@example.com`;
      await request(app)
        .post('/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Test Customer 1',
          email,
          phone: '+1234567890',
        });

      // Try to create duplicate
      const response = await request(app)
        .post('/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Test Customer 2',
          email,
          phone: '+0987654321',
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('EMAIL_EXISTS');
    });
  });

  describe('GET /v1/customers/:id', () => {
    it('should get a customer by ID', async () => {
      // Create customer first
      const createResponse = await request(app)
        .post('/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Get Test Customer',
          email: `get-test-${Date.now()}@example.com`,
          phone: '+1234567890',
        });

      customerId = createResponse.body.data.id;

      const response = await request(app)
        .get(`/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Get Test Customer');
    });

    it('should return 404 for non-existent customer', async () => {
      const response = await request(app)
        .get('/v1/customers/nonexistent-id')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /v1/customers/:id', () => {
    it('should update a customer', async () => {
      // Create customer first
      const createResponse = await request(app)
        .post('/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Update Test Customer',
          email: `update-test-${Date.now()}@example.com`,
          phone: '+1234567890',
        });

      customerId = createResponse.body.data.id;

      const response = await request(app)
        .put(`/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Updated Customer Name',
          email: `updated-${Date.now()}@example.com`,
          phone: '+0987654321',
          address: '456 Updated St',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Updated Customer Name');
    });
  });

  describe('PATCH /v1/customers/:id', () => {
    it('should partially update a customer', async () => {
      // Create customer first
      const createResponse = await request(app)
        .post('/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Patch Test Customer',
          email: `patch-test-${Date.now()}@example.com`,
          phone: '+1234567890',
        });

      customerId = createResponse.body.data.id;

      const response = await request(app)
        .patch(`/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Patched Customer Name',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Patched Customer Name');
    });
  });

  describe('DELETE /v1/customers/:id', () => {
    it('should soft delete a customer', async () => {
      // Create customer first
      const createResponse = await request(app)
        .post('/v1/customers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Delete Test Customer',
          email: `delete-test-${Date.now()}@example.com`,
          phone: '+1234567890',
        });

      customerId = createResponse.body.data.id;

      const response = await request(app)
        .delete(`/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(204);

      // Verify customer is soft deleted
      const getResponse = await request(app)
        .get(`/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(getResponse.status).toBe(404); // Not found because status is inactive
    });
  });
});
