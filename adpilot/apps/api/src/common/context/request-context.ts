import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  requestId: string;
  userId?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
  jobId?: string;
  queue?: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

/** Carries the request/job correlation data through async calls (used by logs, audit and Meta API logs). */
export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  get(): RequestContextData | undefined {
    return storage.getStore();
  },
  patch(data: Partial<RequestContextData>): void {
    const current = storage.getStore();
    if (current) Object.assign(current, data);
  },
};
