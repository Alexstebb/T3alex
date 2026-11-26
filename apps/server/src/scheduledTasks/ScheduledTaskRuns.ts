import {
  ScheduledTaskError,
  type ScheduledTaskId,
  type ScheduledTaskRunsInput,
  type ScheduledTaskRunsResult,
  type ScheduledTaskRunThreadsResult,
  type ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Local fork: a scheduled task's run history, for `ScheduledTaskService.listRuns` and
 * `subscribeRuns`. `changes` is the service's change feed; every change re-reads the runs.
 */
export const makeScheduledTaskRuns = Effect.fn("ScheduledTaskService.makeRuns")(function* (
  changes: PubSub.PubSub<void>,
) {
  const sql = yield* SqlClient.SqlClient;

  // The run lookup index is created here instead of in a numbered migration, because a
  // fork-only migration id would collide with the next upstream migration. The index only
  // speeds up the lookup, so a failure to create it is ignored.
  const ensureRunLookupIndex = yield* Effect.cached(
    sql`
        CREATE INDEX IF NOT EXISTS orchestration_v2_projection_messages_scheduled_task_idx
        ON orchestration_v2_projection_messages(
          CASE WHEN json_valid(payload_json)
            THEN json_extract(payload_json, '$.scheduledTaskId') END,
          message_id
        )
        WHERE CASE WHEN json_valid(payload_json)
          THEN json_type(payload_json, '$.scheduledTaskId') END IS NOT NULL
      `.pipe(Effect.asVoid, Effect.ignore),
  );

  const listTaskRuns = (taskId: ScheduledTaskId) =>
    sql<ScheduledTaskRunsResult["runs"][number]>`
        SELECT
          run.run_id AS "runId",
          run.thread_id AS "threadId",
          input.message_id AS "userMessageId",
          (
            SELECT reply.message_id
            FROM orchestration_v2_projection_messages AS reply
            WHERE reply.run_id = run.run_id AND reply.role = 'assistant'
            ORDER BY reply.created_at DESC, reply.message_id DESC
            LIMIT 1
          ) AS "assistantMessageId",
          run.status,
          run.requested_at AS "requestedAt"
        FROM orchestration_v2_projection_messages AS input
        INNER JOIN orchestration_v2_projection_runs AS run
          ON CASE WHEN json_valid(run.payload_json)
            THEN json_extract(run.payload_json, '$.userMessageId') END = input.message_id
        INNER JOIN orchestration_v2_projection_threads AS thread
          ON thread.thread_id = run.thread_id AND thread.deleted_at IS NULL
        WHERE CASE WHEN json_valid(input.payload_json)
          THEN json_extract(input.payload_json, '$.scheduledTaskId') END = ${taskId}
          AND CASE WHEN json_valid(input.payload_json)
            THEN json_type(input.payload_json, '$.scheduledTaskId') END IS NOT NULL
        ORDER BY run.requested_at DESC, run.run_id DESC
        LIMIT 50
      `.pipe(NodeSqliteClient.readOnly);

  // Lets a client find the task behind the chat it has open.
  const latestTaskInThread = (threadId: ThreadId) =>
    sql<{ readonly taskId: ScheduledTaskId }>`
        SELECT json_extract(payload_json, '$.scheduledTaskId') AS "taskId"
        FROM orchestration_v2_projection_messages
        WHERE thread_id = ${threadId}
          AND CASE WHEN json_valid(payload_json)
            THEN json_type(payload_json, '$.scheduledTaskId') END IS NOT NULL
        ORDER BY created_at DESC, message_id DESC
        LIMIT 1
      `.pipe(
      NodeSqliteClient.readOnly,
      Effect.map((rows) => rows[0]?.taskId ?? null),
    );

  const listRuns = Effect.fn("ScheduledTaskService.listRuns")(
    function* (input: ScheduledTaskRunsInput) {
      yield* ensureRunLookupIndex;
      const taskId = "id" in input ? input.id : yield* latestTaskInThread(input.threadId);
      const runs = taskId === null ? [] : yield* listTaskRuns(taskId);
      return { taskId, runs } satisfies ScheduledTaskRunsResult;
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ScheduledTaskError({
              message: "Could not list schedule task runs.",
              ...("id" in input ? { taskId: input.id } : {}),
              cause,
            }),
        ),
      ),
  );

  const subscribeRuns = (
    input: ScheduledTaskRunsInput,
  ): Stream.Stream<ScheduledTaskRunsResult, ScheduledTaskError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(listRuns(input)),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => listRuns(input))),
        );
      }),
    );

  // A chat counts as a run's chat when its first user message came from a task; a chat the
  // user started and a task later continues in stays theirs.
  const listRunThreads = Effect.fn("ScheduledTaskService.listRunThreads")(
    function* () {
      yield* ensureRunLookupIndex;
      const threads = yield* sql<ScheduledTaskRunThreadsResult["threads"][number]>`
          SELECT
            scheduled.thread_id AS "threadId",
            json_extract(scheduled.payload_json, '$.scheduledTaskId') AS "taskId"
          FROM orchestration_v2_projection_messages AS scheduled
          INNER JOIN orchestration_v2_projection_threads AS thread
            ON thread.thread_id = scheduled.thread_id AND thread.deleted_at IS NULL
          WHERE CASE WHEN json_valid(scheduled.payload_json)
              THEN json_type(scheduled.payload_json, '$.scheduledTaskId') END IS NOT NULL
            AND scheduled.role = 'user'
            AND NOT EXISTS (
              SELECT 1
              FROM orchestration_v2_projection_messages AS earlier
              WHERE earlier.thread_id = scheduled.thread_id
                AND earlier.role = 'user'
                AND (
                  earlier.created_at < scheduled.created_at
                  OR (
                    earlier.created_at = scheduled.created_at
                    AND earlier.message_id < scheduled.message_id
                  )
                )
            )
          ORDER BY scheduled.thread_id
        `.pipe(NodeSqliteClient.readOnly);
      return { threads } satisfies ScheduledTaskRunThreadsResult;
    },
    (effect) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ScheduledTaskError({ message: "Could not list scheduled run chats.", cause }),
        ),
      ),
  );

  const subscribeRunThreads = (): Stream.Stream<
    ScheduledTaskRunThreadsResult,
    ScheduledTaskError
  > =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(listRunThreads()),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => listRunThreads())),
        ).pipe(
          // Most task changes start no chat; resend only when the list changed.
          Stream.changesWith((a, b) => JSON.stringify(a.threads) === JSON.stringify(b.threads)),
        );
      }),
    );

  return { listRuns, subscribeRuns, subscribeRunThreads };
});
