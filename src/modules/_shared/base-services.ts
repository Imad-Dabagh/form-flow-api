import type { ClientSession, Model, PipelineStage, PopulateOptions, UpdateQuery } from "mongoose";
import Logger from "#app/services/logger/index";
import { notFound } from "#app/utils/errors";

type Entity = Record<string, unknown>;
type Query = Record<string, unknown>;
type Selection = string | string[] | Record<string, 0 | 1>;

export interface baseServiceDataPropI {
  /**
   * Required for every organization-owned lookup. The base service merges this
   * query with an id for the *ById methods, so callers can scope by tenant.
   */
  query?: Query;
  id?: string;
  payload?: Entity | Entity[];
  selection?: Selection;
  populate?: string | string[] | PopulateOptions | PopulateOptions[];
  sort?: string | Record<string, 1 | -1>;
  page?: number;
  limit?: number;
  field?: string;
  pipeline?: PipelineStage[];
  session?: ClientSession;
}

type WithId = baseServiceDataPropI & { id: string };
type WithQuery = baseServiceDataPropI & { query: Query };
type WithField = baseServiceDataPropI & { field: string };
type WithPipeline = baseServiceDataPropI & { pipeline: PipelineStage[] };
type WithPayload = baseServiceDataPropI & { payload: Entity };
type WithPayloads = baseServiceDataPropI & { payload: Entity[] };
type WithQueryAndPayload = WithQuery & { payload: Entity };
type WithIdAndPayload = WithId & { payload: Entity };

export interface baseServiceConfigPropI {
  throwIfNoResult?: boolean;
  decorator?: (data: unknown) => unknown | Promise<unknown>;
}

export type baseServiceFnI<
  TData extends baseServiceDataPropI = baseServiceDataPropI,
  TResult = unknown,
> = (
  data: TData,
  config?: baseServiceConfigPropI,
) => Promise<TResult>;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const LARGE_RESULT_WARNING_THRESHOLD = 60;

type AggregatePage = {
  docs: unknown[];
  metadata: Array<{ totalDocs: number }>;
};

const defaultConfig: Required<baseServiceConfigPropI> = {
  throwIfNoResult: false,
  decorator: (data) => data,
};

function mergeConfig(config?: baseServiceConfigPropI): Required<baseServiceConfigPropI> {
  return { ...defaultConfig, ...config };
}

function paginationOptions(data: baseServiceDataPropI) {
  const page = data.page ?? DEFAULT_PAGE;
  const requestedLimit = data.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error("Page must be a positive integer");
  }
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("Limit must be a positive integer");
  }

  const limit = Math.min(requestedLimit, MAX_LIMIT);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) {
    throw new Error("Page is too large for the requested limit");
  }

  return {
    page,
    limit,
    skip,
  };
}

function pageResult(docs: unknown[], totalDocs: number, page: number, limit: number) {
  return {
    docs,
    totalDocs,
    page,
    limit,
    totalPages: limit > 0 ? Math.ceil(totalDocs / limit) : 0,
    hasNextPage: limit > 0 && page * limit < totalDocs,
    hasPrevPage: page > 1,
  };
}

function warnIfLargeResult(Model: Model<Entity>, count: number) {
  if (count > LARGE_RESULT_WARNING_THRESHOLD) {
    Logger.warn("Large unpaginated base-service result", {
      model: Model.modelName,
      count,
    });
  }
}

function requireId(id?: string): string {
  if (!id) {
    throw new Error("An id is required for this operation");
  }

  return id;
}

function requireQuery(query?: Query): Query {
  if (!query || Object.keys(query).length === 0) {
    throw new Error("A non-empty query is required for this operation");
  }

  return query;
}

function requireUpdatePayload(payload?: Entity | Entity[]): UpdateQuery<Entity> {
  if (!payload || Array.isArray(payload) || Object.keys(payload).length === 0) {
    throw new Error("A non-empty update payload is required for this operation");
  }

  return payload as UpdateQuery<Entity>;
}

function queryById(data: WithId): Query {
  return { ...data.query, _id: requireId(data.id) };
}

function throwNotFound(Model: Model<Entity>): never {
  throw notFound(Model.modelName);
}

async function decorate(value: unknown, config?: baseServiceConfigPropI): Promise<unknown> {
  return mergeConfig(config).decorator(value);
}

async function decorateAll(
  values: unknown[],
  config?: baseServiceConfigPropI,
  session?: ClientSession,
): Promise<unknown[]> {
  if (!session) return Promise.all(values.map((value) => decorate(value, config)));

  const decorated: unknown[] = [];
  for (const value of values) decorated.push(await decorate(value, config));
  return decorated;
}

function applySession<T extends { session(session: ClientSession | null): T }>(
  operation: T,
  session?: ClientSession,
): T {
  if (session) operation.session(session);
  return operation;
}

async function countDocuments(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  const count = await applySession(Model.countDocuments(data.query ?? {}), data.session);

  if (mergeConfig(config).throwIfNoResult && count === 0) {
    throwNotFound(Model);
  }

  return count;
}

async function existsById(
  Model: Model<Entity>,
  data: WithId,
  config?: baseServiceConfigPropI,
) {
  const result = Boolean(await applySession(Model.exists(queryById(data)), data.session));

  if (mergeConfig(config).throwIfNoResult && !result) {
    throwNotFound(Model);
  }

  return result;
}

async function exists(
  Model: Model<Entity>,
  data: WithQuery,
  config?: baseServiceConfigPropI,
) {
  const result = Boolean(await applySession(Model.exists(requireQuery(data.query)), data.session));

  if (mergeConfig(config).throwIfNoResult && !result) {
    throwNotFound(Model);
  }

  return result;
}

async function distinct(
  Model: Model<Entity>,
  data: WithField,
  config?: baseServiceConfigPropI,
) {
  if (!data.field) {
    throw new Error("A field is required for distinct");
  }

  const result = await applySession(Model.distinct(data.field, data.query ?? {}), data.session);
  if (mergeConfig(config).throwIfNoResult && result.length === 0) {
    throwNotFound(Model);
  }
  return decorateAll(result, config, data.session);
}

function buildFindQuery(Model: Model<Entity>, data: baseServiceDataPropI) {
  const filter = data.query ?? {};
  const findQuery = Model.find(filter).sort(data.sort).lean();
  if (data.selection) findQuery.select(data.selection);
  if (typeof data.populate === "string") findQuery.populate(data.populate);
  else if (data.populate) findQuery.populate(data.populate);
  return applySession(findQuery, data.session);
}

async function fetchAll(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  const filter = data.query ?? {};
  const { page, limit, skip } = paginationOptions(data);
  const findQuery = buildFindQuery(Model, data).skip(skip).limit(limit);

  const countQuery = applySession(Model.countDocuments(filter), data.session);
  // MongoDB does not support parallel operations on the same transaction session.
  let docs: Awaited<ReturnType<typeof buildFindQuery>>;
  let totalDocs: number;
  if (data.session) {
    docs = await findQuery;
    totalDocs = await countQuery;
  } else {
    [docs, totalDocs] = await Promise.all([findQuery, countQuery]);
  }
  if (mergeConfig(config).throwIfNoResult && totalDocs === 0) {
    throwNotFound(Model);
  }

  return pageResult(await decorateAll(docs, config, data.session), totalDocs, page, limit);
}

async function findMany(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  if (data.page !== undefined || data.limit !== undefined) {
    throw new Error("Page and limit cannot be used without pagination");
  }

  const docs = await buildFindQuery(Model, data);
  if (mergeConfig(config).throwIfNoResult && docs.length === 0) {
    throwNotFound(Model);
  }

  warnIfLargeResult(Model, docs.length);
  return decorateAll(docs, config, data.session);
}

async function fetchById(
  Model: Model<Entity>,
  data: WithId,
  config?: baseServiceConfigPropI,
) {
  const findQuery = Model.findOne(queryById(data)).lean();
  if (data.selection) findQuery.select(data.selection);
  if (typeof data.populate === "string") findQuery.populate(data.populate);
  else if (data.populate) findQuery.populate(data.populate);
  const result = await applySession(findQuery, data.session);

  if (result) {
    return decorate(result, config);
  }

  if (mergeConfig(config).throwIfNoResult) {
    throwNotFound(Model);
  }

  return null;
}

async function fetchOne(
  Model: Model<Entity>,
  data: WithQuery,
  config?: baseServiceConfigPropI,
) {
  const findQuery = Model.findOne(requireQuery(data.query)).sort(data.sort).lean();
  if (data.selection) findQuery.select(data.selection);
  if (typeof data.populate === "string") findQuery.populate(data.populate);
  else if (data.populate) findQuery.populate(data.populate);
  const result = await applySession(findQuery, data.session);

  if (result) {
    return decorate(result, config);
  }

  if (mergeConfig(config).throwIfNoResult) {
    throwNotFound(Model);
  }

  return null;
}

async function createOne(
  Model: Model<Entity>,
  data: WithPayload,
  config?: baseServiceConfigPropI,
) {
  if (!data.payload || Array.isArray(data.payload)) {
    throw new Error("A single payload is required for createOne");
  }

  const [result] = await Model.create([data.payload], { session: data.session });
  return decorate(result.toObject(), config);
}

async function createMany(
  Model: Model<Entity>,
  data: WithPayloads,
  config?: baseServiceConfigPropI,
) {
  if (!Array.isArray(data.payload)) {
    throw new Error("An array payload is required for createMany");
  }

  const result = await Model.insertMany(data.payload, { session: data.session });
  return decorateAll(
    result.map((document) => document.toObject()),
    config,
    data.session,
  );
}

async function updateOne(
  Model: Model<Entity>,
  data: WithQueryAndPayload,
  config?: baseServiceConfigPropI,
) {
  const updateQuery = Model.findOneAndUpdate(
    requireQuery(data.query),
    requireUpdatePayload(data.payload),
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (data.selection) updateQuery.select(data.selection);
  if (typeof data.populate === "string") updateQuery.populate(data.populate);
  else if (data.populate) updateQuery.populate(data.populate);
  const result = await applySession(updateQuery, data.session);

  if (result) {
    return decorate(result, config);
  }

  if (mergeConfig(config).throwIfNoResult) {
    throwNotFound(Model);
  }

  return null;
}

async function updateById(
  Model: Model<Entity>,
  data: WithIdAndPayload,
  config?: baseServiceConfigPropI,
) {
  return updateOne(Model, { ...data, query: queryById(data) }, config);
}

async function updateMany(
  Model: Model<Entity>,
  data: WithQueryAndPayload,
  config?: baseServiceConfigPropI,
) {
  const result = await Model.updateMany(requireQuery(data.query), requireUpdatePayload(data.payload), {
    runValidators: true,
    session: data.session,
  });
  if (mergeConfig(config).throwIfNoResult && result.matchedCount === 0) {
    throwNotFound(Model);
  }
  return decorate(result, config);
}

async function deleteOne(
  Model: Model<Entity>,
  data: WithQuery,
  config?: baseServiceConfigPropI,
) {
  const deleteQuery = Model.findOneAndDelete(requireQuery(data.query)).lean();
  if (data.selection) deleteQuery.select(data.selection);
  if (typeof data.populate === "string") deleteQuery.populate(data.populate);
  else if (data.populate) deleteQuery.populate(data.populate);
  const result = await applySession(deleteQuery, data.session);
  if (!result) {
    if (mergeConfig(config).throwIfNoResult) throwNotFound(Model);
    return null;
  }
  return decorate(result, config);
}

async function deleteById(
  Model: Model<Entity>,
  data: WithId,
  config?: baseServiceConfigPropI,
) {
  return deleteOne(Model, { ...data, query: queryById(data) }, config);
}

async function deleteMany(
  Model: Model<Entity>,
  data: WithQuery,
  config?: baseServiceConfigPropI,
) {
  // Bulk deletion requires an explicit filter; tenant-owned models need tenant scope.
  const result = await Model.deleteMany(requireQuery(data.query), { session: data.session });
  if (mergeConfig(config).throwIfNoResult && result.deletedCount === 0) {
    throwNotFound(Model);
  }
  return decorate(result, config);
}

async function aggregatePage(
  Model: Model<Entity>,
  data: WithPipeline,
  config?: baseServiceConfigPropI,
) {
  const { page, limit, skip } = paginationOptions(data);
  const aggregation = Model.aggregate<AggregatePage>(data.pipeline ?? []);
  if (data.sort) aggregation.sort(data.sort);
  aggregation.facet({
    docs: [{ $skip: skip }, { $limit: limit }],
    metadata: [{ $count: "totalDocs" }],
  });

  const [result] = await applySession(aggregation, data.session);
  const totalDocs = result?.metadata[0]?.totalDocs ?? 0;
  if (mergeConfig(config).throwIfNoResult && totalDocs === 0) {
    throwNotFound(Model);
  }

  return pageResult(
    await decorateAll(result?.docs ?? [], config, data.session),
    totalDocs,
    page,
    limit,
  );
}

async function runAggregation(
  Model: Model<Entity>,
  data: WithPipeline,
  config?: baseServiceConfigPropI,
) {
  if (data.page !== undefined || data.limit !== undefined) {
    throw new Error("Page and limit cannot be used without pagination");
  }

  const aggregation = Model.aggregate(data.pipeline ?? []);
  if (data.sort) aggregation.sort(data.sort);
  const docs = await applySession(aggregation, data.session);
  if (mergeConfig(config).throwIfNoResult && docs.length === 0) {
    throwNotFound(Model);
  }

  warnIfLargeResult(Model, docs.length);
  return decorateAll(docs, config, data.session);
}

function wrapHelper<TData extends baseServiceDataPropI, TResult>(
  Model: Model<Entity>,
  fn: (
    Model: Model<Entity>,
    data: TData,
    config?: baseServiceConfigPropI,
  ) => Promise<TResult>,
) {
  return (data: TData, config?: baseServiceConfigPropI) => fn(Model, data, config);
}

function BaseServices(Model: Model<Entity>) {
  return {
    countDocuments: wrapHelper(Model, countDocuments),
    existsById: wrapHelper(Model, existsById),
    exists: wrapHelper(Model, exists),
    distinct: wrapHelper(Model, distinct),
    fetchAll: wrapHelper(Model, fetchAll),
    findMany: wrapHelper(Model, findMany),
    fetchById: wrapHelper(Model, fetchById),
    fetchOne: wrapHelper(Model, fetchOne),
    createOne: wrapHelper(Model, createOne),
    createMany: wrapHelper(Model, createMany),
    updateById: wrapHelper(Model, updateById),
    updateOne: wrapHelper(Model, updateOne),
    updateMany: wrapHelper(Model, updateMany),
    deleteById: wrapHelper(Model, deleteById),
    deleteOne: wrapHelper(Model, deleteOne),
    deleteMany: wrapHelper(Model, deleteMany),
    aggregatePage: wrapHelper(Model, aggregatePage),
    runAggregation: wrapHelper(Model, runAggregation),
  };
}

export default BaseServices;
export { BaseServices };
