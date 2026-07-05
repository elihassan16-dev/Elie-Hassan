import { useCallback, useEffect, useState } from "react";
import { msalInstance, ensureMsalReady, MAIL_SCOPES } from "../onedrive/msal";

const GRAPH = "https://graph.microsoft.com/v1.0";

// Outlook / Microsoft 365 mail via Microsoft Graph — reuses the same MSAL sign-in
// as the Files tab, just with Mail.Read + Mail.Send delegated scopes. Everything
// is the SIGNED-IN user's own mailbox (/me), so each teammate sees their own email.
export function useOutlookMail() {
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

  // Sign in (full-page redirect) requesting the mail scopes.
  const signIn = useCallback(async () => {
    await ensureMsalReady();
    await msalInstance.loginRedirect({ scopes: MAIL_SCOPES, prompt: "select_account", redirectStartPage: window.location.href });
  }, []);

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
      const r = await msalInstance.acquireTokenSilent({ scopes: MAIL_SCOPES, account: acc });
      return r.accessToken;
    } catch (e) {
      // Mail scopes may not be consented yet → interactive consent.
      await msalInstance.acquireTokenRedirect({ scopes: MAIL_SCOPES, account: acc });
      throw e; // navigates away; nothing after this runs
    }
  }, []);

  const graph = useCallback(async (path, opts = {}) => {
    const token = await getToken();
    const res = await fetch(GRAPH + path, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      let msg = `Graph ${res.status}`;
      try { const j = await res.json(); msg = j?.error?.message || msg; } catch { /* ignore */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }, [getToken]);

  const SELECT = "id,conversationId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,webLink";

  // Recent inbox messages, grouped into conversation "chains" (latest message per
  // conversation, with a count). One page (top N), newest first.
  const listChains = useCallback(async (folder = "inbox", top = 40) => {
    const d = await graph(`/me/mailFolders/${encodeURIComponent(folder)}/messages?$select=${SELECT}&$top=${top}&$orderby=receivedDateTime desc`);
    const items = d.value || [];
    const byConv = new Map();
    for (const m of items) {
      const key = m.conversationId || m.id;
      const prev = byConv.get(key);
      if (!prev) byConv.set(key, { key, latest: m, count: 1, anyUnread: !m.isRead });
      else { prev.count += 1; prev.anyUnread = prev.anyUnread || !m.isRead; if ((m.receivedDateTime || "") > (prev.latest.receivedDateTime || "")) prev.latest = m; }
    }
    return [...byConv.values()].sort((a, b) => String(b.latest.receivedDateTime || "").localeCompare(String(a.latest.receivedDateTime || "")));
  }, [graph]);

  // All messages in a conversation, oldest first, with full body.
  const getConversation = useCallback(async (conversationId) => {
    const d = await graph(`/me/messages?$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'&$select=${SELECT},body&$orderby=receivedDateTime asc&$top=50`);
    return d.value || [];
  }, [graph]);

  // Mark a message read.
  const markRead = useCallback(async (id) => {
    try { await graph(`/me/messages/${id}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }); } catch { /* non-fatal */ }
  }, [graph]);

  // Reply / reply-all to a message (sends immediately). `html` is the reply body.
  const reply = useCallback(async (id, html, all = false) => {
    await graph(`/me/messages/${id}/${all ? "replyAll" : "reply"}`, {
      method: "POST",
      body: JSON.stringify({ comment: html }),
    });
  }, [graph]);

  // Compose & send a brand-new message.
  const sendNew = useCallback(async ({ to, cc, subject, html }) => {
    const addrs = (s) => String(s || "").split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((address) => ({ emailAddress: { address } }));
    await graph(`/me/sendMail`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: subject || "",
          body: { contentType: "HTML", content: html || "" },
          toRecipients: addrs(to),
          ccRecipients: addrs(cc),
        },
        saveToSentItems: true,
      }),
    });
  }, [graph]);

  return { ready, account, signedIn: !!account, signIn, signOut, listChains, getConversation, getConversation2: getConversation, markRead, reply, sendNew };
}
