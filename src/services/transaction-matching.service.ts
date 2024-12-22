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
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [p2pTransactions, gateTransactions] = await Promise.all([
      this.db.p2PTransaction.findMany({
        where: {
          userId,
          processed: false,
          completedAt: { gt: oneDayAgo },
        },
      }),
      this.db.gateTransaction.findMany({
        where: {
          userId,
          approvedAt: { not: null },
        },
      }),
    ]);

    for (const p2pTx of p2pTransactions) {
      for (const gateTx of gateTransactions) {
        if (!gateTx.approvedAt) continue;

        const timeDiffMinutes = Math.abs(
          (p2pTx.completedAt.getTime() - gateTx.approvedAt.getTime()) /
            (1000 * 60),
        );

        if (
          timeDiffMinutes <= 30 &&
          Math.abs(p2pTx.amount - gateTx.amountUsdt) < 0.01
        ) {
          await this.db.p2PTransaction.update({
            where: { id: p2pTx.id },
            data: { processed: true },
          });

          matches++;
          console.log(
            `✅ Matched transactions for user ${userId}:`,
            `P2P ID ${p2pTx.id} with Gate ID ${gateTx.id}`,
          );
          break;
        }
      }
    }

    return matches;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.updateServiceStats({ isRunning: true });

    while (this.isRunning) {
      try {
        console.log("🔄 Starting transaction matching cycle");
        let processedUsers = 0;
        let processedTransactions = 0;
        let errors = 0;

        const users = await this.db.user.findMany();
        console.log(
          `👥 Processing ${users.length} users for transaction matching`,
        );

        for (const user of users) {
          try {
            const matches = await this.processUserTransactions(user.id);
            processedUsers++;
            processedTransactions += matches;
          } catch (error) {
            console.error(`❌ Error processing user ${user.id}:`, error);
            errors++;
          }

          await this.delay(1000);
        }

        this.updateServiceStats({
          processedUsers,
          processedTransactions,
          errors,
          lastRunTime: new Date(),
        });

        this.monitor.logStats(this.serviceName);

        await this.delay(60000);
      } catch (error) {
        console.error("❌ Error in transaction matching cycle:", error);
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
