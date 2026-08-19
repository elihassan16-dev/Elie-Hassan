// Preview-harness stand-in for the main app's AuthProvider — signed in as
// Elie (admin), no Supabase. Aliased in by vite.appdemo.config.js only.
const value = {
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
