import type { baseServiceDataPropI } from "../modules/_shared";

interface CleanQueryParamsOptions {
  allowedPopulate?: readonly string[];
  allowedSelect?: readonly string[];
  allowedSort?: readonly string[];
  defaultSort?: Record<string, 1 | -1>;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getPositiveInteger(value: unknown): number | undefined {
  const parsed = Number.parseInt(getString(value) ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default function cleanQueryParams(
  params: Record<string, unknown>,
  options: CleanQueryParamsOptions = {},
): baseServiceDataPropI {
  const { selection, populate, page, limit, sort, ...query } = params;
  const allowedSelect = new Set(options.allowedSelect ?? []);
  const allowedPopulate = new Set(options.allowedPopulate ?? []);
  const allowedSort = new Set(options.allowedSort ?? []);
  const selectedFields = (getString(selection) ?? "")
    .split(",")
    .filter((field) => field && allowedSelect.has(field.replace(/^-/, "")));
  const requestedSort = getString(sort);
  const sortField = requestedSort?.replace(/^-/, "");

  return {
    query,
    selection: selectedFields.length > 0 ? selectedFields : undefined,
    populate: (getString(populate) ?? "")
      .split(",")
      .filter((path) => path && allowedPopulate.has(path)),
    sort:
      sortField && allowedSort.has(sortField)
        ? { [sortField]: requestedSort?.startsWith("-") ? -1 : 1 }
        : options.defaultSort,
    page: getPositiveInteger(page),
    limit: getPositiveInteger(limit),
  };
}
