# OAuth Integration Guide

This document describes the OAuth 2.0 implementation for Google and Apple Sign-In in the Citas application.

## Overview

The application supports two OAuth providers:

1. **Google OAuth** - Allows users to sign in with their Google account
2. **Apple Sign In** - Allows users to sign in with their Apple ID

Both providers follow the standard OAuth 2.0 authorization code flow.

## Architecture

```
┌─────────────────┐
│   Mobile App    │
│  (React Native) │
└────────┬────────┘
         │
         │ 1. Request OAuth URL
         │
         ▼
┌─────────────────┐
│  Backend API    │
│   /oauth/url    │
└────────┬────────┘
         │
         │ 2. Return Auth URL
         │
         ▼
┌─────────────────┐
│  OAuth Provider │
│  (Google/Apple) │
└────────┬────────┘
         │
         │ 3. User authenticates
         │
         ▼
┌─────────────────┐
│   Mobile App    │
│  (Redirect URI) │
└────────┬────────┘
         │
         │ 4. Authorization code
         │
         ▼
┌─────────────────┐
│  Backend API    │
│  /oauth/login   │
└────────┬────────┘
         │
         │ 5. Exchange code for tokens
         │
         ▼
┌─────────────────┐
│  OAuth Provider │
└────────┬────────┘
         │
         │ 6. Access token + ID token
         │
         ▼
┌─────────────────┐
│  Backend API    │
│  - Verify token │
│  - Get profile  │
│  - Create user  │
│  - Generate JWT │
└────────┬────────┘
         │
         │ 7. Return JWT tokens
         │
         ▼
┌─────────────────┐
│   Mobile App    │
│  - Store tokens │
│  - Update UI    │
└─────────────────┘
```

## Google OAuth Setup

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable the Google+ API
4. Create OAuth 2.0 credentials

### 2. Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** user type
3. Fill in app name, user support email, and developer contact
4. Add scopes: `email`, `profile`
5. Add test users

### 3. Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Web application**
4. Add authorized JavaScript origins:
   - `http://localhost:3000` (development)
   - `https://api.yourapp.com` (production)
5. Add authorized redirect URIs:
   - `http://localhost:3000/api/v1/auth/google/callback` (development)
6. Copy the **Client ID** and **Client Secret**

### 4. Environment Variables

Add to your `.env` file:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/auth/google/callback
```

## Apple Sign In Setup

### 1. Enable Apple Sign In Capability

1. Go to [Apple Developer Portal](https://developer.apple.com/account/)
2. Create an App ID with the identifier: `com.yourapp.service`
3. Enable **Sign In with Apple** capability
4. Create a Services ID for your backend

### 2. Create Private Key

1. Go to **Keys** > **All Keys**
2. Click **+** to create a new key
3. Enable **Sign In with Apple**
4. Download the private key file (`.p8`)

### 3. Environment Variables

Add to your `.env` file:

```bash
APPLE_CLIENT_ID=com.yourapp.service
APPLE_TEAM_ID=YOUR-TEAM-ID
APPLE_KEY_ID=YOUR-KEY-ID
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYourKeyContent\n-----END PRIVATE KEY-----"
APPLE_REDIRECT_URI=https://yourapp.com/callback
```

**Note:** The private key should be the full content of the `.p8` file with newlines escaped as `\n`.

## API Endpoints

### Get OAuth URL

#### Google
```
GET /api/v1/auth/google/url
```

**Response:**
```json
{
  "auth_url": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "random-state-string"
}
```

#### Apple
```
GET /api/v1/auth/apple/url
```

**Response:**
```json
{
  "auth_url": "https://appleid.apple.com/auth/authorize?...",
  "state": "random-state-string"
}
```

### Login with OAuth Code

#### Google
```
POST /api/v1/auth/google/login
```

**Request Body:**
```json
{
  "code": "authorization-code-from-google",
  "device_id": "device-identifier",
  "device_name": "Device Name",
  "platform": "ios"
}
```

**Response:**
```json
{
  "user": {
    "id": "user-id",
    "name": "User Name",
    "email": "user@email.com",
    "avatar": "https://...",
    "role": "ADMIN",
    "permissions": ["appointment.create", "appointment.read"]
  },
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "google_access_token": "ya29..."
}
```

#### Apple
```
POST /api/v1/auth/apple/login
```

**Request Body (using code):**
```json
{
  "code": "authorization-code-from-apple",
  "device_id": "device-identifier",
  "device_name": "Device Name",
  "platform": "ios"
}
```

**Request Body (using ID token):**
```json
{
  "id_token": "apple-id-token",
  "device_id": "device-identifier",
  "device_name": "Device Name",
  "platform": "ios"
}
```

## Mobile Implementation

### React Native Example

#### Google Sign In

```typescript
import { GoogleSignin } from '@react-native-google-signin/google-signin';

const handleGoogleLogin = async () => {
  try {
    // Configure Google Sign In
    GoogleSignin.configure({
      webClientId: 'YOUR-WEB-CLIENT-ID',
      offlineAccess: true,
    });

    // Get user info
    const { data } = await GoogleSignin.signIn();
    const { idToken } = data;

    // Send to backend
    const response = await api.post('/v1/auth/google/login', {
      code: idToken,
      device_id: getDeviceId(),
      device_name: getDeviceName(),
      platform: 'ios', // or 'android'
    });

    // Store tokens
    await saveTokens(response.data);
  } catch (error) {
    console.error('Google login error:', error);
  }
};
```

#### Apple Sign In

```typescript
import AppleAuthentication from 'expo-apple-authentication';

const handleAppleLogin = async () => {
  try {
    // Sign in with Apple
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    // Send to backend
    const response = await api.post('/v1/auth/apple/login', {
      id_token: credential.identityToken,
      device_id: getDeviceId(),
      device_name: getDeviceName(),
      platform: 'ios',
    });

    // Store tokens
    await saveTokens(response.data);
  } catch (error) {
    console.error('Apple login error:', error);
  }
};
```

## Security Considerations

1. **State Parameter**: Always use state parameter to prevent CSRF attacks
2. **Token Storage**: Store refresh tokens securely using device storage (not local storage for web)
3. **Token Validation**: Always verify ID tokens on the backend before creating user accounts
4. **HTTPS**: Use HTTPS in production for all OAuth endpoints
5. **Rate Limiting**: Implement rate limiting on login endpoints
6. **Device Binding**: Bind refresh tokens to device IDs for session management
7. **Token Rotation**: Rotate refresh tokens on each use for better security

## Error Handling

### Common Errors

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `INVALID_CREDENTIALS` | 401 | Wrong email/password |
| `ACCOUNT_DISABLED` | 403 | User account is disabled |
| `EMAIL_EXISTS` | 409 | Email already registered |
| `GOOGLE_OAUTH_NOT_CONFIGURED` | 500 | Google OAuth not set up |
| `APPLE_OAUTH_NOT_CONFIGURED` | 500 | Apple Sign In not set up |
| `TOKEN_INVALIDATED` | 401 | Token has been invalidated |

## Debugging

### Test Google OAuth

1. Make sure redirect URI matches exactly
2. Check that OAuth client ID type is "Web application"
3. Verify authorized origins include your backend URL

### Test Apple Sign In

1. Verify Services ID matches `APPLE_CLIENT_ID`
2. Ensure private key has correct permissions
3. Check that bundle ID matches your app

## Links

- [Google OAuth Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Apple Sign In Documentation](https://developer.apple.com/documentation/sign_in_with_apple)
- [JWT.io](https://jwt.io/) - Debug JWT tokens