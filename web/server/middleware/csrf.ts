import type { Request, Response, NextFunction } from "express";

const ALLOWED_ORIGINS = [
  "http://localhost:3847",
  "http://127.0.0.1:3847",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection middleware that validates the Origin header
 * on mutating requests (POST, PUT, DELETE).
 *
 * Allows requests with safe HTTP methods (GET, HEAD, OPTIONS) to pass through.
 * Returns HTTP 403 if the Origin header is missing or not in the allowlist.
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;

  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({
      error: "Forbidden: invalid or missing Origin header",
    });
    return;
  }

  next();
}
