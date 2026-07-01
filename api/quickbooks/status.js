import { getConnection, config } from "../../lib/quickbooks.js";

export default async function handler(req, res) {
  try {
    const cfg = config();
    if (!cfg.hasSecret || !cfg.hasServiceRole) {
      res.status(200).json({ connected: false, configured: false });
      return;
    }
    const conn = await getConnection();
    res.status(200).json({ connected: !!conn, configured: true, realmId: conn?.realm_id || null });
  } catch (e) {
    res.status(200).json({ connected: false, configured: true, error: e.message });
  }
}
