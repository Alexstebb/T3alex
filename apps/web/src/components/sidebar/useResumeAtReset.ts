import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { msg } from "gt-react";

import { m } from "~/i18n/messages";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { toastManager } from "../ui/toast";
import { resumeAtResetTarget } from "./sidebarSectionLamp.logic";

/**
 * Turns on auto-resume for chats stopped on a usage limit, the same update the chat's
 * "Resume at reset" button sends. Chats that cannot be scheduled are skipped.
 */
export function useResumeAtReset() {
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  return async (threads: readonly EnvironmentThreadShell[]) => {
    const failures: unknown[] = [];
    await Promise.all(
      threads.map(async (thread) => {
        const target = resumeAtResetTarget(thread);
        if (target === null) return;
        const result = await updateThreadMetadata({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, limitRecovery: { ...target, autoResume: true } },
        });
        if (result._tag === "Failure") failures.push(squashAtomCommandFailure(result));
      }),
    );
    if (failures.length > 0) {
      toastManager.add({
        type: "error",
        title: m(msg("Could not change auto-resume")),
        description: thrownErrorMessage(failures[0], m) ?? m(msg("An error occurred.")),
      });
    }
  };
}
