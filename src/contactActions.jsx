// THE uniform contact-action row — Call · Text · WhatsApp · Email — used
// everywhere a person with a phone/email shows up (lead contacts, property
// contacts, buyers, tenants, the directory, popups). One shape: clean white
// pill, colored hand-drawn icon (approved Option C). Call/Text keep all the
// smart behavior via CallA/TextA (business-line chooser on phones, in-app
// threads where wired); pass onText/onWhatsApp/onEmail to override a button
// with a custom flow (e.g. template composers).
import { T } from "./theme";
import { CallA, TextA } from "./sms";
import { PhoneIcon, SmsChatIcon, WhatsAppIcon, MailIcon } from "./icons";

export const contactPill = {
  display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 13px",
  borderRadius: 16, border: `1px solid ${T.border}`, background: "#fff", color: T.text,
  fontSize: 12, fontWeight: 700, textDecoration: "none", cursor: "pointer",
  fontFamily: "inherit", whiteSpace: "nowrap", boxSizing: "border-box", lineHeight: 1,
};

export function ContactActions({ phone, email, onInApp, templates, onTemplate, onText, onWhatsApp, onEmail, whatsapp = true, children }) {
  const d = String(phone || "").replace(/[^\d]/g, "");
  const wa = d.length === 10 ? `1${d}` : d;
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
      {phone && <CallA phone={phone} style={contactPill}><PhoneIcon size={13} color={T.text} /> Call</CallA>}
      {phone && (onText
        ? <button onClick={onText} style={contactPill}><SmsChatIcon size={13} color="#15803D" /> Text</button>
        : <TextA phone={phone} onInApp={onInApp} templates={templates} onTemplate={onTemplate} style={contactPill}><SmsChatIcon size={13} color="#15803D" /> Text</TextA>)}
      {phone && whatsapp && wa.length >= 11 && (onWhatsApp
        ? <button onClick={onWhatsApp} style={contactPill}><WhatsAppIcon size={13} /> WhatsApp</button>
        : <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" style={contactPill}><WhatsAppIcon size={13} /> WhatsApp</a>)}
      {email && (onEmail
        ? <button onClick={onEmail} style={contactPill}><MailIcon size={13} color={T.blue} /> Email</button>
        : <a href={`mailto:${email}`} style={contactPill}><MailIcon size={13} color={T.blue} /> Email</a>)}
      {children}
    </div>
  );
}
