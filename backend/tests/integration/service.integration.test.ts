import request from 'supertest';
import { describe, it, expect, beforeEach, jest, afterAll } from '@jest/globals';
import app from '../../src/app';

describe('Service API Integration Tests', () => {
  let serviceId: string;
  let categoryId: string;
  let accessToken: string;

  afterAll(async () => {
    // Clean up test data
    if (serviceId) {
      await request(app).delete(`/v1/services/${serviceId}`).set('Authorization', `Bearer ${accessToken}`);
    }
    if (categoryId) {
      await request(app).delete(`/v1/categories/${categoryId}`).set('Authorization', `Bearer ${accessToken}`);
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

  describe('GET /v1/services', () => {
    it('should list services', async () => {
      const response = await request(app)
        .get('/v1/services')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('POST /v1/services', () => {
    it('should create a new service', async () => {
      const response = await request(app)
        .post('/v1/services')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Test Service',
          description: 'Description for test service',
          duration: 30,
          price: 25.00,
          category_id: categoryId,
          is_active: true,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe('Test Service');

      serviceId = response.body.data.id;
    });
  });

  describe('GET /v1/services/:id', () => {
    it('should get a service by ID', async () => {
      // Create service first
      const createResponse = await request(app)
        .post('/v1/services')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Get Test Service',
          description: 'Description',
          duration: 30,
          price: 25.00,
        });

      serviceId = createResponse.body.data.id;

      const response = await request(app)
        .get(`/v1/services/${serviceId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Get Test Service');
    });
  });

  describe('PUT /v1/services/:id', () => {
    it('should update a service', async () => {
      // Create service first
      const createResponse = await request(app)
        .post('/v1/services')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Update Test Service',
          description: 'Description',
          duration: 30,
          price: 25.00,
        });

      serviceId = createResponse.body.data.id;

      const response = await request(app)
        .put(`/v1/services/${serviceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Updated Service Name',
          description: 'Updated description',
          duration: 45,
          price: 30.00,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Updated Service Name');
    });
  });

  describe('PATCH /v1/services/:id', () => {
    it('should partially update a service', async () => {
      // Create service first
      const createResponse = await request(app)
        .post('/v1/services')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Patch Test Service',
          description: 'Description',
          duration: 30,
          price: 25.00,
        });

      serviceId = createResponse.body.data.id;

      const response = await request(app)
        .patch(`/v1/services/${serviceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Patched Service Name',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Patched Service Name');
    });
  });

  describe('DELETE /v1/services/:id', () => {
    it('should soft delete a service', async () => {
      // Create service first
      const createResponse = await request(app)
        .post('/v1/services')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Delete Test Service',
          description: 'Description',
          duration: 30,
          price: 25.00,
        });

      serviceId = createResponse.body.data.id;

      const response = await request(app)
        .delete(`/v1/services/${serviceId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(204);

      // Verify service is soft deleted
      const getResponse = await request(app)
        .get(`/v1/services/${serviceId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(getResponse.status).toBe(404);
    });
  });

  describe('GET /v1/categories', () => {
    it('should list categories', async () => {
      const response = await request(app)
        .get('/v1/categories')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('POST /v1/categories', () => {
    it('should create a new category', async () => {
      const response = await request(app)
        .post('/v1/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Test Category',
          description: 'Description for test category',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.name).toBe('Test Category');

      categoryId = response.body.data.id;
    });
  });
});
