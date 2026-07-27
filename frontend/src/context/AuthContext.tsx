import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { login as apiLogin, fetchMe } from "../lib/api";
import type { AuthUser } from "../types";

const STORAGE_KEY = "ticket_scanner_token";
const EXPIRY_KEY = "ticket_scanner_token_expires_at";

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function clearStoredAuth() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const expireAt = Number(localStorage.getItem(EXPIRY_KEY) ?? "0");
    if (!token || (expireAt > 0 && Date.now() >= expireAt * 1000)) {
      clearStoredAuth();
      setToken(null);
      setUser(null);
      setIsLoading(false);
      return;
    }

    (async () => {
      try {
        const me = await fetchMe(token);
        if (!cancelled) {
          setUser(me.user as AuthUser);
          localStorage.setItem(EXPIRY_KEY, String(Math.floor(me.expires_at)));
        }
      } catch {
        if (!cancelled) {
          clearStoredAuth();
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;

    const expireAt = Number(localStorage.getItem(EXPIRY_KEY) ?? "0");
    if (!expireAt) return;

    const timeoutMs = expireAt * 1000 - Date.now();
    if (timeoutMs <= 0) {
      clearStoredAuth();
      setToken(null);
      setUser(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      clearStoredAuth();
      setToken(null);
      setUser(null);
    }, timeoutMs);

    return () => window.clearTimeout(timeoutId);
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiLogin(username, password);

    localStorage.setItem(STORAGE_KEY, result.access_token);
    localStorage.setItem(EXPIRY_KEY, String(Math.floor(result.expires_at)));
    setToken(result.access_token);
    setUser(result.user as AuthUser);

    return result.user as AuthUser;
  }, []);

  const logout = useCallback(() => {
    clearStoredAuth();
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ token, user, isLoading, login, logout }),
    [token, user, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
