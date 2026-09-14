import request from 'supertest';
import { describe, it, expect, beforeEach, jest, afterAll } from '@jest/globals';
import app from '../../src/app';
import { prisma } from '../../src/database/prisma.service';

// Mock JWT_SECRET
process.env.JWT_SECRET = 'test-secret-key-for-integration-tests';

describe('Auth API Integration Tests', () => {
  let userId: string;

  afterAll(async () => {
    // Clean up test data
    if (userId) {
      await prisma.user.deleteMany({
        where: { id: userId },
      });
    }
  });

  describe('POST /v1/auth/register', () => {
    it('should register a new user', async () => {
      const response = await request(app)
        .post('/v1/auth/register')
        .send({
          email: `test-${Date.now()}@example.com`,
          password: 'Password123!',
          name: 'Test User',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe(`test-${Date.now()}@example.com`);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');

      userId = response.body.user.id;
    });

    it('should return 409 if email already exists', async () => {
      const email = `duplicate-${Date.now()}@example.com`;

      // First registration
      await request(app).post('/v1/auth/register').send({
        email,
        password: 'Password123!',
        name: 'Test User 1',
      });

      // Second registration with same email
      const response = await request(app).post('/v1/auth/register').send({
        email,
        password: 'Password123!',
        name: 'Test User 2',
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('EMAIL_EXISTS');
    });

    it('should return 400 if required fields are missing', async () => {
      const response = await request(app)
        .post('/v1/auth/register')
        .send({
          email: 'test@example.com',
          // Missing password and name
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /v1/auth/login', () => {
    const email = `login-test-${Date.now()}@example.com`;
    const password = 'Password123!';

    beforeEach(async () => {
      // Create test user
      const response = await request(app).post('/v1/auth/register').send({
        email,
        password,
        name: 'Login Test User',
      });
      userId = response.body.user.id;
    });

    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/v1/auth/login')
        .send({
          email,
          password,
          device_id: 'test-device-123',
          device_name: 'Test Device',
          platform: 'ios',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe(email);
    });

    it('should return 401 for invalid credentials', async () => {
      const response = await request(app)
        .post('/v1/auth/login')
        .send({
          email,
          password: 'WrongPassword123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should return 401 for non-existent user', async () => {
      const response = await request(app)
        .post('/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should return 403 for disabled account', async () => {
      // First login to create user
      await request(app).post('/v1/auth/login').send({
        email,
        password,
      });

      // Disable user
      await prisma.user.update({
        where: { id: userId },
        data: { is_active: false },
      });

      const response = await request(app).post('/v1/auth/login').send({
        email,
        password,
      });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('POST /v1/auth/refresh', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const loginResponse = await request(app)
        .post('/v1/auth/login')
        .send({
          email,
          password,
          device_id: 'test-device',
          device_name: 'Test Device',
          platform: 'ios',
        });
      refreshToken = loginResponse.body.refresh_token;
    });

    it('should refresh token with valid refresh token', async () => {
      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({
          refresh_token: refreshToken,
          device_id: 'test-device',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
      // New refresh token should be different
      expect(response.body.refresh_token).not.toBe(refreshToken);
    });

    it('should return 401 for invalid refresh token', async () => {
      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({
          refresh_token: 'invalid-token',
          device_id: 'test-device',
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('POST /v1/auth/logout', () => {
    let accessToken: string;
    let refreshToken: string;

    beforeEach(async () => {
      const loginResponse = await request(app)
        .post('/v1/auth/login')
        .send({
          email,
          password,
          device_id: 'test-device',
          device_name: 'Test Device',
          platform: 'ios',
        });
      accessToken = loginResponse.body.access_token;
      refreshToken = loginResponse.body.refresh_token;
    });

    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('x-device-id', 'test-device');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Logged out successfully');

      // Try to refresh with old token (should fail)
      const refreshResponse = await request(app)
        .post('/v1/auth/refresh')
        .send({
          refresh_token: refreshToken,
          device_id: 'test-device',
        });

      expect(refreshResponse.status).toBe(401);
    });
  });

  describe('GET /v1/auth/me', () => {
    let accessToken: string;

    beforeEach(async () => {
      const loginResponse = await request(app)
        .post('/v1/auth/login')
        .send({
          email,
          password,
          device_id: 'test-device',
          device_name: 'Test Device',
          platform: 'ios',
        });
      accessToken = loginResponse.body.access_token;
    });

    it('should return current user profile', async () => {
      const response = await request(app)
        .get('/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.email).toBe(email);
    });

    it('should return 401 without token', async () => {
      const response = await request(app).get('/v1/auth/me');

      expect(response.status).toBe(401);
    });
  });
});
