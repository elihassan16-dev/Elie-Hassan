import { useCallback, useEffect, useState } from "react";
import { msalInstance, ensureMsalReady, MAIL_SCOPES } from "../onedrive/msal";

const GRAPH = "https://graph.microsoft.com/v1.0";

// Group a flat message list into conversation "chains" (latest message per
// conversation, newest first), with a count and an any-unread flag.
export function groupChains(items) {
  const byConv = new Map();
  for (const m of items || []) {
    const key = m.conversationId || m.id;
    const prev = byConv.get(key);
    if (!prev) byConv.set(key, { key, latest: m, count: 1, anyUnread: !m.isRead });
    else { prev.count += 1; prev.anyUnread = prev.anyUnread || !m.isRead; if ((m.receivedDateTime || "") > (prev.latest.receivedDateTime || "")) prev.latest = m; }
  }
  return [...byConv.values()].sort((a, b) => String(b.latest.receivedDateTime || "").localeCompare(String(a.latest.receivedDateTime || "")));
}

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
    // `path` may be a relative Graph path or a full URL (e.g. an @odata.nextLink).
    const res = await fetch(path.startsWith("http") ? path : GRAPH + path, {
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
    // Action endpoints (reply / replyAll / sendMail) return 202/204 with an EMPTY
    // body — calling res.json() on that throws, so treat any empty body as "ok".
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }, [getToken]);

  const SELECT = "id,conversationId,internetMessageId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,webLink";

  // Find a message in THIS mailbox by its global Internet Message-ID (same across
  // every recipient's mailbox), so a thread pinned by one teammate can still be
  // opened by another who was also on it. Returns {id, conversationId, ...} or null.
  const findByInternetId = useCallback(async (internetMessageId) => {
    if (!internetMessageId) return null;
    try {
      const filter = encodeURIComponent(`internetMessageId eq '${String(internetMessageId).replace(/'/g, "''")}'`);
      const d = await graph(`/me/messages?$filter=${filter}&$select=id,conversationId,subject&$top=1`);
      return (d.value || [])[0] || null;
    } catch { return null; }
  }, [graph]);

  // Recent inbox messages, grouped into conversation "chains" (latest message per
  // conversation, with a count). One page (top N), newest first. Used by the
  // property "pin an email" picker.
  const listChains = useCallback(async (folder = "inbox", top = 40) => {
    const d = await graph(`/me/mailFolders/${encodeURIComponent(folder)}/messages?$select=${SELECT}&$top=${top}&$orderby=receivedDateTime desc`);
    return groupChains(d.value || []);
  }, [graph]);

  // A page of inbox messages, newest first. Pass a prior page's `next` to page
  // through older mail. Returns { items, next } (next is null when done).
  const fetchInbox = useCallback(async ({ top = 50, nextLink = null } = {}) => {
    const d = await graph(nextLink || `/me/mailFolders/inbox/messages?$select=${SELECT}&$top=${top}&$orderby=receivedDateTime desc`);
    return { items: d.value || [], next: d["@odata.nextLink"] || null };
  }, [graph]);

  // Search the WHOLE mailbox (subject, body, from, …). $search can't be combined
  // with $orderby, so results come by relevance and the UI sorts by date.
  const searchMail = useCallback(async ({ query, top = 50, nextLink = null } = {}) => {
    const path = nextLink || `/me/messages?$search=${encodeURIComponent(`"${String(query).replace(/"/g, " ")}"`)}&$select=${SELECT}&$top=${top}`;
    const d = await graph(path);
    return { items: d.value || [], next: d["@odata.nextLink"] || null };
  }, [graph]);

  // All messages in a conversation, oldest first, with full body.
  // The conversationId is base64-ish (+, /, =) so it MUST be URL-encoded — an
  // unencoded '+' decodes to a space and the filter silently matches nothing.
  // Graph also refuses to combine a conversationId $filter with $orderby ("too
  // complex to process"), so we drop $orderby and sort the results here.
  const getConversation = useCallback(async (conversationId) => {
    const filter = encodeURIComponent(`conversationId eq '${String(conversationId).replace(/'/g, "''")}'`);
    const d = await graph(`/me/messages?$filter=${filter}&$select=${SELECT},body&$top=50`);
    const items = d.value || [];
    items.sort((a, b) => String(a.receivedDateTime || a.sentDateTime || "").localeCompare(String(b.receivedDateTime || b.sentDateTime || "")));
    return items;
  }, [graph]);

  // List a message's attachments (metadata only — NO bytes). Selecting contentBytes
  // here would try to inline the whole file, which fails/returns nothing for large
  // files like construction plans, so we fetch the bytes on demand instead. Skips
  // inline images (email-body pictures), keeps real files + cloud/linked files.
  const getAttachments = useCallback(async (id) => {
    let path = `/me/messages/${id}/attachments?$select=id,name,contentType,size,isInline&$top=100`;
    const out = [];
    while (path) {
      const d = await graph(path);
      (d.value || []).forEach((a) => out.push(a));
      path = d["@odata.nextLink"] || null; // page through if there are many
    }
    return out.filter((a) => !a.isInline);
  }, [graph]);

  // Download one attachment's raw bytes as a Blob (works for large files). Use for
  // preview / save. Reference (cloud-link) attachments have no $value — caller handles.
  const getAttachmentBlob = useCallback(async (messageId, attachmentId) => {
    const token = await getToken();
    const res = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Couldn't download the attachment (${res.status}).`);
    return res.blob();
  }, [getToken]);

  // How many messages in a conversation are still unread — so a pinned chain can
  // show an "unread" dot. conversationId + isRead are both filterable (unlike
  // conversationId + $orderby), so this is fine.
  const conversationUnread = useCallback(async (conversationId) => {
    if (!conversationId) return 0;
    try {
      const filter = encodeURIComponent(`conversationId eq '${String(conversationId).replace(/'/g, "''")}' and isRead eq false`);
      const d = await graph(`/me/messages?$filter=${filter}&$select=id&$top=20`);
      return (d.value || []).length;
    } catch { return 0; }
  }, [graph]);

  // Mark a message read.
  const markRead = useCallback(async (id) => {
    try { await graph(`/me/messages/${id}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }); } catch { /* non-fatal */ }
  }, [graph]);

  // Reply / reply-all to a message (sends immediately). `html` is the reply body.
  // `cc` (comma/;-separated) adds extra people to this reply mid-conversation.
  const reply = useCallback(async (id, html, all = false, cc = "") => {
    const addrs = (s) => String(s || "").split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((address) => ({ emailAddress: { address } }));
    const body = { comment: html };
    const ccList = addrs(cc);
    if (ccList.length) body.message = { ccRecipients: ccList }; // added on top of the reply's own recipients
    await graph(`/me/messages/${id}/${all ? "replyAll" : "reply"}`, {
      method: "POST",
      body: JSON.stringify(body),
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

  return { ready, account, signedIn: !!account, signIn, signOut, listChains, fetchInbox, searchMail, getConversation, findByInternetId, getAttachments, getAttachmentBlob, conversationUnread, markRead, reply, sendNew };
}
