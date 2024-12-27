// src/services/gate-monitoring.service.ts
import { BaseService } from "./base.service";
import db from "../db";
import axios, { AxiosError } from "axios";
import { ServiceMonitor } from "../utils/service-monitor";
import type { GateCookie } from "@prisma/client";

interface GatePayment {
  id: number;
  payment_method_id: number;
  wallet: string;
  amount: {
    trader: {
      "643": number;
      "000001": number;
    };
  };
  total: {
    trader: {
      "643": number;
      "000001": number;
    };
  };
  status: number;
  approved_at: string;
  expired_at: string;
  created_at: string;
  updated_at: string;
  meta: {
    courses: {
      trader: number;
    };
    reason: {
      trader: null | string;
      support: null | string;
    };
  };
  method: {
    id: number;
    type: number;
    name: number;
    label: string;
    status: number;
    payment_provider_id: number;
    wallet_currency_id: number;
  };
  attachments: {
    name: string;
    file_name: string;
    original_url: string;
    extension: string;
    size: number;
    created_at: string;
    custom_properties: {
      fake: boolean;
    };
  }[];
  tooltip: {
    payments: {
      success: number;
      rejected: number | null;
      percent: number;
    };
    reasons: any[];
  };
  bank: {
    id: number;
    name: string;
    code: string | number;
    label: string;
    meta: {
      system: string;
      country: string;
    };
  };
  trader: {
    id: number;
    name: string;
  };
}

export class GateMonitoringService extends BaseService {
  private readonly GATE_API_URL =
    "https://panel.gate.cx/api/v1/payments/payouts?filters%5Bstatus%5D%5B%5D=2&filters%5Bstatus%5D%5B%5D=3&filters%5Bstatus%5D%5B%5D=7&filters%5Bstatus%5D%5B%5D=8&filters%5Bstatus%5D%5B%5D=9&page=1";
  private readonly GATE_USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

  constructor(monitor: ServiceMonitor) {
    super("GateMonitoringService", monitor);
  }

  private async validateCookie(gateCookie: GateCookie): Promise<boolean> {
    try {
      // Parse the stored JSON cookie array
      const cookiesArray = JSON.parse(gateCookie.cookie);

      // Convert the cookie array to a cookie string
      const cookieString = cookiesArray
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");

      const response = await axios.get(this.GATE_API_URL, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: cookieString,
          "User-Agent": this.GATE_USER_AGENT,
        },
      });

      const isValid =
        response.status === 200 &&
        Array.isArray(response.data?.response?.payouts?.data);

      // Update cookie status
      await db.gateCookie.update({
        where: { id: gateCookie.id },
        data: {
          isActive: isValid,
          lastChecked: new Date(),
          updatedAt: new Date(),
        },
      });

      if (!isValid) {
        console.log(
          `❌ Cookie validation failed for user ${gateCookie.userId} (Cookie ID: ${gateCookie.id})`,
        );
      }

      return isValid;
    } catch (error) {
      // Проверяем конкретно на 401 ошибку
      const isAuthError =
        error instanceof AxiosError && error.response?.status === 401;
      if (isAuthError) {
        console.log(
          `❌ Cookie expired for user ${gateCookie.userId} (Cookie ID: ${gateCookie.id})`,
        );
      } else {
        console.error(
          `❌ Cookie validation error for user ${gateCookie.userId} (Cookie ID: ${gateCookie.id}):`,
          error,
        );
      }

      // Помечаем куки как неактивные
      await db.gateCookie.update({
        where: { id: gateCookie.id },
        data: {
          isActive: false,
          lastChecked: new Date(),
          updatedAt: new Date(),
        },
      });

      return false;
    }
  }

  private async fetchGateTransactions(
    gateCookie: GateCookie,
  ): Promise<GatePayment[]> {
    try {
      const cookiesArray = JSON.parse(gateCookie.cookie);
      const cookieString = cookiesArray
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");

      const response = await axios.get(this.GATE_API_URL, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: cookieString,
          "User-Agent": this.GATE_USER_AGENT,
        },
      });

      return response.data?.response?.payouts?.data || [];
    } catch (error) {
      console.error(
        `❌ Error fetching Gate transactions for user ${gateCookie.userId}:`,
        error,
      );
      return [];
    }
  }

  private async processTransactions(
    userId: number,
    transactions: GatePayment[],
  ): Promise<number> {
    let processedCount = 0;
    for (const transaction of transactions) {
      try {
        // Check if the transaction already exists
        const existingTransaction = await db.gateTransaction.findFirst({
          where: {
            userId,
            transactionId: String(transaction.id),
          },
        });

        console.log("🔍 Поиск транзакции", transaction.id);

        if (!existingTransaction) {
          // Create a new transaction with all fields
          await db.gateTransaction.create({
            data: {
              userId,
              transactionId: String(transaction.id),
              paymentMethodId: transaction.payment_method_id,
              wallet: transaction.wallet,
              amountRub: transaction.amount.trader["643"] || 0,
              amountUsdt: transaction.amount.trader["000001"] || 0,
              totalRub: transaction.total.trader["643"] || 0,
              totalUsdt: transaction.total.trader["000001"] || 0,
              status: transaction.status,
              bankName: transaction.bank?.name || null,
              bankCode: transaction.bank?.code?.toString() || null,
              bankLabel: transaction.bank?.label || null,
              paymentMethod: transaction.method?.label || null,
              course: transaction.meta?.courses?.trader || null,
              successCount: transaction.tooltip?.payments?.success || null,
              successRate: transaction.tooltip?.payments?.percent || null,
              approvedAt: transaction.approved_at
                ? new Date(transaction.approved_at)
                : null,
              expiredAt: transaction.expired_at
                ? new Date(transaction.expired_at)
                : null,
              createdAt: new Date(transaction.created_at),
              updatedAt: new Date(transaction.updated_at),
              traderId: transaction.trader?.id || null,
              traderName: transaction.trader?.name || null,
              attachments: transaction.attachments || null, // Store attachments as JSON
            },
          });
          console.log(
            `✅ Added new Gate transaction: ${transaction.id} for user ${userId}`,
          );
          processedCount++;
        }
      } catch (error) {
        console.error(
          `❌ Error processing transaction ${transaction.id} for user ${userId}:`,
          error,
        );
      }
    }
    return processedCount;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.updateServiceStats({ isRunning: true });

    while (this.isRunning) {
      try {
        console.log("🔄 Starting Gate monitoring cycle");
        let processedUsers = 0;
        let processedTransactions = 0;
        let errors = 0;

        // Получаем все активные куки
        const gateCookies = await db.gateCookie.findMany({
          where: {
            isActive: true,
          },
        });

        console.log(`👥 Processing ${gateCookies.length} active Gate cookies`);

        for (const gateCookie of gateCookies) {
          try {
            // Проверяем валидность куки
            const isValid = await this.validateCookie(gateCookie);

            if (!isValid) {
              errors++;
              continue;
            }

            // Получаем транзакции
            const transactions = await this.fetchGateTransactions(gateCookie);
            console.log(
              `📦 Found ${transactions.length} Gate transactions for user ${gateCookie.userId}`,
            );

            if (transactions.length > 0) {
              const processed = await this.processTransactions(
                gateCookie.userId,
                transactions,
              );
              processedTransactions += processed;
              processedUsers++;
            }

            // Небольшая задержка между запросами
            await this.delay(1000);
          } catch (error) {
            console.error(
              `❌ Error processing user ${gateCookie.userId}:`,
              error,
            );
            errors++;
          }
        }

        this.updateServiceStats({
          processedUsers,
          processedTransactions,
          errors,
          lastRunTime: new Date(),
        });

        this.monitor.logStats(this.serviceName);

        // Ждем перед следующей итерацией
        await this.delay(60000); // 1 минута
      } catch (error) {
        console.error("❌ Error in Gate monitoring cycle:", error);
        this.updateServiceStats({ errors: 1 });
        await this.delay(60000);
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    this.updateServiceStats({ isRunning: false });
  }
}
