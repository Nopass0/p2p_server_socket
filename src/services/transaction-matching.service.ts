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

  /**
   * Обработка транзакций конкретного пользователя.
   * Возвращает количество смэтченных пар.
   */
  public async processUserTransactions(userId: number): Promise<number> {
    let matchesCount = 0;
    // Берём все P2P-транзакции пользователя (необработанные) за последние 90 дней
    const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

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

    // Берём все "владения" GateTransactionOwner, где matched=false,
    // у которых есть GateTransaction.approvedAt != null
    // (т.е. транзакция "одобренная" на Gate)
    const gateTxOwners = await this.db.gateTransactionOwner.findMany({
      where: {
        userId,
        matched: false,
        gateTransaction: {
          approvedAt: { not: null },
        },
      },
      include: {
        gateTransaction: true, // чтобы иметь сами данные транзакции
      },
    });
    console.log(
      `Found ${gateTxOwners.length} GateTransaction(s) for user ${userId} (unmatched)`
    );

    for (const p2pTx of p2pTransactions) {
      // Попробуем найти подходящую GateTransaction по критериям:
      //   - разница по времени <= 30 мин
      //   - суммы равны (с небольшой погрешностью)
      for (const owner of gateTxOwners) {
        if (!owner.gateTransaction.approvedAt) continue;

        const gateTx = owner.gateTransaction;
        const timeDiffMinutes = Math.abs(
          (p2pTx.completedAt.getTime() - gateTx.approvedAt.getTime()) / (1000 * 60)
        );

        if (
          timeDiffMinutes <= 30 &&
          Math.abs(p2pTx.totalRub - gateTx.amountRub) < 0.01
        ) {
          // Проверяем, существует ли уже мэтч с этим gateTxId
          const existingMatch = await this.db.transactionMatch.findFirst({
            where: { gateTxId: gateTx.id },
            select: { id: true },
          });
          if (existingMatch) {
            console.log(
              `Gate transaction #${gateTx.id} is already matched, skipping...`
            );
            continue;
          }

          // Если мэтча ещё нет – создаём новый
          try {
            await this.db.$transaction([
              // Создаём запись в TransactionMatch
              this.db.transactionMatch.create({
                data: {
                  userId,
                  p2pTxId: p2pTx.id,
                  gateTxId: gateTx.id,
                  isAutoMatched: true,
                  timeDifference: Math.round(timeDiffMinutes),
                },
              }),
              // Помечаем P2P-транзакцию, что она обработана
              this.db.p2PTransaction.update({
                where: { id: p2pTx.id },
                data: { processed: true },
              }),
              // Помечаем GateTransactionOwner, что транзакция для этого пользователя уже смэтчена
              this.db.gateTransactionOwner.update({
                where: {
                  userId_gateTransactionId: {
                    userId,
                    gateTransactionId: gateTx.id,
                  },
                },
                data: { matched: true },
              }),
            ]);
            matchesCount++;
            console.log(
              `✅ Matched P2P #${p2pTx.id} with Gate #${gateTx.id}`
            );
            // После удачного мэтча прерываем цикл, чтобы не матчить p2pTx с другими GateTx
            break;
          } catch (err) {
            console.error(`❌ Error saving transaction match:`, err);
          }
        }
      }
    }

    return matchesCount;
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

        // Получаем всех пользователей
        const users = await this.db.user.findMany({
          select: { id: true, username: true, login: true },
        });

        console.log(
          `👥 Processing ${users.length} users for transaction matching`
        );

        // Обрабатываем каждого пользователя
        for (const user of users) {
          try {
            console.log(`\n📝 Processing user ${user.id} (${user.login})`);
            const matched = await this.processUserTransactions(user.id);
            processedUsers++;
            processedTransactions += matched;
            console.log(
              `✅ Completed processing user ${user.id} - found ${matched} matches`
            );
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
        // Задержка между циклами (1 минута)
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
