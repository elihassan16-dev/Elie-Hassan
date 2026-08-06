import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { readSnap, writeSnap, ensureSnapOwner } from "../snapshot";

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
    if (data) writeSnap(`profile-${sess.user.id}`, data); // next launch skips the splash wait
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
    let settled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      settled = true;
      setSession(data.session);
      if (data.session?.user?.id) ensureSnapOwner(data.session.user.id);
      // A returning user's profile is cached: render NOW with it and refresh in
      // the background, instead of holding the splash for a network round-trip.
      const cached = data.session?.user?.id ? readSnap(`profile-${data.session.user.id}`) : null;
      if (cached) {
        setProfile(cached);
        setLoading(false);
        loadProfile(data.session);
      } else {
        await loadProfile(data.session);
        setLoading(false);
      }
    });
    // Watchdog: getSession() can hang forever on an iOS PWA whose auth lock
    // got stranded mid-freeze (endless splash until a force-kill). After 4s,
    // recover the session straight from the persisted copy and boot with the
    // cached profile — the real answer overwrites whenever it finally lands.
    const dog = setTimeout(() => {
      if (!active || settled) return;
      try {
        const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
        const raw = key ? JSON.parse(localStorage.getItem(key)) : null;
        const sess = raw && (raw.currentSession || raw);
        if (sess && sess.user) {
          setSession(sess);
          ensureSnapOwner(sess.user.id);
          const cached = readSnap(`profile-${sess.user.id}`);
          if (cached) setProfile(cached);
          else setProfile({ id: sess.user.id, email: sess.user.email, name: sess.user.email, role: "member" });
        }
      } catch { /* nothing usable — fall through to the login screen */ }
      setLoading(false);
    }, 4000);

    // IMPORTANT: never await Supabase queries inside this callback — the auth
    // client holds a lock while it runs, and a query here deadlocks token
    // refreshes (worse with several tabs open), which surfaces as the app
    // flashing/re-mounting. Defer any fetch, and only refetch the profile on
    // real identity changes — token refreshes and preference saves
    // (USER_UPDATED) fire constantly and don't change the users row's role.
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      if (sess?.user?.id) ensureSnapOwner(sess.user.id); // fresh sign-in on a shared device wipes the previous account's snapshots
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
        setTimeout(() => { loadProfile(sess).finally(() => setLoading(false)); }, 0);
      } else {
        setLoading(false);
      }
    });

    return () => {
      active = false;
      clearTimeout(dog);
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(
    (email, password) => supabase.auth.signInWithPassword({ email: email.trim(), password }),
    []
  );
  const signOut = useCallback(() => supabase.auth.signOut(), []);

  // Let a user set their own display name (RLS allows updating your own users row).
  const updateName = useCallback(async (name) => {
    const clean = (name || "").trim();
    if (!clean || !session?.user) return { message: "Enter a name." };
    await supabase.auth.updateUser({ data: { name: clean } }); // keep auth metadata in sync
    const { error } = await supabase.from("users").update({ name: clean }).eq("id", session.user.id);
    if (!error) setProfile((p) => (p ? { ...p, name: clean } : p));
    return error;
  }, [session]);

  // Per-user UI preferences, stored in auth user_metadata (persists across devices
  // and logins, and is unique to each account). savePrefs merges the given keys.
  const savePrefs = useCallback(async (patch) => {
    const { data, error } = await supabase.auth.updateUser({ data: patch });
    if (!error && data?.user) setSession((s) => (s ? { ...s, user: data.user } : s));
    return error;
  }, []);

  const value = {
    session,
    user: session?.user || null,
    profile,
    role: profile?.role || "member",
    isAdmin: profile?.role === "admin",
    isContractor: profile?.role === "contractor",
    contractorOrgId: profile?.contractor_org_id || null,
    displayName: profile?.name || session?.user?.email || "",
    prefs: session?.user?.user_metadata || {},
    savePrefs,
    loading,
    signIn,
    signOut,
    updateName,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
