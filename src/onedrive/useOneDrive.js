import { useCallback, useEffect, useState } from "react";
import { msalInstance, ensureMsalReady, GRAPH_SCOPES, SITE_SCOPES } from "./msal";

const GRAPH = "https://graph.microsoft.com/v1.0";

// Encode a sharing URL into a Graph share id: "u!" + base64url(url)
function encodeShareUrl(url) {
  const b64 = btoa(unescape(encodeURIComponent(url.trim())));
  return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
}

export function useOneDrive() {
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState(null);

  useEffect(() => {
    let alive = true;
    ensureMsalReady().then(() => {
      if (!alive) return;
      const acc = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0] || null;
      if (acc) msalInstance.setActiveAccount(acc);
      setAccount(acc);
      setReady(true);
    });
    return () => { alive = false; };
  }, []);

  // Full-page redirect sign-in — avoids popup issues (block_nested_popups) and
  // works in PWAs / popup-blocking browsers. Returns to the current page after.
  const signIn = useCallback(async () => {
    await ensureMsalReady();
    await msalInstance.loginRedirect({ scopes: GRAPH_SCOPES, redirectStartPage: window.location.href });
  }, []);

  // Disconnect locally (don't sign the user out of Microsoft entirely).
  const signOut = useCallback(async () => {
    await ensureMsalReady();
    msalInstance.setActiveAccount(null);
    setAccount(null);
  }, []);

  const getToken = useCallback(async () => {
    await ensureMsalReady();
    const acc = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
    if (!acc) throw new Error("Not signed in to Microsoft.");
    try {
      const r = await msalInstance.acquireTokenSilent({ scopes: GRAPH_SCOPES, account: acc });
      return r.accessToken;
    } catch (e) {
      await msalInstance.acquireTokenRedirect({ scopes: GRAPH_SCOPES, account: acc });
      throw e; // navigates away; nothing after this runs
    }
  }, []);

  const graph = useCallback(async (path, opts = {}) => {
    const token = await getToken();
    const res = await fetch(path.startsWith("http") ? path : GRAPH + path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const j = await res.json();
        msg = j.error?.message || msg;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }, [getToken]);

  // Resolve a OneDrive/SharePoint folder share link into a driveItem (+ children).
  const resolveShareLink = useCallback(async (url) => {
    const shareId = encodeShareUrl(url);
    const item = await graph(`/shares/${shareId}/driveItem?$expand=children($top=500)`);
    const driveId = item.parentReference?.driveId || item.remoteItem?.parentReference?.driveId;
    return { driveId, id: item.id, name: item.name, webUrl: item.webUrl, children: item.children || [] };
  }, [graph]);

  const listChildren = useCallback(async (driveId, itemId) => {
    const j = await graph(`/drives/${driveId}/items/${itemId}/children?$top=500`);
    return j.value || [];
  }, [graph]);

  // ── Folder picker sources ────────────────────────────────────────────────────
  // The user's own OneDrive root (top-level items) + its driveId for navigation.
  const myDriveRoot = useCallback(async () => {
    const drive = await graph("/me/drive?$select=id");
    const root = await graph("/me/drive/root?$select=id,name");
    const j = await graph("/me/drive/root/children?$top=500");
    return { driveId: drive.id, rootId: root.id, name: "My OneDrive", items: j.value || [] };
  }, [graph]);

  // ── SharePoint sites (needs Sites.Read.All) ──────────────────────────────────
  // Separate token so a missing Sites.Read.All consent never breaks OneDrive login.
  const graphSites = useCallback(async (path) => {
    await ensureMsalReady();
    const acc = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
    if (!acc) throw new Error("Not signed in to Microsoft.");
    let token;
    try {
      token = (await msalInstance.acquireTokenSilent({ scopes: SITE_SCOPES, account: acc })).accessToken;
    } catch {
      throw new Error("SharePoint browsing needs the 'Sites.Read.All' permission — ask your admin to add + consent it, then try again.");
    }
    const res = await fetch(GRAPH + path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }, []);

  const searchSites = useCallback(async (q) => {
    const query = (q || "").trim();
    const j = await graphSites(`/sites?search=${encodeURIComponent(query || "*")}`);
    return (j.value || []).map((s) => ({ id: s.id, name: s.displayName || s.name, webUrl: s.webUrl }));
  }, [graphSites]);

  // Get a site's default document library root + its top-level items.
  const siteDriveRoot = useCallback(async (siteId) => {
    const drive = await graphSites(`/sites/${siteId}/drive?$select=id`);
    const root = await graphSites(`/sites/${siteId}/drive/root?$select=id,name`);
    const kids = await graphSites(`/sites/${siteId}/drive/root/children?$top=500`);
    return { driveId: drive.id, rootId: root.id, name: root.name || "Documents", items: kids.value || [] };
  }, [graphSites]);

  // Folders shared with the user (surfaces SharePoint/OneDrive folders they can access).
  const sharedWithMe = useCallback(async () => {
    const j = await graph("/me/drive/sharedWithMe");
    return (j.value || [])
      .map((it) => {
        const r = it.remoteItem || it;
        return { id: r.id, name: r.name, folder: r.folder, file: r.file, webUrl: r.webUrl, driveId: r.parentReference?.driveId };
      })
      .filter((x) => x.driveId && x.id);
  }, [graph]);

  // Upload a file into a folder via a resumable session (handles files of any size).
  const uploadFile = useCallback(async (driveId, parentId, file, onProgress) => {
    const token = await getToken();
    const safeName = encodeURIComponent(file.name);
    const sess = await fetch(
      `${GRAPH}/drives/${driveId}/items/${parentId}:/${safeName}:/createUploadSession`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
      }
    );
    if (!sess.ok) throw new Error(`Upload could not start (${sess.status}).`);
    const { uploadUrl } = await sess.json();

    const CHUNK = 5 * 1024 * 1024; // 5 MB
    let start = 0;
    let last = null;
    while (start < file.size) {
      const end = Math.min(start + CHUNK, file.size);
      const chunk = file.slice(start, end);
      const r = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${start}-${end - 1}/${file.size}` },
        body: chunk,
      });
      if (!r.ok && r.status !== 202) throw new Error(`Upload failed (${r.status}).`);
      last = r.status === 202 ? null : await r.json();
      start = end;
      onProgress && onProgress(Math.round((end / file.size) * 100));
    }
    return last;
  }, [getToken]);

  return {
    ready,
    account,
    isConnected: !!account,
    displayName: account?.name || account?.username || "",
    signIn,
    signOut,
    resolveShareLink,
    listChildren,
    myDriveRoot,
    sharedWithMe,
    searchSites,
    siteDriveRoot,
    uploadFile,
  };
}
