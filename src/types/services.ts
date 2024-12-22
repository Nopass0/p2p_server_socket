// src/types/services.ts

export interface OrderInfo {
  order_id: string;
  amount: {
    value: number;
    currency_code: string;
  };
  buyer_id: string;
  seller_id: string;
  payment_method: string | null;
  status: string;
  status_update_time: string;
}

export interface ServiceStats {
  processedUsers: number;
  processedTransactions: number;
  errors: number;
  lastRunTime: Date;
  isRunning: boolean;
}

export interface TokenValidationResult {
  isValid: boolean;
  error?: string;
}
