// Admin-side contractor management (the "Contractors" nav section, admin-only):
// companies → logins, jobs (scope, contract price, change orders, payments, docs),
// tasks both directions, and the per-job message thread. Contractors see the
// mirror of this in their portal.
// NOTE: modals + job detail are module-level components (not defined inside the
// page) so a realtime update never remounts them and wipes a half-typed form.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthProvider";
import { useData } from "../data/DataProvider";
import { T } from "../theme";
import { notify, qbAuthFetch, uploadAttachment } from "../net";
import { useContractorData, jobTotal, jobPaid, jobLeft, jobDays, money, fmtDate, fmtWhen } from "./data";

const inp = { width: "100%", padding: "10px 12px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 14, outline: "none", fontFamily: "inherit", boxSizing: "border-box" };
const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 };
const goldBtn = (on = true) => ({ padding: "10px 18px", borderRadius: T.radiusSm, border: "none", background: on ? T.gold : T.border, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: on ? "pointer" : "default", fontFamily: "inherit" });
const ghostBtn = { padding: "10px 16px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: "#fff", color: T.textSub, fontWeight: 600, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" };
const numIn = (v) => String(v).replace(/[^0-9.\-]/g, "");
const today = () => new Date().toISOString().slice(0, 10);

function Modal({ title, onClose, children, footer, width = 520 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400, backdropFilter: "blur(6px)", padding: 16, boxSizing: "border-box" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: `min(${width}px,94vw)`, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: T.goldLight, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.gold, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: T.textTert, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>
        <div style={{ padding: "16px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
        {footer && <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}

// ── Company create/edit ────────────────────────────────────────────────────────
function OrgModal({ orgModal, save, onSaved, onClose }) {
  const editing = !!orgModal?.id;
  const [f, setF] = useState({ name: orgModal?.name || "", contactName: orgModal?.contactName || "", phone: orgModal?.phone || "", email: orgModal?.email || "", address: orgModal?.address || "", notes: orgModal?.notes || "" });
  const [e2, setE2] = useState("");
  const saveOrg = async () => {
    if (!f.name.trim()) return;
    const obj = { ...(editing ? orgModal : { id: "org_" + Date.now(), createdAt: new Date().toISOString() }), ...f, name: f.name.trim() };
    try { await save("contractor_orgs", obj); } catch (ex) { setE2(ex.message || "Save failed — try again."); return; }
    onSaved(String(obj.id)); onClose();
  };
  return (
    <Modal title={editing ? "Edit company" : "New contractor company"} onClose={onClose}
      footer={<><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={saveOrg} style={goldBtn(!!f.name.trim())}>Save</button></>}>
      <div><label style={lbl}>Company / contractor name</label><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Tom's Plumbing LLC" style={inp} /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><label style={lbl}>Main contact</label><input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} placeholder="Tom" style={inp} /></div>
        <div style={{ flex: 1 }}><label style={lbl}>Phone</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} type="tel" style={inp} /></div>
      </div>
      <div><label style={lbl}>Email</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" style={inp} /></div>
      <div><label style={lbl}>Mailing address</label><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Street, City, State ZIP" style={inp} /></div>
      <div><label style={lbl}>Notes</label><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} style={{ ...inp, minHeight: 56, resize: "vertical" }} /></div>
      {e2 && <div style={{ fontSize: 12.5, color: T.red }}>{e2}</div>}
    </Modal>
  );
}

// ── Create a portal login at a company ────────────────────────────────────────
function LoginModal({ org, onClose }) {
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [e2, setE2] = useState("");
  const create = async () => {
    setBusy(true); setE2("");
    try {
      await qbAuthFetch("/api/team/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, role: "contractor", contractorOrgId: String(org.id) }) });
      onClose();
    } catch (ex) { setE2(ex.message || "Couldn't create the login."); }
    setBusy(false);
  };
  const ok = f.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) && f.password.length >= 8;
  return (
    <Modal title={`New login — ${org?.name}`} onClose={onClose}
      footer={<><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={create} disabled={!ok || busy} style={goldBtn(ok && !busy)}>{busy ? "Creating…" : "Create login"}</button></>}>
      <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.5 }}>They sign in at <b>gpflips.com</b> with this email + password and see ONLY their company's portal — jobs, tasks, and messages. Share the password with them directly.</div>
      <div><label style={lbl}>Name</label><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Tom Rivera" style={inp} /></div>
      <div><label style={lbl}>Email (their login)</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} type="email" style={inp} /></div>
      <div><label style={lbl}>Password (min 8 characters)</label><input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} style={inp} /></div>
      {e2 && <div style={{ fontSize: 12.5, color: T.red }}>{e2}</div>}
    </Modal>
  );
}

// ── Job create / edit basics ──────────────────────────────────────────────────
function JobModal({ org, jobModal, properties, save, onSaved, onClose }) {
  const editing = !!jobModal?.id;
  const [f, setF] = useState({ propertyId: jobModal?.propertyId || "", title: jobModal?.title || "", scope: jobModal?.scope || "", price: jobModal?.price != null ? String(jobModal.price) : "", startDate: jobModal?.startDate || today() });
  const [e2, setE2] = useState("");
  const saveJob = async () => {
    const prop = properties.find((p) => String(p.id) === String(f.propertyId));
    if (!prop && !editing) return;
    const obj = {
      ...(editing ? jobModal : { id: "job_" + Date.now(), orgId: String(org.id), changeOrders: [], payments: [], status: "active", createdAt: new Date().toISOString() }),
      propertyId: f.propertyId || jobModal?.propertyId, propertyAddress: prop ? `${prop.address}${prop.city ? `, ${prop.city}` : ""}` : jobModal?.propertyAddress,
      title: f.title.trim(), scope: f.scope, price: Number(numIn(f.price)) || 0, startDate: f.startDate,
    };
    try { await save("contractor_jobs", obj); } catch (ex) { setE2(ex.message || "Save failed — try again."); return; }
    onSaved(obj.id); onClose();
    if (!editing) notify(null, { toOrg: String(org.id), title: "New job from Goldstone", body: `${obj.propertyAddress}${obj.title ? ` — ${obj.title}` : ""}` });
  };
  return (
    <Modal title={editing ? "Edit job" : `New job — ${org?.name}`} onClose={onClose}
      footer={<><button onClick={onClose} style={ghostBtn}>Cancel</button><button onClick={saveJob} style={goldBtn(!!(f.propertyId || editing))}>Save</button></>}>
      <div><label style={lbl}>Property</label>
        <select value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value })} style={{ ...inp, color: f.propertyId ? T.text : T.textTert }}>
          <option value="">Pick a property…</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.address}{p.city ? `, ${p.city}` : ""}</option>)}
        </select>
      </div>
      <div><label style={lbl}>Job title (optional)</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Full gut renovation / Plumbing rough-in" style={inp} /></div>
      <div><label style={lbl}>Scope of work — general or detailed; their PDF can be attached after</label><textarea value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} placeholder="Describe the work…" style={{ ...inp, minHeight: 90, resize: "vertical", lineHeight: 1.5 }} /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><label style={lbl}>Contract price</label><input value={f.price} onChange={(e) => setF({ ...f, price: numIn(e.target.value) })} inputMode="decimal" placeholder="e.g. 45000" style={inp} /></div>
        <div style={{ flex: 1 }}><label style={lbl}>Start date</label><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} style={inp} /></div>
      </div>
      {e2 && <div style={{ fontSize: 12.5, color: T.red }}>{e2}</div>}
    </Modal>
  );
}

// ── Job detail — overview (money/docs), tasks, messages ──────────────────────
function JobDetail({ j, org, tasks, messages, docs, save, remove, displayName, onEditBasics, onClose }) {
  const total = jobTotal(j), paid = jobPaid(j), left = jobLeft(j), days = jobDays(j);
  const jDocs = (docs || []).filter((d) => String(d.jobId) === String(j.id));
  const jTasks = (tasks || []).filter((t) => String(t.jobId) === String(j.id));
  const toThem = jTasks.filter((t) => t.direction !== "to_team").sort((a, b) => (a.status === "Completed") - (b.status === "Completed"));
  const fromThem = jTasks.filter((t) => t.direction === "to_team").sort((a, b) => (a.status === "Completed") - (b.status === "Completed"));
  const thread = (messages || []).filter((m) => String(m.jobId) === String(j.id)).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  const [tab2, setTab2] = useState("overview");
  const [coDraft, setCoDraft] = useState(null);
  const [payDraft, setPayDraft] = useState(null);
  const [taskDraft, setTaskDraft] = useState("");
  const [msgDraft, setMsgDraft] = useState("");
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err2, setErr2] = useState("");
  const attRef = useRef(null);
  const docRef = useRef(null);
  const scrollRef = useRef(null);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread.length, tab2]);

  const addCO = async () => { const a = Number(numIn(coDraft.amount)); if (!a) return; await save("contractor_jobs", { ...j, changeOrders: [...(j.changeOrders || []), { id: Date.now(), label: coDraft.label.trim() || "Change order", amount: a, date: coDraft.date }] }); setCoDraft(null); notify(null, { toOrg: j.orgId, title: "Change order added", body: `${coDraft.label.trim() || "Change order"} — ${money(a)} · ${j.propertyAddress}` }); };
  const addPay = async () => { const a = Number(numIn(payDraft.amount)); if (!a) return; await save("contractor_jobs", { ...j, payments: [...(j.payments || []), { id: Date.now(), amount: a, date: payDraft.date, note: payDraft.note.trim() }] }); setPayDraft(null); notify(null, { toOrg: j.orgId, title: "Payment recorded", body: `${money(a)} — ${j.propertyAddress}` }); };
  const addTask = async () => { const txt = taskDraft.trim(); if (!txt) return; await save("contractor_tasks", { id: Date.now(), jobId: j.id, orgId: j.orgId, text: txt, status: "Not Started", direction: "to_contractor", createdBy: displayName, createdAt: new Date().toISOString() }); setTaskDraft(""); notify(null, { toOrg: j.orgId, title: "New task from Goldstone", body: `${txt} — ${j.propertyAddress}` }); };
  const toggleTask = async (t) => { const done = t.status !== "Completed"; await save("contractor_tasks", { ...t, status: done ? "Completed" : "Not Started", doneAt: done ? new Date().toISOString() : null, doneBy: done ? displayName : null }); };
  const pickAtt = async (e) => { const file = (e.target.files || [])[0]; e.target.value = ""; if (!file) return; setBusy(true); try { setPending(await uploadAttachment(file, "portal")); } catch { setErr2("Upload failed."); } setBusy(false); };
  const sendMsg = async () => {
    const txt = msgDraft.trim(); if ((!txt && !pending) || busy) return;
    const msg = { id: Date.now(), jobId: j.id, orgId: j.orgId, author: displayName, side: "team", text: txt, at: new Date().toISOString(), readBy: [displayName] };
    if (pending) msg.attachment = pending;
    setMsgDraft(""); setPending(null);
    await save("contractor_messages", msg);
    notify(null, { toOrg: j.orgId, title: `Goldstone — ${j.propertyAddress}`, body: txt || "(attachment)" });
  };
  const uploadDoc = async (e) => { const file = (e.target.files || [])[0]; e.target.value = ""; if (!file) return; setBusy(true); try { const up = await uploadAttachment(file, "portal"); await save("contractor_docs", { id: Date.now(), jobId: j.id, orgId: j.orgId, name: up.name, url: up.url, mime: up.mime, by: displayName, at: new Date().toISOString() }); } catch { setErr2("Upload failed."); } setBusy(false); };

  const secHdr = (t, right) => <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 8px" }}><div style={{ fontSize: 11, fontWeight: 800, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t}</div>{right}</div>;
  const miniBtn = (label, onClick) => <button onClick={onClick} style={{ padding: "5px 12px", borderRadius: 16, border: `1px solid ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>;

  return (
    <Modal title={`${j.propertyAddress}${j.title ? ` — ${j.title}` : ""}`} width={640} onClose={onClose}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[["overview", "Overview"], ["tasks", `Tasks${jTasks.length ? ` (${jTasks.filter(t => t.status !== "Completed").length})` : ""}`], ["messages", `Messages${thread.length ? ` (${thread.length})` : ""}`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab2(k)} style={{ padding: "7px 15px", borderRadius: 18, border: `1px solid ${tab2 === k ? T.gold : T.border}`, background: tab2 === k ? T.goldLight : "#fff", color: tab2 === k ? "#8a6d1f" : T.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => save("contractor_jobs", { ...j, status: j.status === "complete" ? "active" : "complete" })} style={{ padding: "7px 13px", borderRadius: 18, border: `1px solid ${j.status === "complete" ? T.border : T.green}`, background: j.status === "complete" ? T.bg : "#EDFBF1", color: j.status === "complete" ? T.textSub : "#15803D", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{j.status === "complete" ? "Reopen job" : "✓ Mark complete"}</button>
      </div>
      {err2 && <div onClick={() => setErr2("")} style={{ fontSize: 12.5, color: T.red, cursor: "pointer" }}>{err2}</div>}

      {tab2 === "overview" && (<>
        <div style={{ display: "flex", gap: 8 }}>
          {[["Contract", money(total)], ["Paid", money(paid)], ["Remaining", money(left)], ["Days", days == null ? "—" : days]].map(([l, v]) => (
            <div key={l} style={{ flex: 1, background: T.bg, borderRadius: 10, padding: "9px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: T.textTert, textTransform: "uppercase" }}>{l}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{v}</div>
            </div>
          ))}
        </div>
        <div>
          {secHdr("Scope of work", miniBtn("✎ Edit basics", onEditBasics))}
          <div style={{ fontSize: 13, color: j.scope ? T.textSub : T.textTert, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{j.scope || "No scope written — edit the job or let the contractor upload their SOW PDF."}</div>
        </div>
        <div>
          {secHdr("Documents", miniBtn(busy ? "Uploading…" : "＋ Upload", () => docRef.current && docRef.current.click()))}
          <input ref={docRef} type="file" accept="application/pdf,image/*" onChange={uploadDoc} style={{ display: "none" }} />
          {jDocs.length === 0 && <div style={{ fontSize: 12.5, color: T.textTert }}>No documents yet. Their uploaded SOW PDFs land here too.</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {jDocs.map((d) => <a key={d.id} href={d.url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 16, border: `1px solid ${T.border}`, background: T.bg, color: T.blue, fontSize: 12, fontWeight: 600, textDecoration: "none", maxWidth: 230 }}>📄 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span><span style={{ color: T.textTert, fontWeight: 400 }}>· {d.by}</span></a>)}
          </div>
        </div>
        <div>
          {secHdr("Change orders", miniBtn("＋ Change order", () => setCoDraft({ label: "", amount: "", date: today() })))}
          {(j.changeOrders || []).map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 0", borderBottom: `1px solid ${T.border}` }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
              <span style={{ color: T.textTert, fontSize: 11.5 }}>{fmtDate(c.date)}</span><b>{money(c.amount)}</b>
              <button onClick={() => save("contractor_jobs", { ...j, changeOrders: (j.changeOrders || []).filter((x) => x.id !== c.id) })} style={{ background: "none", border: "none", color: T.textTert, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
            </div>
          ))}
          {coDraft && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <input autoFocus value={coDraft.label} onChange={(e) => setCoDraft({ ...coDraft, label: e.target.value })} placeholder="What's added? e.g. 2nd bathroom" style={{ ...inp, flex: 2, minWidth: 140 }} />
              <input value={coDraft.amount} onChange={(e) => setCoDraft({ ...coDraft, amount: numIn(e.target.value) })} inputMode="decimal" placeholder="$" style={{ ...inp, flex: 1, minWidth: 80 }} />
              <input type="date" value={coDraft.date} onChange={(e) => setCoDraft({ ...coDraft, date: e.target.value })} style={{ ...inp, flex: 1, minWidth: 120 }} />
              <button onClick={addCO} style={goldBtn(!!Number(numIn(coDraft.amount)))}>Add</button>
            </div>
          )}
        </div>
        <div>
          {secHdr("Payments", miniBtn("＋ Payment", () => setPayDraft({ amount: "", date: today(), note: "" })))}
          {(j.payments || []).map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 0", borderBottom: `1px solid ${T.border}` }}>
              <span style={{ flex: 1, minWidth: 0, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.note || "Payment"}</span>
              <span style={{ color: T.textTert, fontSize: 11.5 }}>{fmtDate(p.date)}</span><b style={{ color: T.green }}>{money(p.amount)}</b>
              <button onClick={() => save("contractor_jobs", { ...j, payments: (j.payments || []).filter((x) => x.id !== p.id) })} style={{ background: "none", border: "none", color: T.textTert, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
            </div>
          ))}
          {payDraft && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <input autoFocus value={payDraft.amount} onChange={(e) => setPayDraft({ ...payDraft, amount: numIn(e.target.value) })} inputMode="decimal" placeholder="$" style={{ ...inp, flex: 1, minWidth: 90 }} />
              <input type="date" value={payDraft.date} onChange={(e) => setPayDraft({ ...payDraft, date: e.target.value })} style={{ ...inp, flex: 1, minWidth: 120 }} />
              <input value={payDraft.note} onChange={(e) => setPayDraft({ ...payDraft, note: e.target.value })} placeholder="Note (check #, draw…)" style={{ ...inp, flex: 2, minWidth: 130 }} />
              <button onClick={addPay} style={goldBtn(!!Number(numIn(payDraft.amount)))}>Add</button>
            </div>
          )}
        </div>
      </>)}

      {tab2 === "tasks" && (<>
        <div>
          {secHdr(`Tasks for ${org?.name || "them"}`)}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} placeholder="Delegate a task to them…" style={{ ...inp, flex: 1 }} />
            <button onClick={addTask} style={goldBtn(!!taskDraft.trim())}>Add</button>
          </div>
          {toThem.map((t) => (
            <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
              <input type="checkbox" checked={t.status === "Completed"} onChange={() => toggleTask(t)} style={{ width: 18, height: 18, marginTop: 1, accentColor: T.gold, cursor: "pointer", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: T.text, textDecoration: t.status === "Completed" ? "line-through" : "none", opacity: t.status === "Completed" ? 0.6 : 1 }}>{t.text}</div>
                <div style={{ fontSize: 11, color: T.textTert }}>{t.status}{t.doneBy ? ` · ${t.doneBy}` : ""}</div>
              </div>
              <button onClick={() => remove("contractor_tasks", t.id)} style={{ background: "none", border: "none", color: T.textTert, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
          ))}
          {toThem.length === 0 && <div style={{ fontSize: 12.5, color: T.textTert }}>Nothing delegated on this job yet.</div>}
        </div>
        <div>
          {secHdr("Requests FROM them")}
          {fromThem.map((t) => (
            <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
              <input type="checkbox" checked={t.status === "Completed"} onChange={() => toggleTask(t)} style={{ width: 18, height: 18, marginTop: 1, accentColor: T.blue, cursor: "pointer", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: T.text, textDecoration: t.status === "Completed" ? "line-through" : "none", opacity: t.status === "Completed" ? 0.6 : 1 }}>{t.text}</div>
                <div style={{ fontSize: 11, color: T.textTert }}>from {t.createdBy || org?.name} · {fmtDate(t.createdAt)}</div>
              </div>
            </div>
          ))}
          {fromThem.length === 0 && <div style={{ fontSize: 12.5, color: T.textTert }}>No requests from them on this job.</div>}
        </div>
      </>)}

      {tab2 === "messages" && (<>
        <div ref={scrollRef} style={{ maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
          {thread.length === 0 && <div style={{ textAlign: "center", color: T.textTert, fontSize: 13, padding: "26px 0" }}>No messages on this job yet.</div>}
          {thread.map((m) => { const mine = m.side === "team"; return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%" }}>
              <div style={{ fontSize: 10, color: T.textTert, marginBottom: 2, textAlign: mine ? "right" : "left" }}>{m.author} · {fmtWhen(m.at)}</div>
              <div style={{ background: mine ? T.gold : T.bg, color: mine ? "#fff" : T.text, borderRadius: 13, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {m.text}
                {m.attachment && (m.attachment.kind === "image"
                  ? <a href={m.attachment.url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 6 }}><img src={m.attachment.url} alt="" style={{ maxWidth: 200, maxHeight: 220, borderRadius: 9, display: "block", objectFit: "cover" }} /></a>
                  : m.attachment.kind === "video"
                  ? <video src={m.attachment.url} controls playsInline preload="metadata" style={{ marginTop: 6, maxWidth: 220, width: "100%", borderRadius: 9, display: "block", background: "#000" }} />
                  : <a href={m.attachment.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, padding: "6px 9px", borderRadius: 9, background: mine ? "rgba(255,255,255,0.18)" : "#fff", color: mine ? "#fff" : T.text, textDecoration: "none", fontSize: 11.5, fontWeight: 600, maxWidth: 210 }}>📄 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.attachment.name}</span></a>)}
              </div>
            </div>
          ); })}
        </div>
        {pending && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.goldLight, border: `1px solid ${T.gold}`, borderRadius: 10 }}><span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📎 {pending.name}</span><button onClick={() => setPending(null)} style={{ background: "none", border: "none", color: T.textTert, fontSize: 15, cursor: "pointer" }}>×</button></div>}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <input ref={attRef} type="file" accept="image/*,video/*,application/pdf" onChange={pickAtt} style={{ display: "none" }} />
          <button onClick={() => attRef.current && attRef.current.click()} disabled={busy} style={{ width: 38, height: 38, flexShrink: 0, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.bg, fontSize: 15, cursor: "pointer" }}>📎</button>
          <textarea rows={1} value={msgDraft} onChange={(e) => setMsgDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }} placeholder={`Message ${org?.name}…`} disabled={busy}
            style={{ flex: 1, minWidth: 0, padding: "10px 13px", borderRadius: 16, border: `1px solid ${T.border}`, background: T.bg, fontSize: 14, outline: "none", fontFamily: "inherit", resize: "none", lineHeight: 1.4, maxHeight: 110, boxSizing: "border-box" }} />
          <button onClick={sendMsg} disabled={(!msgDraft.trim() && !pending) || busy} style={goldBtn(!!(msgDraft.trim() || pending) && !busy)}>Send</button>
        </div>
      </>)}
    </Modal>
  );
}

export function ContractorsAdminPage() {
  const { displayName } = useAuth();
  const { sharedProps } = useData();
  const { orgs, jobs, tasks, messages, docs, save, remove, error } = useContractorData();
  const [selOrgId, setSelOrgId] = useState(null);
  const [orgModal, setOrgModal] = useState(null);     // {} new or org obj
  const [jobModal, setJobModal] = useState(null);     // {} new or job obj (edit basics)
  const [openJobId, setOpenJobId] = useState(null);   // job detail view
  const [loginModal, setLoginModal] = useState(false);
  const [logins, setLogins] = useState([]);           // users rows for the selected org
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const orgList = (orgs || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const org = orgList.find((o) => String(o.id) === String(selOrgId)) || null;
  const orgJobs = (jobs || []).filter((j) => org && j.orgId === String(org.id)).sort((a, b) => (a.status === "complete") - (b.status === "complete") || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const openJob = orgJobs.find((j) => String(j.id) === String(openJobId)) || null;
  const properties = (sharedProps || []).filter((p) => !p.archived).sort((a, b) => (a.address || "").localeCompare(b.address || ""));

  // Logins at the selected company (team can read the users roster).
  useEffect(() => {
    if (!org) { setLogins([]); return; }
    let alive = true;
    supabase.from("users").select("id,name,email").eq("contractor_org_id", String(org.id)).then(({ data }) => { if (alive) setLogins(data || []); });
    return () => { alive = false; };
  }, [org?.id, loginModal]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", background: T.bg }}>
      {/* Company list */}
      <div style={{ width: isMobile ? "100%" : 300, flexShrink: 0, display: isMobile && org ? "none" : "flex", flexDirection: "column", borderRight: isMobile ? "none" : `1px solid ${T.border}`, background: T.card, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, flex: 1 }}>Contractors ({orgList.length})</div>
          <button onClick={() => setOrgModal({})} style={{ padding: "7px 13px", borderRadius: 16, border: "none", background: T.gold, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>＋ Company</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {orgList.length === 0 && orgs !== null && <div style={{ padding: 24, textAlign: "center", color: T.textTert, fontSize: 13 }}>Add your first contractor company — then create their login and jobs.</div>}
          {orgList.map((o) => {
            const n = (jobs || []).filter((jj) => jj.orgId === String(o.id) && jj.status !== "complete").length;
            const on = String(selOrgId) === String(o.id);
            return (
              <div key={o.id} onClick={() => setSelOrgId(String(o.id))} style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", background: on ? T.goldLight : "transparent" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{o.name}</div>
                <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1 }}>{n} active job{n !== 1 ? "s" : ""}{o.contactName ? ` · ${o.contactName}` : ""}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Company detail */}
      <div style={{ flex: 1, display: isMobile && !org ? "none" : "flex", flexDirection: "column", overflow: "hidden" }}>
        {!org
          ? <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: T.textSub, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 30 }}>👷</div><div style={{ fontSize: 15, fontWeight: 700 }}>Pick a contractor</div>
              <div style={{ fontSize: 13, color: T.textTert, maxWidth: 320 }}>Their jobs, logins, money and messages live here — and they see their own mirror of it in the portal.</div>
            </div>
          : <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? 14 : 20 }}>
              {isMobile && <button onClick={() => setSelOrgId(null)} style={{ background: "none", border: "none", color: T.gold, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", padding: "0 0 10px" }}>‹ All contractors</button>}
              <div style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, padding: "14px 16px", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>{org.name}</div>
                    <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
                      {org.contactName && <span>👤 {org.contactName}</span>}
                      {org.phone && <a href={`tel:${String(org.phone).replace(/[^\d+]/g, "")}`} style={{ color: T.blue, textDecoration: "none" }}>📞 {org.phone}</a>}
                      {org.email && <a href={`mailto:${org.email}`} style={{ color: T.blue, textDecoration: "none" }}>✉️ {org.email}</a>}
                      {org.address && <span>🏠 {org.address}</span>}
                    </div>
                  </div>
                  <button onClick={() => setOrgModal(org)} style={{ ...ghostBtn, padding: "7px 13px", fontSize: 12, flexShrink: 0 }}>✎ Edit</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em" }}>Portal logins:</span>
                  {logins.map((u) => <span key={u.id} title={u.email} style={{ fontSize: 12, fontWeight: 600, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 14, padding: "3px 10px", color: T.text }}>{u.name}</span>)}
                  {logins.length === 0 && <span style={{ fontSize: 12, color: T.textTert }}>none yet</span>}
                  <button onClick={() => setLoginModal(true)} style={{ padding: "4px 11px", borderRadius: 14, border: `1.5px dashed ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>＋ Login</button>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: T.text, flex: 1 }}>Jobs</div>
                <button onClick={() => setJobModal({})} style={{ padding: "8px 15px", borderRadius: 16, border: "none", background: T.gold, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>＋ New job</button>
              </div>
              {orgJobs.length === 0 && <div style={{ padding: "22px 16px", textAlign: "center", color: T.textTert, fontSize: 13, background: T.card, borderRadius: T.radius, border: `1px dashed ${T.border}` }}>No jobs yet for {org.name}.</div>}
              {orgJobs.map((j) => {
                const total = jobTotal(j), paid = jobPaid(j), days = jobDays(j);
                const openT = (tasks || []).filter((t) => String(t.jobId) === String(j.id) && t.status !== "Completed").length;
                return (
                  <div key={j.id} onClick={() => setOpenJobId(j.id)} style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, padding: "13px 16px", marginBottom: 10, cursor: "pointer", opacity: j.status === "complete" ? 0.65 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.propertyAddress}{j.title ? ` — ${j.title}` : ""}</div>
                        <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>{money(paid)} of {money(total)} paid · {money(jobLeft(j))} left{days != null && j.status !== "complete" ? ` · day ${days}` : ""}{openT ? ` · ${openT} open task${openT !== 1 ? "s" : ""}` : ""}</div>
                      </div>
                      {j.status === "complete" ? <span style={{ fontSize: 10, fontWeight: 800, background: T.bg, color: T.textSub, borderRadius: 14, padding: "3px 9px", flexShrink: 0 }}>DONE</span> : <span style={{ fontSize: 15, color: T.textTert, flexShrink: 0 }}>›</span>}
                    </div>
                  </div>
                );
              })}
            </div>}
      </div>

      {error && <div style={{ position: "fixed", bottom: 14, left: "50%", transform: "translateX(-50%)", background: "#FFF0EF", border: `1.5px solid ${T.red}`, color: T.red, borderRadius: 12, padding: "10px 16px", fontSize: 12.5, fontWeight: 600, zIndex: 500 }}>{error}</div>}
      {orgModal && <OrgModal orgModal={orgModal.id ? orgModal : null} save={save} onSaved={setSelOrgId} onClose={() => setOrgModal(null)} />}
      {loginModal && org && <LoginModal org={org} onClose={() => setLoginModal(false)} />}
      {jobModal && org && <JobModal org={org} jobModal={jobModal.id ? jobModal : null} properties={properties} save={save} onSaved={setOpenJobId} onClose={() => setJobModal(null)} />}
      {openJob && <JobDetail j={openJob} org={org} tasks={tasks} messages={messages} docs={docs} save={save} remove={remove} displayName={displayName} onEditBasics={() => setJobModal(openJob)} onClose={() => setOpenJobId(null)} />}
    </div>
  );
}
