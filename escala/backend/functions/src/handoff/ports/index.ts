export interface HandoffCase {
  case_id: string;
  idempotency_key: string;
  reason: string;
  summary: string;
  pnr: string | null;
  created_ms: number;
  context: Record<string, unknown>;
}

export interface HandoffRepository {
  get(caseId: string): Promise<HandoffCase | null>;
  save(handoffCase: HandoffCase): Promise<void>;
}
