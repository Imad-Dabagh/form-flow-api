import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../../user/models";
import { conflict, internalError, invalidCredentials, unauthenticated } from "../../../utils/errors";
import { Logger } from "../../../services";

const PASSWORD_SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRES_IN = "7d";

export interface RegisterUserInput {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface AuthenticationResult {
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

function getJwtSecret(): string {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    Logger.error("JWT_SECRET is missing while issuing an access token");
    throw internalError();
  }

  return jwtSecret;
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
  const token = jwt.sign({ sub: publicUser.id }, getJwtSecret(), {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });

  return { token, user: publicUser };
}

export async function registerUser(input: RegisterUserInput): Promise<AuthenticationResult> {
  getJwtSecret();

  const email = input.email.toLowerCase();
  const username = input.username.toLowerCase();
  const existingUser = await User.exists({ $or: [{ email }, { username }] });

  if (existingUser) {
    throw conflict("An account with this email or username already exists.");
  }

  const password = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS);
  const user = await User.create({
    email,
    username,
    password,
    firstName: input.firstName ?? "",
    lastName: input.lastName ?? "",
  });

  return createAuthenticationResult(user);
}

export async function loginUser(emailInput: string, password: string): Promise<AuthenticationResult> {
  const email = emailInput.toLowerCase();
  const user = await User.findOne({ email }).select("+password");

  if (!user?.password || !(await bcrypt.compare(password, user.password))) {
    throw invalidCredentials();
  }

  return createAuthenticationResult(user);
}

export async function getCurrentUser(userId: string): Promise<AuthenticationResult["user"]> {
  const user = await User.findById(userId);

  if (!user) {
    throw unauthenticated();
  }

  return toPublicUser(user);
}
