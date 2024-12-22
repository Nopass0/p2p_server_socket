// src/types/automation.ts
export type ActionType = "click" | "scroll" | "wait" | "back";

export interface AutomationAction {
  type: ActionType;
  x?: number;
  y?: number;
  amount?: number;
  delay: number;
}

// src/types/transaction.ts
export interface P2PTransactionData {
  telegramId: string;
  status: string;
  amount: number;
  totalRub: number;
  price: number;
  buyerName: string;
  method: string;
  tradeStats?: string;
  completedAt: string;
}

// src/types/messages.ts
export interface WebSocketMessage {
  type: MessageType;
  [key: string]: unknown;
}

export type MessageType =
  | "automation_action"
  | "transaction_saved"
  | "transaction_duplicate"
  | "error";

export interface AutomationActionMessage extends WebSocketMessage {
  type: "automation_action";
  action: AutomationAction;
}

export interface TransactionSavedMessage extends WebSocketMessage {
  type: "transaction_saved";
  data: P2PTransactionData;
}

export interface TransactionDuplicateMessage extends WebSocketMessage {
  type: "transaction_duplicate";
  data: P2PTransactionData;
}

export interface ErrorMessage extends WebSocketMessage {
  type: "error";
  message: string;
}
