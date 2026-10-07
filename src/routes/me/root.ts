import { Router } from "express";
import { z } from "zod";
import { authenticate, validate } from "#app/middlewares/index";
import Membership from "#app/modules/membership/models/index";
import User from "#app/modules/user/models/index";
import { unauthenticated } from "#app/utils/errors";
import { httpsUrlSchema } from "#app/utils/https-url-schema";

const router = Router();
function toProfileResponse(
  user: {
    _id: unknown;
    email: string;
    firstName?: string;
    lastName?: string;
    profilePic?: string;
    coverPhoto?: string;
    phone?: string;
    shortDescription?: string;
    onboardingCompletedAt?: Date | null;
  },
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
    const user = await User.findById(req.auth!.userId);

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
      const user = await User.findById(req.auth!.userId);

      if (!user) {
        throw unauthenticated();
      }

      user.firstName = firstName;
      user.lastName = lastName;
      if (profilePic !== undefined) {
        user.profilePic = profilePic;
      }
      if (coverPhoto !== undefined) {
        user.coverPhoto = coverPhoto;
      }
      if (phone !== undefined) {
        user.phone = phone;
      }
      if (shortDescription !== undefined) {
        user.shortDescription = shortDescription;
      }
      const hasOrganization = await Membership.exists({
        userId: req.auth!.userId,
      });

      if (hasOrganization) {
        user.onboardingCompletedAt ??= new Date();
      }

      await user.save();

      return res.status(200).json({
        success: true,
        data: toProfileResponse(user, req.auth!),
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
