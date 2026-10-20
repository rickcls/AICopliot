import type { Dictionary } from "@/lib/i18n/translate";
import type { sharedEn } from "@/lib/i18n/dictionaries/areas/shared.en";

export const sharedZhHant = {
  requirementStatus: {
    draft: "待審閱",
    needs_clarification: "要問客戶",
    validated: "已核對",
    approved: "已議定",
    rejected: "已否決",
  },
  requirementStatusHint: {
    draft: "已擷取或記下，你還未核對",
    needs_clarification: "要帶回去問客戶的問題",
    validated: "你已核對，等待客戶同意",
    approved: "已與客戶議定，這就是範圍",
    rejected: "不在範圍內，保留作紀錄",
  },
  requirementType: {
    business: "業務",
    functional: "功能",
    non_functional: "非功能",
    constraint: "限制",
  },
  requirementPriority: {
    must: "必須有",
    should: "應該有",
    could: "可以有",
    wont: "這次不做",
  },
  confidence: {
    high: "高",
    medium: "中",
    low: "低",
  },
  milestoneStatus: {
    not_started: "未開始",
    on_track: "進展正常",
    at_risk: "有風險",
    blocked: "受阻",
    completed: "已完成",
  },
  riskLevel: {
    low: "低",
    medium: "中",
    high: "高",
  },
  riskStatus: {
    open: "未處理",
    monitoring: "監察中",
    mitigated: "已緩解",
    accepted: "已接受",
  },
  reportHealth: {
    green: "進展正常",
    amber: "需要留意",
    red: "有風險",
  },
  runStatus: {
    processing: "處理中",
    draft: "待審閱",
    approved: "已批核",
    partially_approved: "部分批核",
    rejected: "已否決",
    failed: "失敗",
  },
  generationStatus: {
    not_applicable: "手動",
    draft: "草稿",
    approved: "已批核",
    rejected: "已否決",
  },
  statusCategory: {
    open: "未完成",
    blocked: "受阻",
    done: "已完成",
  },
  taskQuickFilter: {
    overdue: "逾期",
    due_soon: "7 日內到期",
    blocked: "受阻",
    mine: "指派給我",
    unassigned: "未指派",
  },
  deliveryState: {
    no_task: "未有工作",
    planned: "已計劃",
    partial: "部分完成",
    delivered: "已交付",
  },
  relativeTime: {
    justNow: "剛剛",
    minutes: "{count} 分鐘前",
    hours: "{count} 小時前",
    days: "{count} 日前",
  },
} satisfies Pick<Dictionary, keyof typeof sharedEn>;
