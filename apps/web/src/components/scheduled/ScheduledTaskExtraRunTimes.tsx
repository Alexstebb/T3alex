import { useGT } from "gt-react";
import { PlusIcon, XIcon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import type { DraftState } from "../settings/scheduledTasksSettings.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { newDraftTime } from "./scheduledTaskRunTimes";

/** The task editor's extra run times, shown after its main time input. */
export function ScheduledTaskExtraRunTimes({
  draft,
  setDraft,
}: {
  draft: DraftState;
  setDraft: Dispatch<SetStateAction<DraftState>>;
}) {
  const gt = useGT();
  return (
    <>
      {(draft.additionalTimes ?? []).map(({ id, time }, index) => (
        <span key={id} className="flex items-center">
          <Input
            type="time"
            nativeInput
            className="w-32"
            aria-label={gt("Extra run time {number}", { number: index + 2 })}
            value={time}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((current) => ({
                ...current,
                additionalTimes: (current.additionalTimes ?? []).map((item) =>
                  item.id === id ? { ...item, time: value } : item,
                ),
              }));
            }}
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={gt("Remove run time {time}", { time })}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                additionalTimes: (current.additionalTimes ?? []).filter((item) => item.id !== id),
              }))
            }
          >
            <XIcon aria-hidden />
          </Button>
        </span>
      ))}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost-muted"
        aria-label={gt("Add run time")}
        onClick={() =>
          setDraft((current) => ({
            ...current,
            additionalTimes: [...(current.additionalTimes ?? []), newDraftTime()],
          }))
        }
      >
        <PlusIcon aria-hidden />
      </Button>
    </>
  );
}
