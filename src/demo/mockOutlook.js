// Preview-harness stand-in for src/outlook/useOutlookMail.js — a signed-in
// mailbox with one demo chain so the Dashboard email card + thread popup
// render offline. Aliased in by vite.appdemo.config.js only.
const days = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };
const P = (name, address) => ({ emailAddress: { name, address } });
const GOLD = "morris@goldstonepropertiesnj.com";
const ATT = "martin@pankiewiczlaw.com";
const tail = (who, when) => `\n\nOn ${when}, ${who} wrote:\n> Please see the earlier correspondence regarding the above-referenced transaction.\n> [earlier messages of the chain repeat here]`;
const MSGS = [
  { id: "em1", conversationId: "conv-16f", subject: "16 Falmouth Contract review", from: P("Morris Hamaoui", GOLD), receivedDateTime: days(-7), hasAttachments: true, isRead: true,
    bodyPreview: "Dear Martin, please see the attached contract regarding the above-referenced transaction…",
    body: { contentType: "text", content: "Dear Martin,\n\nPlease see the attached contract regarding the above-referenced transaction. I am the seller in this matter, and I understand that you are representing the buyer.\n\nKindly review and let me know if you have any requested revisions.\n\nBest regards,\nMorris Hamaoui\nGoldstone Properties LLC" } },
  { id: "em2", conversationId: "conv-16f", subject: "Re: 16 Falmouth Contract review", from: P("Martin Pankiewicz", ATT), receivedDateTime: days(-6), hasAttachments: false, isRead: true,
    bodyPreview: "Thank you Morris — reviewing with my client, will revert with comments.",
    body: { contentType: "text", content: "Thank you Morris — reviewing with my client, will revert with comments shortly." + tail("Morris Hamaoui", "Aug 12, 2026") } },
  { id: "em3", conversationId: "conv-16f", subject: "Re: 16 Falmouth Contract review", from: P("Morris Hamaoui", GOLD), receivedDateTime: days(-4), hasAttachments: false, isRead: true,
    bodyPreview: "Following up — any comments on the contract? We'd like to lock the closing date.",
    body: { contentType: "text", content: "Following up — any comments on the contract? We'd like to lock the closing date this week if possible." + tail("Martin Pankiewicz", "Aug 13, 2026") } },
  { id: "em4", conversationId: "conv-16f", subject: "Re: 16 Falmouth Contract review", from: P("Martin Pankiewicz", ATT), receivedDateTime: days(-1.2), hasAttachments: false, isRead: true,
    bodyPreview: "Two requested revisions: closing on or before Sept 30, and a septic contingency…",
    body: { contentType: "text", content: "Morris,\n\nMy client requests two revisions:\n\n1. Closing on or before September 30\n2. A septic inspection contingency (10 days)\n\nIf acceptable, we will send the signed rider today." + tail("Morris Hamaoui", "Aug 15, 2026") } },
  { id: "em5", conversationId: "conv-16f", subject: "Re: 16 Falmouth Contract review", from: P("Martin Pankiewicz", ATT), receivedDateTime: days(-0.1), hasAttachments: true, isRead: false,
    bodyPreview: "Attached is the revised rider signed by my client — please confirm and we're clear to proceed.",
    body: { contentType: "text", content: "Morris,\n\nAttached is the revised rider signed by my client. Please countersign and return, and we are clear to proceed to closing.\n\nRegards,\nMartin" + tail("Martin Pankiewicz", "Aug 18, 2026") } },
];
const TITLE = "jane@fidelitytitle.com";
const MORE = {
  "conv-title": [
    { id: "t1", conversationId: "conv-title", subject: "417 Lakeview Ter — closing docs", from: P("Jane Doe", TITLE), toRecipients: [P("Elie Hassan", "elie@goldstonepropertiesnj.com")], ccRecipients: [P("Mark Rossi", "mark@fidelitytitle.com")], receivedDateTime: days(-2), hasAttachments: true, isRead: true,
      body: { contentType: "text", content: "Hi Elie,\n\nAttached is the title commitment. We still need the payoff letter from Lending Home and the seller's ID.\n\nThanks,\nJane Doe\nFidelity National Title" } },
    { id: "t2", conversationId: "conv-title", subject: "Re: 417 Lakeview Ter — closing docs", from: P("Elie Hassan", "elie@goldstonepropertiesnj.com"), toRecipients: [P("Jane Doe", TITLE)], ccRecipients: [P("Mark Rossi", "mark@fidelitytitle.com")], receivedDateTime: days(-1.9), hasAttachments: false, isRead: true,
      body: { contentType: "text", content: "Thanks Jane — I asked Lending Home for the payoff, should have it tomorrow." } },
    { id: "t3", conversationId: "conv-title", subject: "Re: 417 Lakeview Ter — closing docs", from: P("Jane Doe", TITLE), toRecipients: [P("Elie Hassan", "elie@goldstonepropertiesnj.com")], ccRecipients: [P("Mark Rossi", "mark@fidelitytitle.com")], receivedDateTime: days(-0.05), hasAttachments: true, isRead: false,
      body: { contentType: "text", content: "Updated CD attached, please review and confirm the payoff figure before 3 PM." } },
  ],
};
const ATTS = { em1: [{ id: "a1", name: "Contract_16_Falmouth.pdf", contentType: "application/pdf", size: 412000 }], em5: [{ id: "a2", name: "Rider_signed.pdf", contentType: "application/pdf", size: 98000 }],
  t1: [{ id: "a3", name: "Title_Commitment.pdf", contentType: "application/pdf", size: 212000 }], t3: [{ id: "a4", name: "Closing_Disclosure_v2.pdf", contentType: "application/pdf", size: 340000 }] };
export const setMailSignature = () => {};
export const withSignature = (h) => h;
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
export function useOutlookMail() {
  return {
    ready: true,
    account: { username: "elie@goldstonepropertiesnj.com", name: "Elie Hassan" },
    signedIn: true,
    signIn: async () => {}, signOut: async () => {},
    listChains: async () => ({ chains: [], next: null }),
    fetchInbox: async () => [],
    searchMail: async () => [],
    getConversation: async (id) => MORE[id] || MSGS,
    findByInternetId: async () => ({ conversationId: "conv-16f" }),
    getAttachments: async (id) => ATTS[id] || [],
    sentBodies: async () => [],
    getAttachmentBlob: async () => null,
    getInlineImages: async () => ({}),
    searchPeople: async () => [],
    conversationUnread: async () => 1,
    markRead: async () => {}, markUnread: async () => {}, markConversationRead: async () => {},
    reply: async () => {}, forward: async () => {}, sendNew: async () => {},
  };
}
