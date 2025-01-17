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

    try {
      // Get unprocessed P2P transactions from last 24 hours
      const p2pTransactions = await this.db.p2PTransaction.findMany({
        where: {
          userId,
          processed: false,
          completedAt: { gt: oneDayAgo },
        },
      });
      console.log(
        `Found ${p2pTransactions.length} unprocessed P2P transactions for user ${userId}`,
      );

      // Get all approved Gate transactions
      const gateTransactions = await this.db.gateTransaction.findMany({
        where: {
          userId,
          approvedAt: { not: null },
        },
      });
      console.log(
        `Found ${gateTransactions.length} approved Gate transactions for user ${userId}`,
      );

      // Process each P2P transaction
      for (const p2pTx of p2pTransactions) {
        console.log(`\nProcessing P2P transaction ${p2pTx.id}:`);
        console.log(`  Amount: ${p2pTx.totalRub} RUB`);
        console.log(`  Completed at: ${p2pTx.completedAt}`);

        // Try to find matching Gate transaction
        for (const gateTx of gateTransactions) {
          if (!gateTx.approvedAt) {
            console.log(
              `Skipping Gate transaction ${gateTx.id} - no approvedAt timestamp`,
            );
            continue;
          }

          const timeDiffMinutes = Math.abs(
            (p2pTx.completedAt.getTime() - gateTx.approvedAt.getTime()) /
              (1000 * 60),
          );

          console.log(`\nComparing with Gate transaction ${gateTx.id}:`);
          console.log(
            `  Time difference: ${timeDiffMinutes.toFixed(2)} minutes`,
          );
          console.log(`  P2P amount: ${p2pTx.totalRub} RUB`);
          console.log(`  Gate amount: ${gateTx.amountRub} RUB`);
          console.log(
            `  Amount difference: ${Math.abs(p2pTx.totalRub - gateTx.amountRub)} RUB`,
          );

          // Check if transactions match our criteria
          if (
            timeDiffMinutes <= 30 &&
            Math.abs(p2pTx.totalRub - gateTx.amountRub) < 0.01
          ) {
            try {
              // Create match record and mark P2P transaction as processed
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
              console.log(`✅ Successfully matched transactions:`);
              console.log(`   P2P ID: ${p2pTx.id}`);
              console.log(`   Gate ID: ${gateTx.id}`);
              break; // Move to next P2P transaction after finding a match
            } catch (error) {
              console.error(`❌ Error saving transaction match:`, error);
              // Continue processing other transactions even if one fails
            }
          } else {
            console.log(`❌ No match - Criteria not met:`);
            console.log(`   Time diff > 30 min: ${timeDiffMinutes > 30}`);
            console.log(
              `   Amount diff ≥ 0.01: ${Math.abs(p2pTx.totalRub - gateTx.amountRub) >= 0.01}`,
            );
          }
        }
      }

      return matches;
    } catch (error) {
      console.error(
        `❌ Error processing transactions for user ${userId}:`,
        error,
      );
      throw error; // Re-throw to be handled by caller
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("🟨 Service is already running");
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

        // Get all users
        const users = await this.db.user.findMany({
          select: {
            id: true,
            username: true,
            login: true
          },
        });

        console.log(
          `👥 Processing ${users.length} users for transaction matching`,
        );

        // Process each user
        for (const user of users) {
          try {
            console.log(
              `\n📝 Processing user ${user.id} (${user.login})`,
            );
            const matches = await this.processUserTransactions(user.id);
            processedUsers++;
            processedTransactions += matches;
            console.log(
              `✅ Completed processing user ${user.id} - found ${matches} matches`,
            );
          } catch (error) {
            console.error(`❌ Error processing user ${user.id}:`, error);
            errors++;
          }

          // Delay between processing users
          await this.delay(1000);
        }

        // Update service statistics
        this.updateServiceStats({
          processedUsers,
          processedTransactions,
          errors,
          lastRunTime: new Date(),
        });

        // Log final statistics for this cycle
        console.log("\n📊 Cycle Summary:");
        console.log(`   Processed Users: ${processedUsers}`);
        console.log(`   Matched Transactions: ${processedTransactions}`);
        console.log(`   Errors: ${errors}`);

        this.monitor.logStats(this.serviceName);

        // Wait before starting next cycle
        await this.delay(60000);
      } catch (error) {
        console.error(
          "❌ Critical error in transaction matching cycle:",
          error,
        );
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
