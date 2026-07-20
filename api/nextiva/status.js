// Is Nextiva texting connected? The app checks this to decide whether the Text
// buttons send through Nextiva or fall back to the phone's built-in texting.
import { config } from "../../lib/nextiva.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const cfg = config();
  res.status(200).json({ connected: cfg.configured, from: cfg.configured ? cfg.from : null });
}
