// src/services/token-validation.service.ts
import { BaseService } from "./base.service";
import db from "../db";
import type { TokenValidationResult } from "../types/services";
import type { ServiceMonitor } from "@/utils/service-monitor";

export class TokenValidationService extends BaseService {
  constructor(monitor: ServiceMonitor) {
    super("TokenValidationService", monitor);
  }

  private async validateToken(token: string): Promise<TokenValidationResult> {
    try {
      const response = await fetch(
        "https://p2p.walletbot.me/api/v1/transactions/",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const data = await response.json();
      return {
        isValid: !(
          "code" in data &&
          (data.code === "token_expired" || data.code === "creds_not_provided")
        ),
      };
    } catch (error) {
      console.error("Error validating token:", error);
      return {
        isValid: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async processOrders(userId: number, token: string): Promise<void> {
    try {
      // Получаем пользователя для доступа к currentTgPhone
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { currentTgPhone: true }
      });

      const response = await fetch("http://127.0.0.1:9000/get_orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `token=${encodeURIComponent(token)}`,
      });
      
      // Пробуем получить данные
      const ordersResponse: any = await response?.json();
      if (!Array.isArray(ordersResponse)) {
          console.log(`ℹ️ Не вернуло транзакций для user#${userId}`);
          return;
      }
      console.log(`📦 Найдено ${ordersResponse.length} транзакций для user#${userId}`);

      for (const order of ordersResponse) {
        const existingOrder = await db.p2PTransaction.findFirst({
          where: {
            userId,
            telegramId: String(order.order_id), // Приводим к строке
          },
        });

        if (!existingOrder) {
          // Вспомогательная функция для разбора значений
          const parseAmount = (value: any): number => {
            if (typeof value === "string") {
              return parseFloat(value.replace(/,/g, "."));
            }
            return typeof value === "number" ? value : 0;
          };

          // Формируем данные транзакции
          const transactionData = {
            userId,
            telegramId: String(order.order_id),
            status: order.status,
            amount: parseAmount(order.volume?.value ?? 0),
            totalRub: parseAmount(order.amount?.value ?? 0),
            price: 0,
            buyerName: String(order.buyer_id),
            method: order.payment_method || "unknown",
            completedAt: new Date(order.status_update_time),
            processed: false,
          };

          // Добавляем currentTgPhone, если он существует
          if (user?.currentTgPhone) {
            Object.assign(transactionData, { currentTgPhone: user.currentTgPhone });
          }

          await db.p2PTransaction.create({
            data: transactionData,
          });
          console.log(
            `Created new P2P transaction for user ${userId}, order ID: ${order.order_id}`,
          );
        }
      }
    } catch (error) {
      console.error(`Error processing orders for user ${userId}:`, error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.updateServiceStats({ isRunning: true });

    while (this.isRunning) {
      try {
        console.log("🔄 Starting token validation cycle");
        let processedUsers = 0;
        let processedTransactions = 0;
        let errors = 0;

        const users = await db.user.findMany({
          where: { tgAuthToken: { not: null } },
        });

        console.log(`👥 Processing ${users.length} users with tokens`);

        for (const user of users) {
          if (!user.tgAuthToken) continue;

          const validationResult = await this.validateToken(user.tgAuthToken);

          if (!validationResult.isValid) {
            await db.user.update({
              where: { id: user.id },
              data: { tgAuthToken: null },
            });
            console.log(`❌ Cleared invalid token for user ${user.id}`);
            errors++;
            continue;
          }

          try {
            await this.processOrders(user.id, user.tgAuthToken);
            processedUsers++;
          } catch (error) {
            console.error(
              `❌ Error processing orders for user ${user.id}:`,
              error,
            );
            errors++;
          }

          await this.delay(100);
        }

        this.updateServiceStats({
          processedUsers,
          processedTransactions,
          errors,
          lastRunTime: new Date(),
        });

        this.monitor.logStats(this.serviceName);

        await this.delay(600);
      } catch (error) {
        console.error("❌ Error in token validation cycle:", error);
        this.updateServiceStats({ errors: 1 });
        await this.delay(600);
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    this.updateServiceStats({ isRunning: false });
  }
}
