import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { lazy, useState } from "react";

import { getClientSettings, persistClientSettingsPatch } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { forgetScheduledTask, scheduledTaskOrganizationKey } from "./scheduledTaskOrganization";

export const ScheduledTaskEditor = lazy(async () => {
  const { StandaloneScheduledTaskEditorDialog } =
    await import("../settings/ScheduledTasksSettings");
  return { default: StandaloneScheduledTaskEditorDialog };
});

/** Pause/resume and delete for a task, with the toast and clean-up the Scheduled page needs. */
export function useScheduledTaskActions(environmentId: EnvironmentId) {
  const gt = useGT();
  const canEdit = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));
  const canPause = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const canDelete = useAtomValue(
    serverEnvironment.deleteScheduledTask.permissionAtom(environmentId),
  );
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    reportFailure: false,
  });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, { reportFailure: false });

  const report = (result: AtomCommandResult<unknown, unknown>) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return false;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: gt("Could not update scheduled task"),
        description: String(squashAtomCommandFailure(result)),
      }),
    );
    return true;
  };

  return {
    canEdit,
    canPause,
    canDelete,
    async toggleEnabled(task: ScheduledTask) {
      report(await setEnabled({ environmentId, input: { id: task.id, enabled: !task.enabled } }));
    },
    /** Resolves true once the task is gone; its pin, subsection and last-seen entries go with it. */
    async deleteTask(task: ScheduledTask) {
      const result = await remove({ environmentId, input: { id: task.id } });
      if (report(result) || result._tag !== "Success") return false;
      await persistClientSettingsPatch({
        scheduledTaskOrganization: forgetScheduledTask(
          getClientSettings().scheduledTaskOrganization,
          scheduledTaskOrganizationKey(environmentId, task.id),
        ),
      });
      return true;
    },
  };
}

export function ScheduledTaskDeleteDialog(props: {
  readonly task: ScheduledTask;
  readonly onDelete: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {gt('Delete "{title}"?', { title: props.task.title })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {gt("The task and its schedule are removed. Chats from earlier runs are kept.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" disabled={busy} />}>
            {gt("Cancel")}
          </AlertDialogClose>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await props.onDelete();
              props.onClose();
            }}
          >
            {gt("Delete task")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
