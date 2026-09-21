import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import config from "../../config";
import User from "../../modules/user/models";
import { badRequest, conflict, invalidCredentials } from "../../utils/errors";

const router = Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;
const PASSWORD_SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRES_IN = "7d";

interface AuthenticationResult {
  token: string;
  user: {
    id: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    profilePic: string;
    isEmailVerified: boolean;
    platformRoles: string[];
  };
}

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

function toPublicUser(user: {
  _id: unknown;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  profilePic?: string;
  isEmailVerified?: boolean;
  platformRoles?: string[];
}): AuthenticationResult["user"] {
  return {
    id: String(user._id),
    email: user.email,
    username: user.username,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    profilePic: user.profilePic ?? "",
    isEmailVerified: user.isEmailVerified ?? false,
    platformRoles: user.platformRoles ?? [],
  };
}

function createAuthenticationResult(user: Parameters<typeof toPublicUser>[0]): AuthenticationResult {
  const publicUser = toPublicUser(user);
  const token = jwt.sign({ sub: publicUser.id }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });

  return { token, user: publicUser };
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

    const normalizedEmail = email.toLowerCase();
    const normalizedUsername = username.toLowerCase();
    const existingUser = await User.exists({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    });

    if (existingUser) {
      throw conflict("An account with this email or username already exists.");
    }

    const hashedPassword = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    const user = await User.create({
      email: normalizedEmail,
      username: normalizedUsername,
      password: hashedPassword,
      firstName: optionalString(body, "firstName"),
      lastName: optionalString(body, "lastName"),
    });
    const authentication = createAuthenticationResult(user);

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
    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");

    if (!user?.password || !(await bcrypt.compare(password, user.password))) {
      throw invalidCredentials();
    }

    const authentication = createAuthenticationResult(user);

    return res.status(200).json({ success: true, data: authentication });
  } catch (error) {
    return next(error);
  }
});

export default router;
