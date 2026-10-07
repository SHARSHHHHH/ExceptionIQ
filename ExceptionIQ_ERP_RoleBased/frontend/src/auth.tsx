import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './api';
import type { Session, User } from './types';

interface AuthState { session: Session | null; loading: boolean; signIn(email: string, password: string): Promise<void>; signOut(): void; can(p: string): boolean; refresh(): Promise<void> }
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());

  const signOut = useCallback(() => { tokenStore.clear(); setSession(null); }, []);
  useEffect(() => { setUnauthorizedHandler(signOut); }, [signOut]);
  useEffect(() => {
    if (!tokenStore.get()) return;
    api<Session>('/auth/me').then(setSession).catch(signOut).finally(() => setLoading(false));
  }, [signOut]);

  const signIn = async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } });
    tokenStore.set(r.token);
    setSession(await api<Session>('/auth/me'));
  };
  const can = useCallback((p: string) => !!session?.permissions.includes(p), [session]);
  const refresh = useCallback(async () => { if (tokenStore.get()) setSession(await api<Session>('/auth/me')); }, []);
  return <Ctx.Provider value={{ session, loading, signIn, signOut, can, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
