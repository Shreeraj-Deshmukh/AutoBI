import { create } from 'zustand';

/**
 * Who is signed in.
 *
 * Today sign-in is a placeholder: "Sign in with Microsoft" signs the user in on click (method 'demo'),
 * while the Entra app registration is waiting for IT approval. When SSO is set up
 * (docs/plans/2026-11-sso-audit-kpi-chat-openrouter.md), `signIn` sends the browser to `api/auth/login`
 * and the user comes from `api/auth/me`; the pages that use this store do not change.
 */
export interface SignedInUser {
  name: string;
  email?: string;
  method: 'demo' | 'sso';
  signedInAt: string;
}

const KEY = 'autobi-session';
/** sessions last a working day, as the SSO session will */
export const SESSION_HOURS = 8;

function read(): SignedInUser | null {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SignedInUser | null;
    if (!u?.signedInAt || Date.now() - Date.parse(u.signedInAt) > SESSION_HOURS * 3_600_000) return null;
    return u;
  } catch {
    return null;
  }
}

function write(u: SignedInUser | null) {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the session lasts until the tab closes */
  }
}

interface AuthState {
  user: SignedInUser | null;
  signIn: () => void;
  signOut: () => void;
}

export const useAuth = create<AuthState>()((set) => ({
  user: read(),
  signIn: () => {
    const user: SignedInUser = { name: 'Demo user', method: 'demo', signedInAt: new Date().toISOString() };
    write(user);
    set({ user });
  },
  signOut: () => {
    write(null);
    set({ user: null });
  },
}));

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
