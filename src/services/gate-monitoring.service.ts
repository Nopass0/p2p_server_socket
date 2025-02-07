// src/services/gate-monitoring.service.ts
import { BaseService } from "./base.service";
import db from "../db";
import axios, { AxiosError } from "axios";
import { ServiceMonitor } from "../utils/service-monitor";
import type { GateCookie } from "@prisma/client";
import { Prisma } from "@prisma/client"; // для проверки ошибки
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
  
  // Сервис мэтчинга
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
    gateCookie: GateCookie,
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

  // processTransactions возвращает объект с количеством обработанных транзакций и общим числом транзакций
  private async processTransactions(
    userId: number,
    transactions: GatePayment[],
    gateCookie: GateCookie,
  ): Promise<{ processed: number; total: number }> {
    let processedCount = 0;
    for (const transaction of transactions) {
      try {
        // Ищем запись по transactionId (без фильтра по userId)
        const existingTransaction = await db.gateTransaction.findFirst({
          where: {
            transactionId: String(transaction.id),
          },
        });
        console.log("🔍 Поиск транзакции", transaction.id);
        if (!existingTransaction) {
          // Если транзакция отсутствует – создаём новую для данного пользователя
          try {
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
                approvedAt: transaction.approved_at ? new Date(transaction.approved_at) : null,
                expiredAt: transaction.expired_at ? new Date(transaction.expired_at) : null,
                createdAt: new Date(transaction.created_at),
                updatedAt: new Date(transaction.updated_at),
                traderId: transaction.trader?.id || null,
                traderName: transaction.trader?.name || null,
                attachments: transaction.attachments || null,
                idexId: String(transaction.trader?.id) || null,
              },
            });
            console.log(
              `✅ Добавлена новая транзакция Gate: ${transaction.id} для пользователя ${userId}`
            );
            processedCount++;
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002"
            ) {
              console.log(`⚠️ Транзакция с id ${transaction.id} уже существует, пропускаем.`);
            } else {
              console.error(
                `❌ Ошибка при создании транзакции ${transaction.id} для пользователя ${userId}:`,
                error
              );
            }
          }
        } else {
          // Если запись с таким transactionId уже существует,
          // проверяем, прошло ли с момента её создания более 5 минут.
          const createdAt = new Date(existingTransaction.createdAt);
          const now = new Date();
          const diffMs = now.getTime() - createdAt.getTime();
          if (diffMs > 5 * 60 * 1000) {
            // Если прошло более 5 минут – проверяем наличие связи в TransactionMatch
            const existingMatch = await db.transactionMatch.findFirst({
              where: { gateTxId: existingTransaction.id },
            });
            if (existingMatch) {
              console.log(
                `⚠️ Для транзакции ${transaction.id} уже существует связь в TransactionMatch, пропускаем создание новой транзакции.`
              );
            } else {
              // Если связи нет – создаём новую транзакцию для данного пользователя с тем же transactionId
              try {
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
                    approvedAt: transaction.approved_at ? new Date(transaction.approved_at) : null,
                    expiredAt: transaction.expired_at ? new Date(transaction.expired_at) : null,
                    createdAt: new Date(transaction.created_at),
                    updatedAt: new Date(transaction.updated_at),
                    traderId: transaction.trader?.id || null,
                    traderName: transaction.trader?.name || null,
                    attachments: transaction.attachments || null,
                    idexId: String(transaction.trader?.id) || null,
                  },
                });
                console.log(
                  `✅ Создана дополнительная транзакция Gate с transactionId ${transaction.id} для пользователя ${userId}`
                );
                processedCount++;
              } catch (error) {
                console.error(
                  `❌ Ошибка при создании дополнительной транзакции ${transaction.id} для пользователя ${userId}:`,
                  error
                );
              }
            }
          } else {
            console.log(
              `ℹ️ Транзакция ${transaction.id} создана менее 5 минут назад – пропускаем.`
            );
          }
        }
      } catch (error) {
        console.error(
          `❌ Ошибка при обработке транзакции ${transaction.id} для пользователя ${userId}:`,
          error
        );
      }
    }
    return { processed: processedCount, total: transactions.length };
  }

  /**
   * Метод start() обрабатывает пользователей последовательно:
   *  - Для каждого активного GateCookie (пользователя) грузятся все Gate-транзакции.
   *  - Выполняется обработка транзакций.
   *  - После обработки для текущего пользователя вызывается matchingService.processUserTransactions(userId)
   *    и сервис ждёт его завершения.
   *  - Затем производится задержка в 5 минут, прежде чем перейти к следующему пользователю.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.updateServiceStats({ isRunning: true });

    // Получаем список активных куки (по пользователям)
    const gateCookies = await db.gateCookie.findMany({
      where: { isActive: true },
    });

    console.log(`👥 Обработка ${gateCookies.length} активных куки Gate`);

    // Обработка пользователей по одному
    for (const gateCookie of gateCookies) {
      try {
        const isValid = await this.validateCookie(gateCookie);
        if (!isValid) {
          console.log(`❌ Cookie для пользователя ${gateCookie.userId} не валидно, пропускаем.`);
          continue;
        }
        const transactions = await this.fetchAllGateTransactions(gateCookie);
        console.log(
          `📦 Найдено ${transactions.length} транзакций Gate для пользователя ${gateCookie.userId}`
        );
        if (transactions.length > 0) {
          const { processed, total } = await this.processTransactions(
            gateCookie.userId,
            transactions,
            gateCookie
          );
          console.log(
            `Обработано ${processed} из ${total} транзакций для пользователя ${gateCookie.userId}`
          );
        }
        // Вызываем matchingService для данного пользователя и ждём завершения его работы
        console.log(`⏳ Ждём, пока matchingService отработает для пользователя ${gateCookie.userId}`);
        await this.matchingService.processUserTransactions(gateCookie.userId);
        console.log(`✅ matchingService завершил обработку для пользователя ${gateCookie.userId}`);
        // Ждем 5 минут перед переходом к следующему пользователю
        await this.delay(5 * 60 * 1000);
      } catch (error) {
        console.error(`❌ Ошибка при обработке пользователя ${gateCookie.userId}:`, error);
      }
    }

    this.updateServiceStats({
      lastRunTime: new Date(),
      isRunning: false,
    });
    this.isRunning = false;
  }

  stop(): void {
    this.isRunning = false;
    this.updateServiceStats({ isRunning: false });
  }
}
