import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/database/prisma.service';

describe('Authentication API', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /v1/auth/login', () => {
    it('should return 200 with valid credentials', async () => {
      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('refresh_token');
    });

    it('should return 401 with invalid credentials', async () => {
      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'wrongpassword',
      });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /v1/auth/refresh', () => {
    it('should return new tokens with valid refresh token', async () => {
      // This test would require a refresh token from a previous login
      const response = await request(app).post('/v1/auth/refresh').send({
        refresh_token: 'valid-refresh-token',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('access_token');
    });
  });
});
