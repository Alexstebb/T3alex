import type { TimestampFormat } from "@t3tools/contracts/settings";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import { formatShortTimestamp, parseTimestampDate } from "../../timestampFormat";

function dayIndex(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

/** "Today at 08:32", "Yesterday at 08:32" or "20 Nov at 08:32", in the viewer's local time. */
export function formatScheduledRunTime(
  isoDate: string,
  nowMs: number,
  timestampFormat: TimestampFormat,
  locale: string,
  resolve: MessageResolver = m,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const now = new Date(nowMs);
  const time = formatShortTimestamp(isoDate, timestampFormat);
  const daysAgo = dayIndex(now) - dayIndex(date);
  const days =
    daysAgo === 0 || daysAgo === 1
      ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
          .format(-daysAgo, "day")
          .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase(locale))
      : new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
        }).format(date);
  return resolve(msg("{days} at {time}", { days, time }));
}
