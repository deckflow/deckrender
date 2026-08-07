import type { DeckClient, DeckTask, DeckTaskType } from '@deckops/sdk';

export interface RecordedTask {
  type: DeckTaskType;
  fileIds: string[];
  params: Record<string, unknown>;
}

export interface FakeClientOptions {
  /** Result payload per task type. Values are what `tasks.down()` returns. */
  results: Partial<Record<DeckTaskType, unknown | ((call: number) => unknown)>>;
  /** Task types that should complete with `failed` instead of `completed`. */
  failing?: DeckTaskType[];
  /** Hook for simulating SDK state changes while a task is created. */
  onCreate?: () => void;
}

export interface FakeClient {
  client: DeckClient;
  tasks: RecordedTask[];
  uploads: { name?: string; input: unknown }[];
  started: string[];
}

/**
 * A DeckClient stand-in.
 *
 * Injecting this through `createRenderer({ client })` exercises the real plan,
 * engine, chaining and writer code paths with no network at all, which is what
 * makes the route assertions meaningful in CI.
 */
export function createFakeClient(options: FakeClientOptions): FakeClient {
  const tasks: RecordedTask[] = [];
  const uploads: { name?: string; input: unknown }[] = [];
  const started: string[] = [];
  const callCounts = new Map<DeckTaskType, number>();
  const byId = new Map<string, RecordedTask>();

  const client = {
    root: 'https://fake.test/v1',
    tasks: {
      async create(params: { type: DeckTaskType; fileIds?: string[]; params?: unknown }) {
        options.onCreate?.();
        const record: RecordedTask = {
          type: params.type,
          fileIds: params.fileIds ?? [],
          params: (params.params ?? {}) as Record<string, unknown>,
        };
        tasks.push(record);
        const id = `task-${tasks.length}`;
        byId.set(id, record);
        return { id, spaceId: 'space', type: params.type, status: 'pending' } as DeckTask;
      },
      async start(taskId: string) {
        started.push(taskId);
        return { id: taskId, spaceId: 'space', type: 'file.compress', status: 'running' } as DeckTask;
      },
      async wait(taskId: string) {
        const record = byId.get(taskId)!;
        if (options.failing?.includes(record.type)) {
          // The real SDK rejects on a failed task rather than returning it,
          // and the rejection carries no task id. Reproducing that exactly is
          // what makes the error-enrichment path testable.
          throw new Error('Task failed: backend blew up');
        }
        return { id: taskId, spaceId: 'space', type: record.type, status: 'completed' } as DeckTask;
      },
      async down(taskId: string) {
        const record = byId.get(taskId)!;
        const entry = options.results[record.type];
        const count = (callCounts.get(record.type) ?? 0) + 1;
        callCounts.set(record.type, count);
        return typeof entry === 'function' ? (entry as (call: number) => unknown)(count) : entry;
      },
      async list() {
        return { tasks: [] };
      },
      async get(taskId: string) {
        return { id: taskId, spaceId: 'space', type: 'file.compress', status: 'completed' } as DeckTask;
      },
      async delete() {
        return undefined;
      },
      async subscribe() {
        return () => undefined;
      },
    },
    files: {
      async upload(input: unknown, uploadOptions?: { name?: string }) {
        uploads.push({ name: uploadOptions?.name, input });
        return {
          id: `file-${uploads.length}`,
          name: uploadOptions?.name ?? 'upload',
          bytes: 0,
          hash: 'hash',
        };
      },
      async requestUpload() {
        throw new Error('not used');
      },
    },
  } as unknown as DeckClient;

  return { client, tasks, uploads, started };
}

/** A ConvertFileResult array, as multi-frame converters return it. */
export function frames(count: number, ext = '.png', width = 1920, height = 1080): unknown {
  return Array.from({ length: count }, (_, index) => [
    `https://fake.test/frame-${index + 1}${ext}`,
    1024 * (index + 1),
    `hash-${index + 1}`,
    { w: width, h: height, total: count },
  ]);
}

/** A single FileResult tuple. */
export function singleFile(name: string): unknown {
  return [`https://fake.test/${name}`, 2048, 'hash'];
}
