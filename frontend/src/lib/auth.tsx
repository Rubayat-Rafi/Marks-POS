import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setSessionExpiredHandler } from "./api";
import type { SessionUser } from "./types";

type AuthState = {
  user: SessionUser | null;
  loading: boolean;
  signIn: (
    email: string,
    password: string,
    membershipId?: string,
  ) => Promise<{ needsShopChoice: true; memberships: ShopChoice[] } | { needsShopChoice: false }>;
  signOut: () => void;
  /**
   * Whether to RENDER a control. The server still checks the same permission
   * on every request; this only avoids showing people dead ends.
   */
  can: (permission: string) => boolean;
};

export type ShopChoice = {
  id: string;
  organizationName: string;
  locationName: string;
  role: string;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The session cookie is httpOnly, so the page cannot see it; ask the API.
    // /auth/session answers user:null instead of 401, so the public website
    // can load without bouncing to the sign-in page.
    api
      .get<{ user: SessionUser | null }>("/auth/session", { anonymous: true })
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));

    setSessionExpiredHandler(() => setUser(null));
    return () => setSessionExpiredHandler(null);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string, membershipId?: string) => {
      const result = await api.post<
        { needsShopChoice: true; memberships: ShopChoice[] } | { user: SessionUser }
      >("/auth/login", { email, password, membershipId }, { anonymous: true });

      if ("needsShopChoice" in result) {
        return { needsShopChoice: true as const, memberships: result.memberships };
      }
      setUser(result.user);
      return { needsShopChoice: false as const };
    },
    [],
  );

  const signOut = useCallback(() => {
    void api
      .post("/auth/logout", undefined, { anonymous: true })
      .catch(() => undefined)
      .finally(() => {
        setUser(null);
        window.location.href = "/login";
      });
  }, []);

  const can = useCallback(
    (permission: string) => user?.permissions.includes(permission) ?? false,
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, can }),
    [user, loading, signIn, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
