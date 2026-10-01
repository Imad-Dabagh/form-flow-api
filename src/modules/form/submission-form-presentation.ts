interface SubmissionFormSource {
  _id: unknown;
  type: string;
  name: string;
  description?: string;
  displayMode?: string;
  isClosed?: boolean;
  sections: Array<{
    _id: string;
    title: string;
    description?: string;
    isHidden?: boolean;
    questions: Array<{
      _id: string;
      title: string;
      description?: string;
      placeholder?: string;
      inputType: string;
      isRequired?: boolean;
      options?: Array<{ label: string; value: string }>;
      typeConfig?: unknown;
      validation?: unknown;
      defaultValue?: unknown;
    }>;
  }>;
}

/** Only fields needed to fill out a form; answer keys and internal fields stay private. */
export function toSubmissionFormPresentation(form: SubmissionFormSource) {
  return {
    id: String(form._id),
    type: form.type,
    name: form.name,
    description: form.description ?? "",
    displayMode: form.displayMode ?? "SINGLE_PAGE",
    isClosed: form.isClosed ?? false,
    sections: form.sections
      .filter((section) => !section.isHidden)
      .map((section) => ({
        _id: section._id,
        title: section.title,
        description: section.description,
        questions: section.questions.map((question) => ({
          _id: question._id,
          title: question.title,
          description: question.description,
          placeholder: question.placeholder,
          inputType: question.inputType,
          isRequired: question.isRequired,
          options: question.options?.map((option) => ({
            label: option.label,
            value: option.value,
          })),
          typeConfig: question.typeConfig,
          validation: question.validation,
          defaultValue: question.defaultValue,
        })),
      })),
  };
}
