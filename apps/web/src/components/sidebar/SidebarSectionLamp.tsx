import { useGT } from "gt-react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  MailCheckIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  isReadClearableTone,
  SECTION_LAMP_TONES,
  type SectionLamp,
  type SectionLampTone,
} from "./sidebarSectionLamp.logic";

/** One chat (or scheduled task) behind a lamp, as its popover lists it. */
export interface SectionLampEntry {
  readonly key: string;
  readonly tone: SectionLampTone;
  readonly title: string;
  readonly onOpen: () => void;
}

// The icon and colour each state has on its thread row (`TOP_STATUS_ICONS` and `topStatus` in
// SidebarThreadRow.tsx), so the lamp's shape tells the states apart without colour.
const LAMP_LOOK: Record<
  SectionLampTone,
  { readonly Icon: LucideIcon; readonly className: string }
> = {
  approval: { Icon: ShieldQuestionIcon, className: "text-warning-foreground" },
  input: { Icon: MessageCircleQuestionIcon, className: "text-indigo-600 dark:text-indigo-300" },
  request: { Icon: UserRoundIcon, className: "text-guest-foreground" },
  limited: { Icon: CircleAlertIcon, className: "text-warning-foreground" },
  failed: { Icon: CircleAlertIcon, className: "text-error-foreground" },
  done: { Icon: CircleCheckIcon, className: "text-success-foreground" },
  working: { Icon: CircleDashedIcon, className: "text-info-foreground" },
};

/** The state's row icon in its row colour, for lists that show one chat per line. */
export function SectionLampToneIcon(props: { tone: SectionLampTone; className?: string }) {
  const { Icon, className } = LAMP_LOOK[props.tone];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", className, props.className)} />;
}

type Gt = ReturnType<typeof useGT>;

function toneLine(gt: Gt, tone: SectionLampTone, count: number) {
  switch (tone) {
    case "approval":
      return gt("{count, plural, one {{count} needs approval} other {{count} need approval}}", {
        count,
      });
    case "input":
      return gt(
        "{count, plural, one {{count} needs your answer} other {{count} need your answer}}",
        { count },
      );
    case "request":
      return gt(
        "{count, plural, one {{count} has a guest request} other {{count} have guest requests}}",
        { count },
      );
    case "limited":
      return gt("{count} hit a usage limit", { count });
    case "failed":
      return gt("{count} failed", { count, $context: "chats in a sidebar section" });
    case "done":
      return gt("{count, plural, one {{count} unread reply} other {{count} unread replies}}", {
        count,
      });
    case "working":
      return gt("{count} working", { count, $context: "chats in a sidebar section" });
  }
}

function lampLines(gt: Gt, lamp: SectionLamp) {
  if (lamp.waiting === 0) {
    const count = lamp.counts.working ?? 0;
    return [
      gt("{count, plural, one {{count} chat is working} other {{count} chats are working}}", {
        count,
      }),
    ];
  }
  return [
    gt(
      "{count, plural, one {{count} chat is waiting for you} other {{count} chats are waiting for you}}",
      { count: lamp.waiting },
    ),
    ...SECTION_LAMP_TONES.flatMap((tone) => {
      const count = lamp.counts[tone] ?? 0;
      return count > 0 ? [toneLine(gt, tone, count)] : [];
    }),
  ];
}

function LampFace({ lamp }: { lamp: SectionLamp }) {
  const { Icon } = LAMP_LOOK[lamp.tone];
  return lamp.tone !== "working" ? (
    <>
      <Icon aria-hidden strokeWidth={2.5} className="size-3.5 shrink-0 text-sidebar" />
      {lamp.waiting > 1 ? (
        <span
          aria-hidden
          className="pr-0.5 text-xs leading-none font-semibold tabular-nums text-sidebar"
        >
          {lamp.waiting}
        </span>
      ) : null}
    </>
  ) : (
    <Icon aria-hidden className="size-3.5" />
  );
}

function lampClassName(lamp: SectionLamp) {
  return cn(
    "inline-flex shrink-0 items-center justify-center",
    LAMP_LOOK[lamp.tone].className,
    lamp.tone !== "working" &&
      "h-5 min-w-5 gap-0.5 rounded-full bg-current px-0.75 ring-2 ring-current/25",
  );
}

/**
 * A closed section's status light: the most urgent state among its hidden chats, filled
 * and haloed so it stands out, with a count once more than one chat needs the user.
 * Working alone shows the row's quieter working icon. With `entries` it is a button whose
 * popover lists those chats, most urgent first, and can mark the finished ones read.
 */
export function SidebarSectionLamp(props: {
  lamp: SectionLamp;
  entries?: readonly SectionLampEntry[] | undefined;
  onMarkAllRead?: (() => void) | undefined;
}) {
  const gt = useGT();
  const { lamp } = props;
  const [open, setOpen] = useState(false);
  const [heading = "", ...details] = lampLines(gt, lamp);
  const label = [heading, ...details].join(", ");
  if (props.entries === undefined) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={label}
              data-section-lamp={lamp.tone}
              className={lampClassName(lamp)}
            />
          }
        >
          <LampFace lamp={lamp} />
        </TooltipTrigger>
        <TooltipPopup>
          <span className="block font-medium">{heading}</span>
          {details.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </TooltipPopup>
      </Tooltip>
    );
  }
  const rank = (tone: SectionLampTone) => SECTION_LAMP_TONES.indexOf(tone);
  const entries = props.entries.toSorted((a, b) => rank(a.tone) - rank(b.tone));
  const canMarkRead =
    props.onMarkAllRead !== undefined && entries.some((entry) => isReadClearableTone(entry.tone));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            data-section-lamp={lamp.tone}
            className={cn(
              lampClassName(lamp),
              "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              lamp.tone === "working" && "size-5 rounded-full hover:bg-sidebar-row-hover",
            )}
          />
        }
      >
        <LampFace lamp={lamp} />
      </PopoverTrigger>
      <PopoverPopup align="end" padding="compact" width="sm">
        <div className="flex flex-col gap-1" data-section-lamp-popover="">
          <p className="px-2 pt-0.5 pb-1 text-xs font-medium text-muted-foreground">{heading}</p>
          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {entries.map((entry) => {
              return (
                <li key={entry.key}>
                  <button
                    type="button"
                    data-section-lamp-entry={entry.tone}
                    onClick={() => {
                      setOpen(false);
                      entry.onOpen();
                    }}
                    className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    <SectionLampToneIcon tone={entry.tone} />
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {canMarkRead ? (
            <div className="border-t border-border pt-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.onMarkAllRead?.();
                }}
                className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <MailCheckIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                {gt("Mark all as read")}
              </button>
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
