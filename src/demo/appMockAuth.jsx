// Preview-harness stand-in for the main app's AuthProvider — signed in as
// Elie (admin), no Supabase. Aliased in by vite.appdemo.config.js only.
// On the contractor-portal preview page (ctrdemo.html) it flips to a
// contractor login so the REAL portal renders with the demo org.
const isCtrDemo = typeof window !== "undefined" && /ctrdemo/.test(window.location.pathname);
const ctrValue = {
  session: { user: { id: "demo-shia", email: "shia@polakconstruction.com", user_metadata: {} } },
  user: { id: "demo-shia", email: "shia@polakconstruction.com", user_metadata: {} },
  profile: { id: "demo-shia", name: "Shia Polak", role: "contractor" },
  role: "contractor",
  isAdmin: false,
  isContractor: true,
  contractorOrgId: "org1",
  displayName: "Shia Polak",
  prefs: {},
  savePrefs: async () => null,
  loading: false,
  signIn: async () => null,
  signOut: () => {},
  updateName: async () => null,
};
const value = isCtrDemo ? ctrValue : {
  session: { user: { id: "demo-elie", email: "elie@goldstonepropertiesnj.com", user_metadata: {} } },
  user: { id: "demo-elie", email: "elie@goldstonepropertiesnj.com", user_metadata: {} },
  profile: { id: "demo-elie", name: "Elie Hassan", role: "admin" },
  role: "admin",
  isAdmin: true,
  isContractor: false,
  contractorOrgId: null,
  displayName: "Elie Hassan",
  prefs: {},
  savePrefs: async () => null,
  loading: false,
  signIn: async () => null,
  signOut: () => {},
  updateName: async () => null,
};
export function useAuth() { return value; }
export function AuthProvider({ children }) { return children; }
