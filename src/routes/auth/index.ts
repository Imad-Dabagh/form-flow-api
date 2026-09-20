import { Router } from "express";
import AuthModule from "../../modules/auth";
import { badRequest } from "../../utils/errors";

const router = Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;

function getBody(req: { body: unknown }): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw badRequest("A JSON object is required.");
  }

  return req.body as Record<string, unknown>;
}

function requiredString(
  body: Record<string, unknown>,
  field: string,
  { trim = true }: { trim?: boolean } = {},
): string {
  const value = body[field];

  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required.`);
  }

  return trim ? value.trim() : value;
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string.`);
  }

  return value.trim();
}

function validateEmail(email: string): void {
  if (!EMAIL_PATTERN.test(email)) {
    throw badRequest("email must be a valid email address.");
  }
}

function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 72) {
    throw badRequest("password must be between 8 and 72 characters.");
  }
}

/**
 * POST /auth/register
 */
router.post("/register", async (req, res, next) => {
  try {
    const body = getBody(req);
    const email = requiredString(body, "email");
    const username = requiredString(body, "username");
    const password = requiredString(body, "password", { trim: false });

    validateEmail(email);
    validatePassword(password);

    if (!USERNAME_PATTERN.test(username)) {
      throw badRequest("username must be 3 to 32 letters, numbers, or underscores.");
    }

    const authentication = await AuthModule.services.registerUser({
      email,
      username,
      password,
      firstName: optionalString(body, "firstName"),
      lastName: optionalString(body, "lastName"),
    });

    return res.status(201).json({ success: true, data: authentication });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /auth/login
 */
router.post("/login", async (req, res, next) => {
  try {
    const body = getBody(req);
    const email = requiredString(body, "email");
    const password = requiredString(body, "password", { trim: false });

    validateEmail(email);
    const authentication = await AuthModule.services.loginUser(email, password);

    return res.status(200).json({ success: true, data: authentication });
  } catch (error) {
    return next(error);
  }
});

export default router;
