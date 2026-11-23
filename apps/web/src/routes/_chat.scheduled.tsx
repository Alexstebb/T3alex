import { createFileRoute } from "@tanstack/react-router";

import { ScheduledWorkspace } from "../components/scheduled/ScheduledWorkspace";
import { validateScheduledWorkspaceSearch } from "../components/scheduled/scheduledWorkspaceSearch";

export const Route = createFileRoute("/_chat/scheduled")({
  validateSearch: validateScheduledWorkspaceSearch,
  component: ScheduledWorkspace,
});
