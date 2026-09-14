import { Router } from 'express';
import { authController } from '../../controllers/auth.controller';

export const authRoutes = Router();

// Native auth endpoints
// POST /v1/auth/login
authRoutes.post('/login', authController.login);

// POST /v1/auth/register
authRoutes.post('/register', authController.register);

// POST /v1/auth/refresh
authRoutes.post('/refresh', authController.refreshToken);

// POST /v1/auth/logout
authRoutes.post('/logout', authController.logout);

// POST /v1/auth/forgot-password
authRoutes.post('/forgot-password', authController.forgotPassword);

// POST /v1/auth/reset-password
authRoutes.post('/reset-password', authController.resetPassword);

// GET /v1/auth/me
authRoutes.get('/me', authController.getMe);

// Google OAuth endpoints
// GET /v1/auth/google/url
authRoutes.get('/google/url', authController.getGoogleAuthUrl);

// POST /v1/auth/google/login
authRoutes.post('/google/login', authController.googleLogin);

// POST /v1/auth/firebase/login (Firebase-issued Google ID token)
authRoutes.post('/firebase/login', authController.firebaseGoogleLogin);

// Apple OAuth endpoints
// GET /v1/auth/apple/url
authRoutes.get('/apple/url', authController.getAppleAuthUrl);

// POST /v1/auth/apple/login
authRoutes.post('/apple/login', authController.appleLogin);
