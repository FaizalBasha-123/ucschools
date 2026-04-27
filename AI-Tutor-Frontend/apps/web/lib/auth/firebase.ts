import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type Auth,
  type ConfirmationResult,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
};

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

function getFirebaseApp(): FirebaseApp {
  if (_app) return _app;
  const existing = getApps();
  _app = existing.length > 0 ? existing[0] : initializeApp(firebaseConfig);
  return _app;
}

export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(getFirebaseApp());
  return _auth;
}

let _recaptchaVerifier: RecaptchaVerifier | null = null;

/**
 * Initialises an invisible reCAPTCHA verifier bound to a DOM element.
 * Must be called after mount with the element ID that will host the widget.
 */
export function getRecaptchaVerifier(elementId: string): RecaptchaVerifier {
  if (_recaptchaVerifier) return _recaptchaVerifier;
  const auth = getFirebaseAuth();
  _recaptchaVerifier = new RecaptchaVerifier(auth, elementId, { size: 'invisible' });
  return _recaptchaVerifier;
}

export function clearRecaptchaVerifier(): void {
  if (_recaptchaVerifier) {
    try {
      _recaptchaVerifier.clear();
    } catch {
      // no-op
    }
    _recaptchaVerifier = null;
  }
}

/**
 * Send an OTP to the given phone number via Firebase.
 * Returns a ConfirmationResult that must be confirmed with the OTP code.
 */
export async function sendPhoneOtp(phoneNumber: string): Promise<ConfirmationResult> {
  const auth = getFirebaseAuth();
  const verifier = getRecaptchaVerifier('recaptcha-container');
  return signInWithPhoneNumber(auth, phoneNumber, verifier);
}
