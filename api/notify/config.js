// Serves the VAPID public key to the client so it can subscribe to push.
// Public key is safe to expose; the private key never leaves the server.
export default function handler(req, res) {
  res.status(200).json({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "" });
}
