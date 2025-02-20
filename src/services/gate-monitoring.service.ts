// src/services/gate-monitoring.service.ts
import { BaseService } from "./base.service";
import db from "../db";
import axios, { AxiosError } from "axios";
import { ServiceMonitor } from "../utils/service-monitor";
import type { GateCookie } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { TransactionMatchingService } from "./transaction-matching.service";

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
    "https://panel.gate.cx/api/v1/payments/payouts?filters%5Bstatus%5D%5B%5D=2&filters%5Bstatus%5D%5B%5D=3&filters%5Bstatus%5D%5B%5D=7&filters%5Bstatus%5D%5B%5D=8&filters%5Bstatus%5D%5B%5D=9&page=";
  private readonly GATE_USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";
  private readonly MONITORING_INTERVAL = 60 * 1000; // 1 minute in milliseconds
  private intervalId: NodeJS.Timeout | null = null;
  private matchingService: TransactionMatchingService;

  constructor(monitor: ServiceMonitor, matchingService: TransactionMatchingService) {
    super("GateMonitoringService", monitor);
    this.matchingService = matchingService;
  }

  private getCookieString(gateCookie: GateCookie): string {
    try {
      const parsed = JSON.parse(gateCookie.cookie);
      if (Array.isArray(parsed)) {
        return parsed.map((cookie: any) => `${cookie.name}=${cookie.value}`).join("; ");
      }
      return String(gateCookie.cookie);
    } catch (error) {
      return String(gateCookie.cookie);
    }
  }

  private async validateCookie(gateCookie: GateCookie): Promise<boolean> {
    try {
      const cookieString = this.getCookieString(gateCookie);
      const response = await axios.get(this.GATE_API_URL + 1, {
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
          `❌ Cookie validation failed for user ${gateCookie.userId} (Cookie ID: ${gateCookie.id})`
        );
      }
      return isValid;
    } catch (error) {
      const isAuthError =
        error instanceof AxiosError && error.response?.status === 401;
      if (isAuthError) {
        console.log(
          `❌ Cookie expired for user ${gateCookie.userId} (Cookie ID: ${gateCookie.id})`
        );
      } else {
        console.error(
          `❌ Cookie validation error for user ${gateCookie.userId} (Cookie ID: ${gateCookie.id}):`,
          error
        );
      }
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
    page: number = 1,
  ): Promise<GatePayment[]> {
    try {
      const cookieString = this.getCookieString(gateCookie);
      const response = await axios.get(`${this.GATE_API_URL}${page}`, {
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
        `❌ Error fetching Gate transactions for user ${gateCookie.userId} on page ${page}:`,
        error
      );
      return [];
    }
  }

  private async fetchAllGateTransactions(
    gateCookie: GateCookie
  ): Promise<GatePayment[]> {
    const maxPages = 25;
    const allTransactions: GatePayment[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const transactions = await this.fetchGateTransactions(gateCookie, page);
      if (transactions.length === 0) break;
      allTransactions.push(...transactions);
      await this.delay(500);
    }
    return allTransactions;
  }

  private async processTransactions(
    userId: number,
    transactions: GatePayment[],
    gateCookie: GateCookie,
  ): Promise<{ processed: number; total: number }> {
    let processedCount = 0;

    for (const t of transactions) {
      const transactionId = String(t.id);

      try {
        // Ищем транзакцию по уникальному transactionId
        let existingTx = await db.gateTransaction.findUnique({
          where: { transactionId },
        });

        if (!existingTx) {
          // Создаём новую GateTransaction (без вложенной связи User)
          existingTx = await db.gateTransaction.create({
            data: {
              transactionId,
              paymentMethodId: t.payment_method_id,
              wallet: t.wallet,
              amountRub: t.amount.trader["643"] || 0,
              amountUsdt: t.amount.trader["000001"] || 0,
              totalRub: t.total.trader["643"] || 0,
              totalUsdt: t.total.trader["000001"] || 0,
              status: t.status,
              bankName: t.bank?.name || null,
              userId: gateCookie.userId,
              bankCode: t.bank?.code?.toString() || null,
              bankLabel: t.bank?.label || null,
              paymentMethod: t.method?.label || null,
              course: t.meta?.courses?.trader || null,
              successCount: t.tooltip?.payments?.success || null,
              successRate: t.tooltip?.payments?.percent || null,
              approvedAt: t.approved_at ? new Date(t.approved_at) : null,
              expiredAt: t.expired_at ? new Date(t.expired_at) : null,
              createdAt: new Date(t.created_at),
              updatedAt: new Date(t.updated_at),
              traderId: t.trader?.id || null,
              traderName: t.trader?.name || null,
              attachments: t.attachments || null,
              idexId: String(t.trader?.id) || null,
            },
          });
          console.log(`✅ Добавлена новая GateTransaction ${transactionId}.`);
        } else {
          // Опционально обновляем существующую транзакцию (например, статус и updatedAt)
          await db.gateTransaction.update({
            where: { id: existingTx.id },
            data: {
              status: t.status,
              updatedAt: new Date(t.updated_at),
            },
          });
        }

        // Проверяем, существует ли уже связь для (userId, gateTransactionId)
        const ownerLink = await db.gateTransactionOwner.findUnique({
          where: {
            userId_gateTransactionId: {
              userId,
              gateTransactionId: existingTx.id,
            },
          },
        });

        if (!ownerLink) {
          // Если транзакция уже смэтчена кем-то, ставим флаг matched = true для данного пользователя
          const alreadyMatched = await db.transactionMatch.findFirst({
            where: { gateTxId: existingTx.id },
          });
          let matchedFlag = alreadyMatched ? true : false;

          await db.gateTransactionOwner.create({
            data: {
              userId,
              gateTransactionId: existingTx.id,
              matched: matchedFlag,
            },
          });

          processedCount++;
        } else {
          // Связь уже существует – можно при необходимости обновить флаг matched
        }
      } catch (error) {
        console.error(
          `❌ Ошибка при обработке транзакции Gate#${t.id} для user#${userId}:`,
          error
        );
      }
    }

    return { processed: processedCount, total: transactions.length };
  }

  /**
   * Метод start: проходит по всем активным кукам, загружает транзакции,
   * сохраняет/обновляет их, а затем вызывает matchingService для пользователя.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.updateServiceStats({ isRunning: true });

    // Initial run
    await this.processAllCookies();
    
    // Set up interval for periodic runs
    this.intervalId = setInterval(async () => {
      await this.processAllCookies();
    }, this.MONITORING_INTERVAL);
  }

  private async processAllCookies(): Promise<void> {
    const gateCookies = await db.gateCookie.findMany({
      where: { isActive: true },
    });

    console.log(`👥 Обработка ${gateCookies.length} активных куки Gate`);

    for (const gateCookie of gateCookies) {
      try {
        const isValid = await this.validateCookie(gateCookie);
        if (!isValid) {
          console.log(`❌ Cookie для user#${gateCookie.userId} не валидно, пропускаем.`);
          continue;
        }

        const transactions = await this.fetchAllGateTransactions(gateCookie);
        console.log(
          `📦 Найдено ${transactions.length} транзакций Gate для user#${gateCookie.userId}`
        );

        if (transactions.length > 0) {
          const { processed, total } = await this.processTransactions(
            gateCookie.userId,
            transactions,
            gateCookie
          );
          console.log(
            `Обработано ${processed} из ${total} транзакций для user#${gateCookie.userId}`
          );
        }

        // После сохранения запускаем matchingService для данного пользователя
        console.log(`⏳ Запускаем matchingService для user#${gateCookie.userId}`);
        await this.matchingService.processUserTransactions(gateCookie.userId);
        console.log(`✅ matchingService завершил работу для user#${gateCookie.userId}`);

        // Небольшая задержка между обработкой пользователей чтобы не перегружать систему
        await this.delay(1000);
      } catch (error) {
        console.error(`❌ Ошибка при обработке user#${gateCookie.userId}:`, error);
      }
    }

    this.updateServiceStats({
      lastRunTime: new Date(),
      isRunning: true,
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.updateServiceStats({ isRunning: false });
  }
}
