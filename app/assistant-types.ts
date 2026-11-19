export const providerLabels = {
  legacy: "Saved suggestion · source unrecorded",
  local: "Rules-based suggestion",
  pending: "OpenAI request awaiting approval",
  approved: "OpenAI request approved",
  running: "OpenAI request in progress",
  completed: "OpenAI request completed",
  failed: "OpenAI request failed",
  declined: "OpenAI request declined",
} as const;

export const providerIssues = {
  unavailable: "OpenAI is unavailable.",
  timeout: "OpenAI did not respond in time.",
  refused: "OpenAI declined to answer.",
  incomplete: "OpenAI returned an incomplete answer.",
  invalid_output: "OpenAI returned an answer Keystone could not validate.",
  interrupted: "The request was interrupted before Keystone could confirm an answer.",
  rate_limited: "The provider request limit was reached.",
} as const;

export type ProviderStatus = keyof typeof providerLabels;
export type ProviderIssue = keyof typeof providerIssues;
export type Conversation = {
  id: string; page: string; prompt: string; response: string;
  providerStatus: ProviderStatus; providerIssue: ProviderIssue | null;
  approvedAt: string | null; createdAt: string; updatedAt: string; preview: string | null;
};
