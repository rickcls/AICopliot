/**
 * What a project question asks about, read from its words. Deterministic on
 * purpose: which records reach the model must not depend on the model.
 *
 * Substring matching, as elsewhere in project chat, because written Chinese
 * has no spaces to split words on.
 */

/** "What is still pending?" — finished work is counted, not listed. */
const OPEN_WORK = [
  "pending",
  "outstanding",
  "open task",
  "to do",
  "todo",
  "to-do",
  "remaining",
  "unfinished",
  "not done",
  "not yet",
  "未完成",
  "未完",
  "待辦",
  "待處理",
  "仲未",
  "未做",
  "未搞掂",
  "未處理",
  "進行中",
  "跟進中",
] as const;

/** "How is it going?" — answered from the notes people wrote on the work. */
const PROGRESS = [
  "progress",
  "update",
  "so far",
  "how is",
  "how's",
  "status",
  "進度",
  "進展",
  "做咗",
  "做到",
  "情況",
  "狀況",
  "狀態",
  "最新",
  "跟進",
] as const;

/** The question names the files themselves, so their passages are wanted. */
const DOCUMENTS = [
  "document",
  "file",
  "brief",
  "contract",
  "spec",
  "requirement",
  "scope",
  "acceptance",
  "criteria",
  "deliverable",
  "sop",
  "according to",
  "文件",
  "檔案",
  "合約",
  "需求",
  "範圍",
  "根據",
] as const;

export interface QuestionIntent {
  openWork: boolean;
  progress: boolean;
  documents: boolean;
}

function mentions(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function readQuestionIntent(question: string): QuestionIntent {
  const text = question.toLocaleLowerCase();
  return {
    openWork: mentions(text, OPEN_WORK),
    progress: mentions(text, PROGRESS),
    documents: mentions(text, DOCUMENTS),
  };
}

/**
 * A question about the project's own work rather than its files. Its answer
 * comes from the records and the notes on them; document passages would only
 * crowd it, and were cited in answers to "what is still pending?".
 */
export function asksAboutRecordsOnly(intent: QuestionIntent): boolean {
  return (intent.openWork || intent.progress) && !intent.documents;
}
