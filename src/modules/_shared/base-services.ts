import type { Model, PipelineStage, PopulateOptions, UpdateQuery } from "mongoose";
import { notFound } from "../../utils/errors.js";

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
  pagination?: boolean;
  field?: string;
  pipeline?: PipelineStage[];
}

export interface baseServiceConfigPropI {
  throwIfNoResult?: boolean;
  decorator?: (data: unknown) => unknown | Promise<unknown>;
}

export type baseServiceFnI = (
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) => Promise<unknown>;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const defaultConfig: Required<baseServiceConfigPropI> = {
  throwIfNoResult: false,
  decorator: (data) => data,
};

function mergeConfig(config?: baseServiceConfigPropI): Required<baseServiceConfigPropI> {
  return { ...defaultConfig, ...config };
}

function requireId(id?: string): string {
  if (!id) {
    throw new Error("An id is required for this operation");
  }

  return id;
}

function queryById(data: baseServiceDataPropI): Query {
  return { ...data.query, _id: requireId(data.id) };
}

function throwNotFound(Model: Model<Entity>): never {
  throw notFound(Model.modelName);
}

async function decorate(
  value: unknown,
  config?: baseServiceConfigPropI,
): Promise<unknown> {
  return mergeConfig(config).decorator(value);
}

function applyPopulate<T>(query: T, populate?: baseServiceDataPropI["populate"]): T {
  if (populate && "populate" in (query as object)) {
    (query as { populate(value: baseServiceDataPropI["populate"]): void }).populate(populate);
  }

  return query;
}

async function countDocuments(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  const count = await Model.countDocuments(data.query ?? {});

  if (mergeConfig(config).throwIfNoResult && count === 0) {
    throwNotFound(Model);
  }

  return count;
}

async function existsById(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  const result = await Model.exists(queryById(data));

  if (mergeConfig(config).throwIfNoResult && !result) {
    throwNotFound(Model);
  }

  return result;
}

async function exists(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  const result = await Model.exists(data.query ?? {});

  if (mergeConfig(config).throwIfNoResult && !result) {
    throwNotFound(Model);
  }

  return result;
}

async function distinct(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  if (!data.field) {
    throw new Error("A field is required for distinct");
  }

  const result = await Model.distinct(data.field, data.query ?? {});
  return Promise.all(result.map((value) => decorate(value, config)));
}

async function fetchAll(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  const filter = data.query ?? {};
  const findQuery = applyPopulate(
    Model.find(filter).select(data.selection as never).sort(data.sort).lean(),
    data.populate,
  );

  if (data.pagination === false) {
    if (data.limit) {
      findQuery.limit(Math.min(Math.max(data.limit, 1), MAX_LIMIT));
    }

    const docs = await findQuery;
    if (mergeConfig(config).throwIfNoResult && docs.length === 0) {
      throwNotFound(Model);
    }

    return Promise.all(docs.map((doc) => decorate(doc, config)));
  }

  const page = Math.max(data.page ?? DEFAULT_PAGE, 1);
  const limit = Math.min(Math.max(data.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  findQuery.skip((page - 1) * limit).limit(limit);

  const [docs, totalDocs] = await Promise.all([findQuery, Model.countDocuments(filter)]);
  if (mergeConfig(config).throwIfNoResult && docs.length === 0) {
    throwNotFound(Model);
  }

  return {
    docs: await Promise.all(docs.map((doc) => decorate(doc, config))),
    totalDocs,
    page,
    limit,
    totalPages: Math.ceil(totalDocs / limit),
    hasNextPage: page * limit < totalDocs,
    hasPrevPage: page > 1,
  };
}

async function fetchById(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  const result = await applyPopulate(
    Model.findOne(queryById(data)).select(data.selection as never).lean(),
    data.populate,
  );

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
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  const result = await applyPopulate(
    Model.findOne(data.query ?? {}).select(data.selection as never).sort(data.sort).lean(),
    data.populate,
  );

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
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  if (!data.payload || Array.isArray(data.payload)) {
    throw new Error("A single payload is required for createOne");
  }

  const result = await Model.create(data.payload);
  return decorate(result.toObject(), config);
}

async function createMany(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  if (!Array.isArray(data.payload)) {
    throw new Error("An array payload is required for createMany");
  }

  const result = await Model.insertMany(data.payload);
  return Promise.all(result.map((document) => decorate(document.toObject(), config)));
}

async function updateOne(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  const result = await applyPopulate(
    Model.findOneAndUpdate(data.query ?? {}, data.payload as UpdateQuery<Entity>, {
      new: true,
      runValidators: true,
    })
      .select(data.selection as never)
      .lean(),
    data.populate,
  );

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
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  return updateOne(Model, { ...data, query: queryById(data) }, config);
}

async function updateMany(Model: Model<Entity>, data: baseServiceDataPropI) {
  return Model.updateMany(data.query ?? {}, data.payload as UpdateQuery<Entity>);
}

async function disableById(Model: Model<Entity>, data: baseServiceDataPropI) {
  // Useful for future models with an isDisabled field; FormFlow does not use it yet.
  return Model.findOneAndUpdate(queryById(data), { isDisabled: true }, { new: true }).lean();
}

async function archiveById(Model: Model<Entity>, data: baseServiceDataPropI) {
  return Model.findOneAndUpdate(queryById(data), { archivedAt: new Date() }, { new: true }).lean();
}

async function deleteOne(Model: Model<Entity>, data: baseServiceDataPropI) {
  return Model.findOneAndDelete(data.query ?? {}).lean();
}

async function deleteById(Model: Model<Entity>, data: baseServiceDataPropI) {
  return deleteOne(Model, { ...data, query: queryById(data) });
}

async function deleteMany(Model: Model<Entity>, data: baseServiceDataPropI) {
  // Keep for maintenance jobs only; callers must always supply a tenant-scoped query.
  return Model.deleteMany(data.query ?? {});
}

async function aggregate(
  Model: Model<Entity>,
  data: baseServiceDataPropI,
  config?: baseServiceConfigPropI,
) {
  // Keep native aggregation for reporting later. Start pipelines with organizationId matching.
  const result = await Model.aggregate(data.pipeline ?? []);
  return decorate(result, config);
}

function wrapHelper(
  Model: Model<Entity>,
  fn: (Model: Model<Entity>, data: baseServiceDataPropI, config?: baseServiceConfigPropI) => Promise<unknown>,
) {
  return (data: baseServiceDataPropI, config?: baseServiceConfigPropI) => fn(Model, data, config);
}

function BaseServices(Model: Model<Entity>) {
  return {
    countDocuments: wrapHelper(Model, countDocuments),
    existsById: wrapHelper(Model, existsById),
    exists: wrapHelper(Model, exists),
    distinct: wrapHelper(Model, distinct),
    fetchAll: wrapHelper(Model, fetchAll),
    fetchById: wrapHelper(Model, fetchById),
    fetchOne: wrapHelper(Model, fetchOne),
    createOne: wrapHelper(Model, createOne),
    createMany: wrapHelper(Model, createMany),
    updateById: wrapHelper(Model, updateById),
    updateOne: wrapHelper(Model, updateOne),
    updateMany: wrapHelper(Model, updateMany),
    disableById: wrapHelper(Model, disableById),
    archiveById: wrapHelper(Model, archiveById),
    deleteById: wrapHelper(Model, deleteById),
    deleteOne: wrapHelper(Model, deleteOne),
    deleteMany: wrapHelper(Model, deleteMany),
    aggregate: wrapHelper(Model, aggregate),
    aggregateWithoutPaginate: wrapHelper(Model, aggregate),
  };
}

export default BaseServices;
export { BaseServices };
