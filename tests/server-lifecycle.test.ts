import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  disconnect: vi.fn(),
  server: {
    listening: false,
    listen: vi.fn(),
    close: vi.fn(),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
    on: vi.fn(),
  },
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("node:http", () => ({ createServer: () => mocks.server }));
vi.mock("mongoose", () => ({ default: { disconnect: mocks.disconnect } }));
vi.mock("../src/loaders/index.js", () => ({ default: mocks.load }));
vi.mock("../src/config/index.js", () => ({ default: { port: 4000, shutdownTimeoutMs: 100 } }));
vi.mock("../src/services/index.js", () => ({ Logger: mocks.logger }));

const signals = new Map<string, () => void>();
let finishRequests: () => void;
let serverError: (error: Error) => void;

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  signals.clear();
  mocks.server.listening = false;
  mocks.load.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.server.listen.mockImplementation(() => {
    mocks.server.listening = true;
  });
  mocks.server.close.mockImplementation((callback: () => void) => {
    finishRequests = callback;
  });
  mocks.server.on.mockImplementation((_event: string, listener: (error: Error) => void) => {
    serverError = listener;
  });
  vi.spyOn(process, "on").mockImplementation(((event: string, listener: () => void) => {
    signals.set(event, listener);
    return process;
  }) as typeof process.on);
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("server lifecycle", () => {
  it("drains HTTP requests before closing MongoDB and ignores repeated signals", async () => {
    await import("../src/index.js");
    await settle();
    signals.get("SIGTERM")!();
    signals.get("SIGINT")!();
    await settle();
    expect(mocks.server.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
    finishRequests();
    await settle();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("does not start listening when interrupted during initialization", async () => {
    let ready!: () => void;
    mocks.load.mockReturnValue(
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    );
    await import("../src/index.js");
    signals.get("SIGINT")!();
    ready();
    await settle();
    expect(mocks.server.listen).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("reports startup failure even after shutdown has already started", async () => {
    let fail!: (error: Error) => void;
    mocks.load.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    );
    await import("../src/index.js");
    signals.get("SIGTERM")!();
    fail(new Error("database failed"));
    await settle();
    expect(mocks.server.listen).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("forces an unsuccessful exit when requests exceed the deadline", async () => {
    await import("../src/index.js");
    await settle();
    signals.get("SIGTERM")!();
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.server.closeAllConnections).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("closes MongoDB on an HTTP listen failure", async () => {
    await import("../src/index.js");
    await settle();
    mocks.server.listening = false;
    serverError(new Error("address in use"));
    await settle();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
