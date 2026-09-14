import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { HttpError } from '../utils/errors';

/**
 * Firebase Admin verification service.
 *
 * Verifies Firebase ID tokens (issued by the Firebase Web SDK on the client)
 * against Firebase public signing keys. Unlike Google OAuth `tokeninfo`
 * endpoint, this correctly validates tokens whose issuer is
 * `https://securetoken.google.com/<projectId>` and whose audience is the
 * Firebase project id.
 *
 * For ID token verification only, the Admin SDK needs the project id; a full
 * service-account credential is not required.
 */

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'citas-e86bb';

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  if (getApps().length === 0) {
    // If application default credentials are available, use them; otherwise a
    // bare projectId is enough to verify ID tokens.
    try {
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
      } else {
        initializeApp({ projectId: PROJECT_ID });
      }
    } catch {
      initializeApp({ projectId: PROJECT_ID });
    }
  }
  initialized = true;
}

export interface FirebaseUserProfile {
  email: string;
  name: string;
  picture?: string;
  uid: string;
  email_verified: boolean;
}

export const firebaseAdminService = {
  async verifyIdToken(idToken: string): Promise<FirebaseUserProfile> {
    ensureInitialized();

    let decoded: DecodedIdToken;
    try {
      decoded = await getAuth().verifyIdToken(idToken);
    } catch (error: any) {
      throw new HttpError(
        error?.message || 'Failed to verify Firebase ID token',
        401,
        'FIREBASE_VERIFY_FAILED'
      );
    }

    const email = decoded.email;
    if (!email) {
      throw new HttpError('Token has no email', 401, 'EMAIL_MISSING');
    }

    const emailVerified = decoded.email_verified === true;
    if (!emailVerified) {
      throw new HttpError('Email not verified', 401, 'EMAIL_NOT_VERIFIED');
    }

    return {
      email,
      name: (decoded.name as string) || email.split('@')[0],
      picture: decoded.picture as string | undefined,
      uid: decoded.uid,
      email_verified: emailVerified,
    };
  },
};

// Note: `cert` is imported for future service-account support; referenced here
// to avoid unused-import lint noise without changing runtime behavior.
void cert;
