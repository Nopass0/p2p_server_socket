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
    // Рассматриваем транзакции за последние 90 дней
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    try {
      // Получаем P2P-транзакции, относящиеся к данному пользователю, которые ещё не обработаны
      const p2pTransactions = await this.db.p2PTransaction.findMany({
        where: {
          userId,
          processed: false,
          completedAt: { gt: ninetyDaysAgo },
        },
      });
      console.log(`Найдено ${p2pTransactions.length} необработанных P2P транзакций для пользователя ${userId}`);

      // Получаем все одобренные Gate транзакции (approvedAt не null)
      const gateTransactions = await this.db.gateTransaction.findMany({
        where: { approvedAt: { not: null } },
      });
      console.log(`Найдено ${gateTransactions.length} одобренных Gate транзакций для мэтчинга`);

      for (const p2pTx of p2pTransactions) {
        console.log(`\nОбработка P2P транзакции ${p2pTx.id}:`);
        console.log(`  Сумма: ${p2pTx.totalRub} RUB`);
        console.log(`  Завершена в: ${p2pTx.completedAt}`);

        for (const gateTx of gateTransactions) {
          if (!gateTx.approvedAt) {
            console.log(`Пропуск Gate транзакции ${gateTx.id} – отсутствует approvedAt`);
            continue;
          }

          // Вычисляем разницу по времени в минутах
          const timeDiffMinutes = Math.abs(
            (p2pTx.completedAt.getTime() - new Date(gateTx.approvedAt).getTime()) / (1000 * 60)
          );

          // Если разница не превышает 30 минут и сумма транзакций совпадает (с точностью до 0.01)
          if (
            timeDiffMinutes <= 30 &&
            Math.abs(p2pTx.totalRub - gateTx.amountRub) < 0.01
          ) {
            try {
              // В рамках одной транзакции создаём мэтч и помечаем P2P транзакцию как обработанную
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
              console.log(`✅ Мэтч найден: P2P ${p2pTx.id} с Gate ${gateTx.id}`);
              // Если мэтч найден, выходим из внутреннего цикла для данной P2P транзакции
              break;
            } catch (error) {
              console.error(`❌ Ошибка при создании мэтча для пользователя ${userId} (P2P ${p2pTx.id}, Gate ${gateTx.id}):`, error);
            }
          }
        }
      }

      return matches;
    } catch (error) {
      console.error(`❌ Ошибка при обработке транзакций для пользователя ${userId}:`, error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("🟨 Сервис мэтчинга уже запущен");
      return;
    }
    console.log("🟢 Запуск сервиса Transaction Matching");
    this.isRunning = true;
    this.updateServiceStats({ isRunning: true });

    while (this.isRunning) {
      try {
        console.log("\n🔄 Запуск цикла мэтчинга транзакций");
        let processedUsers = 0;
        let processedTransactions = 0;
        let errors = 0;

        const users = await this.db.user.findMany({
          select: { id: true, username: true, login: true },
        });
        console.log(`👥 Обработка ${users.length} пользователей для мэтчинга`);

        for (const user of users) {
          try {
            console.log(`\n📝 Обработка пользователя ${user.id} (${user.login})`);
            const userMatches = await this.processUserTransactions(user.id);
            processedUsers++;
            processedTransactions += userMatches;
            console.log(`✅ Пользователь ${user.id} обработан – найдено ${userMatches} мэтчей`);
          } catch (error) {
            console.error(`❌ Ошибка при обработке пользователя ${user.id}:`, error);
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
        console.log("\n📊 Итог цикла:");
        console.log(`   Обработано пользователей: ${processedUsers}`);
        console.log(`   Мэтчей найдено: ${processedTransactions}`);
        console.log(`   Ошибок: ${errors}`);

        this.monitor.logStats(this.serviceName);
        await this.delay(60000);
      } catch (error) {
        console.error("❌ Критическая ошибка в цикле мэтчинга транзакций:", error);
        this.updateServiceStats({ errors: 1 });
        await this.delay(60000);
      }
    }
  }

  stop(): void {
    console.log("🔴 Остановка сервиса Transaction Matching");
    this.isRunning = false;
    this.updateServiceStats({ isRunning: false });
  }
}
