import { Router } from "express";
import { z } from "zod";
import { authenticate, validate } from "#app/middlewares/index";
import MembershipModule from "#app/modules/membership/index";
import UserModule from "#app/modules/user/index";
import { unauthenticated } from "#app/utils/errors";
import { httpsUrlSchema } from "#app/utils/https-url-schema";

const router = Router();

interface ProfileUser {
  _id: unknown;
  email: string;
  firstName?: string;
  lastName?: string;
  profilePic?: string;
  coverPhoto?: string;
  phone?: string;
  shortDescription?: string;
  onboardingCompletedAt?: Date | null;
}

function toProfileResponse(
  user: ProfileUser,
  auth: { isEmailVerified: boolean; isSuperAdmin: boolean },
) {
  return {
    id: String(user._id),
    email: user.email,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    profilePic: user.profilePic ?? "",
    coverPhoto: user.coverPhoto ?? "",
    phone: user.phone ?? "",
    shortDescription: user.shortDescription ?? "",
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
    isEmailVerified: auth.isEmailVerified,
    isSuperAdmin: auth.isSuperAdmin,
  };
}

/**
 * GET /api/me
 */
router.get("/", authenticate, async (req, res, next) => {
  try {
    const user = (await UserModule.services.fetchById({
      id: req.auth!.userId,
    })) as ProfileUser | null;

    if (!user) {
      throw unauthenticated();
    }

    return res.status(200).json({
      success: true,
      data: toProfileResponse(user, req.auth!),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * PUT /api/me
 */
router.put(
  "/",
  authenticate,
  validate({
    body: z.strictObject(
      {
        firstName: z
          .string({ error: "firstName is required." })
          .trim()
          .min(1, "firstName is required.")
          .max(50, "firstName must be 50 characters or fewer."),
        lastName: z
          .string({ error: "lastName is required." })
          .trim()
          .min(1, "lastName is required.")
          .max(50, "lastName must be 50 characters or fewer."),
        profilePic: httpsUrlSchema("profilePic").optional(),
        coverPhoto: httpsUrlSchema("coverPhoto").optional(),
        phone: z
          .string({ error: "phone must be a string." })
          .trim()
          .max(30, "phone must be 30 characters or fewer.")
          .optional(),
        shortDescription: z
          .string({ error: "shortDescription must be a string." })
          .trim()
          .max(500, "shortDescription must be 500 characters or fewer.")
          .optional(),
      },
      {
        error:
          "Only firstName, lastName, profilePic, coverPhoto, phone, and shortDescription can be updated.",
      },
    ),
  }),
  async (req, res, next) => {
    try {
      const body = req.body;
      const firstName = body.firstName.trim();
      const lastName = body.lastName.trim();
      const profilePic = body.profilePic?.trim();
      const coverPhoto = body.coverPhoto?.trim();
      const phone = body.phone?.trim();
      const shortDescription = body.shortDescription?.trim();
      const user = (await UserModule.services.fetchById({
        id: req.auth!.userId,
      })) as ProfileUser | null;

      if (!user) {
        throw unauthenticated();
      }

      const updates: Record<string, string | Date> = { firstName, lastName };
      if (profilePic !== undefined) {
        updates.profilePic = profilePic;
      }
      if (coverPhoto !== undefined) {
        updates.coverPhoto = coverPhoto;
      }
      if (phone !== undefined) {
        updates.phone = phone;
      }
      if (shortDescription !== undefined) {
        updates.shortDescription = shortDescription;
      }
      const hasOrganization = await MembershipModule.services.exists({
        query: { userId: req.auth!.userId },
      });

      if (hasOrganization && !user.onboardingCompletedAt) {
        updates.onboardingCompletedAt = new Date();
      }

      const updatedUser = (await UserModule.services.updateById({
        id: req.auth!.userId,
        payload: { $set: updates },
      })) as ProfileUser | null;
      if (!updatedUser) throw unauthenticated();

      return res.status(200).json({
        success: true,
        data: toProfileResponse(updatedUser, req.auth!),
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
