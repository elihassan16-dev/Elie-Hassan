// Preview-harness stand-in for supabaseClient — inert, offline, chainable.
// Every query resolves to empty data (except sms_messages → demo call log);
// realtime is a no-op. Aliased in by vite.appdemo.config.js — never production.
import { DEMO_CALLS, DEMO_TEXTS } from "./appMockNet.js";
class Q {
  constructor() { this.res = { data: [], error: null, count: 0 }; }
  select() { return this; }
  insert() { return this; }
  update() { return this; }
  upsert() { return this; }
  delete() { return this; }
  eq() { return this; }
  neq() { return this; }
  in() { return this; }
  not() { return this; }
  is() { return this; }
  gte() { return this; }
  lte() { return this; }
  gt() { return this; }
  lt() { return this; }
  or() { return this; }
  ilike() { return this; }
  contains() { return this; }
  order() { return this; }
  range() { return this; }
  limit() { return this; }
  maybeSingle() { this.res = { data: null, error: null }; return this; }
  single() { this.res = { data: null, error: null }; return this; }
  then(onOk, onErr) { return Promise.resolve(this.res).then(onOk, onErr); }
  catch(onErr) { return Promise.resolve(this.res).catch(onErr); }
  finally(f) { return Promise.resolve(this.res).finally(f); }
}

const channel = {
  on() { return channel; },
  subscribe() { return channel; },
  unsubscribe() {},
};

export const supabase = {
  // The texting store reads call/text history from sms_messages — hand the
  // phone popup its demo call log; every other table stays empty.
  from(table) {
    const q = new Q();
    if (table === "sms_messages") { const rows = [...DEMO_CALLS, ...DEMO_TEXTS]; q.res = { data: rows, error: null, count: rows.length }; }
    if (table === "users") {
      const U = [
        { id: "cu1", name: "Shia Polak", email: "shia@polakconstruction.com", notify_muted: false, notify_channels: null, _org: "org1" },
        { id: "cu2", name: "Moti Polak", email: "moti@polakconstruction.com", notify_muted: false, notify_channels: null, _org: "org1" },
        { id: "cu3", name: "Mendel Davids", email: "mendel@mcdbuilds.com", notify_muted: false, notify_channels: null, _org: "org2" },
      ];
      q.res = { data: U, error: null, count: U.length };
      q.eq = (col, val) => { if (col === "contractor_org_id") q.res = { ...q.res, data: U.filter(r => r._org === String(val)) }; return q; };
    }
    return q;
  },
  rpc() { return new Q(); },
  channel() { return channel; },
  removeChannel() {},
  realtime: { isConnected: () => true, connect() {}, disconnect() {} },
  storage: { from() { return { upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }; } },
  auth: {
    getSession: async () => ({ data: { session: { access_token: "demo", user: { id: "demo-elie", email: "elie@goldstonepropertiesnj.com", user_metadata: {} } } } }),
    // Read stamps for the texting store: every demo thread read except
    // Dominique's, so exactly her two fresh texts badge as unread.
    getUser: async () => ({ data: { user: { id: "demo-elie", email: "elie@goldstonepropertiesnj.com", user_metadata: { smsRead: { "+19085550142": new Date().toISOString(), "+17325550164": new Date().toISOString(), "+18485550102": new Date().toISOString(), "+16095550155": new Date().toISOString() } } } } }),
    refreshSession: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user: { id: "demo-elie" } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null }),
  },
};
