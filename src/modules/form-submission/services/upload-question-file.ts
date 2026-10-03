import type { Request } from "express";
import { receiveFileUpload } from "#app/modules/file-upload/index";
import type { UploadCategory } from "#app/modules/file-upload/policy";
import { storageProvider } from "#app/services/index";
import { badRequest, notFound } from "#app/utils/errors";

interface UploadableForm {
  organizationId: { toString(): string };
  isClosed: boolean;
  sections: Array<{
    questions: Array<{
      _id: string;
      inputType: string;
      typeConfig?: {
        uploadCategory?: UploadCategory;
        allowedExtensions?: string[];
      };
    }>;
  }>;
}

/** Form access is resolved by the caller, so this can also serve public submissions. */
export async function uploadQuestionFile({ request, form, questionId }: {
  request: Request;
  form: UploadableForm;
  questionId: string;
}) {
  if (form.isClosed) throw badRequest("This form is closed.");

  const question = form.sections.flatMap((section) => section.questions)
    .find((item) => item._id === questionId && item.inputType === "file");
  if (!question) throw notFound("File question");

  const category = question.typeConfig?.uploadCategory ?? "all";

  return receiveFileUpload(request, {
    tenantId: `organization-${form.organizationId.toString()}`,
    storage: storageProvider,
    policy: {
      category,
      allowedExtensions: category === "all" ? [] : question.typeConfig?.allowedExtensions ?? [],
    },
  });
}
