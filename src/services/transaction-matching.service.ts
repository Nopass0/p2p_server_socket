// src/services/transaction-matching.service.ts
import type { PrismaClient } from "@prisma/client";
import { BaseService } from "./base.service";
import prisma from "@/db";
import type { ServiceMonitor } from "@/utils/service-monitor";

export class TransactionMatchingService extends BaseService {
  private db: PrismaClient;

  constructor(monitor: ServiceMonitor) {
    super("TransactionMatchingService", monitor);
    this.db = prisma;
  }

  private async processUserTransactions(userId: number): Promise<number> {
    let matches = 0;
    // Берем транзакции за последние 90 дней (90*24*60*60*1000 мс)
    const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    try {
      // Получаем непроцессированные P2P-транзакции для данного пользователя
      const p2pTransactions = await this.db.p2PTransaction.findMany({
        where: {
          userId,
          processed: false,
          completedAt: { gt: sinceDate },
        },
      });
      console.log(
        `Found ${p2pTransactions.length} unprocessed P2P transactions for user ${userId}`
      );

      // Получаем все одобренные Gate-транзакции для данного пользователя
      const gateTransactions = await this.db.gateTransaction.findMany({
        where: {
          userId,
          approvedAt: { not: null },
        },
      });
      console.log(
        `Found ${gateTransactions.length} approved Gate transactions for user ${userId}`
      );

      // Обрабатываем каждую P2P-транзакцию
      for (const p2pTx of p2pTransactions) {
        console.log(`\nProcessing P2P transaction ${p2pTx.id}:`);
        console.log(`  Amount: ${p2pTx.totalRub} RUB`);
        console.log(`  Completed at: ${p2pTx.completedAt}`);

        // Пытаемся найти подходящую Gate-транзакцию
        for (const gateTx of gateTransactions) {
          if (!gateTx.approvedAt) {
            console.log(
              `Skipping Gate transaction ${gateTx.id} - no approvedAt timestamp`
            );
            continue;
          }

          const timeDiffMinutes = Math.abs(
            (p2pTx.completedAt.getTime() - gateTx.approvedAt.getTime()) /
              (1000 * 60)
          );

          // Проверяем, что разница по времени не превышает 30 минут и суммы совпадают (с допуском)
          if (
            timeDiffMinutes <= 30 &&
            Math.abs(p2pTx.totalRub - gateTx.amountRub) < 0.01
          ) {
            try {
              // Создаем запись в TransactionMatch и отмечаем P2P-транзакцию как обработанную
              await this.db.$transaction([
                this.db.transactionMatch.create({
                  data: {
                    userId,
                    p2pTxId: p2pTx.id,
                    gateTxId: gateTx.id,
                    isAutoMatched: true,
                    timeDifference: Math.round(timeDiffMinutes),
                  },
                }),
                this.db.p2PTransaction.update({
                  where: { id: p2pTx.id },
                  data: { processed: true },
                }),
              ]);

              matches++;
              console.log(`✅ Successfully matched transactions (P2P ${p2pTx.id} with Gate ${gateTx.id})`);
              break; // Переходим к следующей P2P-транзакции после успешного матчинга
            } catch (error) {
              console.error(`❌ Error saving transaction match:`, error);
              // Продолжаем обработку других транзакций даже при ошибке одного
            }
          }
        }
      }

      return matches;
    } catch (error) {
      console.error(`❌ Error processing transactions for user ${userId}:`, error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("🟨 Transaction Matching Service is already running");
      return;
    }

    console.log("🟢 Starting Transaction Matching Service");
    this.isRunning = true;
    this.updateServiceStats({ isRunning: true });

    while (this.isRunning) {
      try {
        console.log("\n🔄 Starting transaction matching cycle");
        let processedUsers = 0;
        let processedTransactions = 0;
        let errors = 0;

        // Получаем всех пользователей (или можно выбрать только нужных)
        const users = await this.db.user.findMany({
          select: { id: true, username: true, login: true },
        });

        console.log(`👥 Processing ${users.length} users for transaction matching`);

        // Обрабатываем каждого пользователя
        for (const user of users) {
          try {
            console.log(`\n📝 Processing user ${user.id} (${user.login})`);
            const matches = await this.processUserTransactions(user.id);
            processedUsers++;
            processedTransactions += matches;
            console.log(`✅ Completed processing user ${user.id} - found ${matches} matches`);
          } catch (error) {
            console.error(`❌ Error processing user ${user.id}:`, error);
            errors++;
          }

          // Задержка между пользователями
          await this.delay(1000);
        }

        this.updateServiceStats({
          processedUsers,
          processedTransactions,
          errors,
          lastRunTime: new Date(),
        });

        console.log("\n📊 Cycle Summary:");
        console.log(`   Processed Users: ${processedUsers}`);
        console.log(`   Matched Transactions: ${processedTransactions}`);
        console.log(`   Errors: ${errors}`);

        this.monitor.logStats(this.serviceName);
        // Задержка между циклами (например, 1 минута)
        await this.delay(60000);
      } catch (error) {
        console.error("❌ Critical error in transaction matching cycle:", error);
        this.updateServiceStats({ errors: 1 });
        await this.delay(60000);
      }
    }
  }

  stop(): void {
    console.log("🔴 Stopping Transaction Matching Service");
    this.isRunning = false;
    this.updateServiceStats({ isRunning: false });
  }
}
