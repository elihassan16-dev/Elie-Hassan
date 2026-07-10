// Demo-only stand-in for AuthProvider — used by the tutorial recording build.
// Never bundled into the real app (vite.demo.config.js aliases it in).
export function useAuth() {
  return {
    user: { id: "demo-user", email: "sam@mcdbuilds.co" },
    displayName: "Hershy Gelbman",
    role: "contractor",
    isAdmin: false,
    isContractor: true,
    contractorOrgId: "demo-org",
    prefs: {},
    savePrefs: () => {},
    signOut: () => {},
  };
}
export function AuthProvider({ children }) { return children; }
