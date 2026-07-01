import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

export const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null); // row from public.users
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (sess) => {
    if (!sess?.user) {
      setProfile(null);
      return;
    }
    // The users row is created by a DB trigger on sign-up. Fetch it (retry once
    // in case the trigger hasn't committed yet on a brand-new account).
    let { data } = await supabase.from("users").select("*").eq("id", sess.user.id).maybeSingle();
    if (!data) {
      await new Promise((r) => setTimeout(r, 600));
      ({ data } = await supabase.from("users").select("*").eq("id", sess.user.id).maybeSingle());
    }
    setProfile(
      data || {
        id: sess.user.id,
        email: sess.user.email,
        name: sess.user.email,
        role: "member",
      }
    );
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      setSession(sess);
      await loadProfile(sess);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(
    (email, password) => supabase.auth.signInWithPassword({ email: email.trim(), password }),
    []
  );
  const signOut = useCallback(() => supabase.auth.signOut(), []);

  const value = {
    session,
    user: session?.user || null,
    profile,
    role: profile?.role || "member",
    isAdmin: profile?.role === "admin",
    displayName: profile?.name || session?.user?.email || "",
    loading,
    signIn,
    signOut,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
