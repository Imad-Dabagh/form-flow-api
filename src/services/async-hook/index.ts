import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestContext {
  requestId: string;
  data: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<RequestContext>();

function createRequestContext(
  data: Record<string, unknown> = {},
  requestId = randomUUID(),
): RequestContext {
  const context = { requestId, data };
  storage.enterWith(context);
  return context;
}

function runWithRequestContext<T>(
  data: Record<string, unknown>,
  callback: () => T,
  requestId = randomUUID(),
): T {
  return storage.run({ requestId, data }, callback);
}

function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

function updateRequestContext(data: Record<string, unknown>): RequestContext | undefined {
  const currentContext = storage.getStore();

  if (!currentContext) {
    return undefined;
  }

  const updatedContext = {
    ...currentContext,
    data: { ...currentContext.data, ...data },
  };

  storage.enterWith(updatedContext);
  return updatedContext;
}

export default {
  createRequestContext,
  getRequestContext,
  runWithRequestContext,
  updateRequestContext,
};
