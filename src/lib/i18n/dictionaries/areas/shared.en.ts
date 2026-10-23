/**
 * Labels for stored values that several areas render: requirement statuses,
 * task categories, quick filters, delivery states, and relative times.
 *
 * Enum values describe the model (`needs_clarification`); these describe the
 * job a person is doing with the row. Copy changes happen here — never by
 * renaming an enum value, which would need a migration.
 */
export const sharedEn = {
  requirementStatus: {
    draft: "To review",
    needs_clarification: "Ask client",
    validated: "Validated",
    approved: "Agreed",
    rejected: "Rejected",
  },
  requirementStatusHint: {
    draft: "Extracted or written down, not yet checked by you",
    needs_clarification: "An open question to take back to the client",
    validated: "Checked by you, waiting for the client to agree",
    approved: "Agreed with the client — this is the scope",
    rejected: "Out of scope, kept for the record",
  },
  requirementType: {
    business: "Business",
    functional: "Functional",
    non_functional: "Non-functional",
    constraint: "Constraint",
  },
  requirementPriority: {
    must: "Must",
    should: "Should",
    could: "Could",
    wont: "Won't",
  },
  confidence: {
    high: "High",
    medium: "Medium",
    low: "Low",
  },
  milestoneStatus: {
    not_started: "Not started",
    on_track: "On track",
    at_risk: "At risk",
    blocked: "Blocked",
    completed: "Completed",
  },
  riskLevel: {
    low: "Low",
    medium: "Medium",
    high: "High",
  },
  riskStatus: {
    open: "Open",
    monitoring: "Monitoring",
    mitigated: "Mitigated",
    accepted: "Accepted",
  },
  reportHealth: {
    green: "On track",
    amber: "Needs attention",
    red: "At risk",
  },
  runStatus: {
    processing: "Running",
    draft: "To review",
    approved: "Approved",
    partially_approved: "Partly approved",
    rejected: "Rejected",
    failed: "Failed",
  },
  generationStatus: {
    not_applicable: "Manual",
    draft: "Draft",
    approved: "Approved",
    rejected: "Rejected",
  },
  statusCategory: {
    open: "Open",
    blocked: "Blocked",
    done: "Done",
  },
  taskQuickFilter: {
    overdue: "Overdue",
    due_soon: "Due in 7 days",
    blocked: "Blocked",
    mine: "Assigned to me",
    unassigned: "Unassigned",
  },
  deliveryState: {
    no_task: "No task",
    planned: "Planned",
    partial: "Partly done",
    delivered: "Delivered",
  },
  relativeTime: {
    justNow: "just now",
    minutes: "{count}m ago",
    hours: "{count}h ago",
    days: "{count}d ago",
  },
  datePicker: {
    chooseDate: "Choose a date",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    today: "Today",
  },
} as const;
