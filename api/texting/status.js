// Is business texting (Quo) connected? The app checks this to decide whether
// Text buttons open real in-app threads or fall back to the phone's sms: links.
import { config } from "../../lib/quo.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const cfg = config();
  res.status(200).json({ connected: cfg.configured, from: cfg.configured ? cfg.from : null });
}
