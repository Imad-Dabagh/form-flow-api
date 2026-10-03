import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import {
  addDraftFile, currentDraft, getDraft, openDraft,
  removeDraftFile, saveDraft, submitDraft,
} from "#app/modules/form-submission/services/index";
import { tooManyRequests } from "#app/utils/errors";

const router = Router({ mergeParams: true });

router.use(rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(tooManyRequests("Draft request limit reached. Try again later.")),
}));

function draftOwner(req: Request) {
  return {
    formId: req.params.formId as string,
    organizationId: String(req.organizationAccess!.organizationId),
    userId: req.auth!.userId,
  };
}

router.post("/", async (req, res, next) => {
  try {
    const data = await openDraft(draftOwner(req));
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.get("/current", async (req, res, next) => {
  try {
    const data = await currentDraft(draftOwner(req));
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.get("/:draftId", async (req, res, next) => {
  try {
    const data = await getDraft(draftOwner(req), req.params.draftId as string);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.patch("/:draftId", async (req, res, next) => {
  try {
    const data = await saveDraft(draftOwner(req), req.params.draftId as string, req.body);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.post("/:draftId/files/:questionId", async (req, res, next) => {
  try {
    const data = await addDraftFile(draftOwner(req), req.params.draftId as string, req.params.questionId as string, req);
    res.set("Cache-Control", "no-store");
    return res.status(201).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.delete("/:draftId/files/:fileId", async (req, res, next) => {
  try {
    const data = await removeDraftFile(draftOwner(req), req.params.draftId as string, req.params.fileId as string);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ success: true, data });
  } catch (error) { return next(error); }
});

router.post("/:draftId/submit", async (req, res, next) => {
  try {
    const { replayed, ...data } = await submitDraft(draftOwner(req), req.params.draftId as string);
    return res.status(replayed ? 200 : 201).json({ success: true, data });
  } catch (error) { return next(error); }
});

export default router;
