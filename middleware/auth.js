/**
 * Simple API key authentication middleware.
 * Validates the Authorization header against the API_KEY env var.
 * If no API_KEY is set, all requests are allowed (dev mode).
 */
function authMiddleware(req, res, next) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return next(); // No key configured — open access

  const authHeader = req.headers.authorization || req.headers.apikey || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (token === apiKey) return next();

  return res.status(401).json({
    error: "Unauthorized",
    message: "Invalid or missing API key. Send it as Authorization: Bearer <key>",
  });
}

module.exports = authMiddleware;
