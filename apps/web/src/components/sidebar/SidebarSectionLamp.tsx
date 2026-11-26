import { useGT } from "gt-react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SECTION_LAMP_TONES,
  type SectionLamp,
  type SectionLampTone,
} from "./sidebarSectionLamp.logic";

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

/**
 * A closed section's status light: the most urgent state among its hidden chats, filled
 * and haloed so it stands out, with a count once more than one chat needs the user.
 * Working alone shows the row's quieter working icon.
 */
export function SidebarSectionLamp({ lamp }: { lamp: SectionLamp }) {
  const gt = useGT();
  const [heading, ...details] = lampLines(gt, lamp);
  const { Icon, className } = LAMP_LOOK[lamp.tone];
  const lit = lamp.tone !== "working";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={[heading, ...details].join(", ")}
            data-section-lamp={lamp.tone}
            className={cn(
              "inline-flex shrink-0 items-center justify-center",
              className,
              lit && "h-5 min-w-5 gap-0.5 rounded-full bg-current px-0.75 ring-2 ring-current/25",
            )}
          />
        }
      >
        {lit ? (
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
        )}
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
