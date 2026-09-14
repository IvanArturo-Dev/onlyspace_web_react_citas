import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getAnalytics, isSupported, logEvent, type Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let analytics: Analytics | null = null;

export function initFirebase() {
  if (app) return;

  // 1) Core app + Auth: esto es lo indispensable para el login.
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
  } catch (err) {
    console.error("Firebase Auth init failed:", err);
    return;
  }

  // 2) Analytics: totalmente opcional, aislado. Nunca debe romper el login.
  //    Solo se inicializa si hay measurementId y el navegador lo soporta.
  if (firebaseConfig.measurementId) {
    isSupported()
      .then((supported) => {
        if (supported && app) {
          try {
            analytics = getAnalytics(app);
          } catch (err) {
            console.warn("Analytics init skipped:", err);
          }
        }
      })
      .catch(() => {
        /* degradacion elegante */
      });
  }
}

export function getFirebaseAuth(): Auth | null {
  return auth;
}

export function trackEvent(name: string, params?: Record<string, unknown>) {
  try {
    if (analytics) {
      logEvent(analytics, name, params);
    }
  } catch {
    /* no-op */
  }
}
