// src/services/receipt-processing.service.ts
import type { PrismaClient } from "@prisma/client";
import { BaseService } from "./base.service";
import prisma from "@/db";
import type { ServiceMonitor } from "@/utils/service-monitor";
import path from "path";
import fs from "fs/promises";
import axios from "axios";

interface Attachment {
  name: string;
  size: number;
  extension: string;
  file_name: string;
  created_at: string;
  original_url: string;
  custom_properties: {
    fake: boolean;
  };
}

export class ReceiptProcessingService extends BaseService {
  private db: PrismaClient;
  private readonly receiptBasePath = "receipts";
  private readonly baseUrl = "https://cdn.gate.cx/";

  constructor(monitor: ServiceMonitor) {
    super("ReceiptProcessingService", monitor);
    this.db = prisma;
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  private async downloadFile(url: string, filePath: string): Promise<void> {
    const response = await axios({
      url,
      method: "GET",
      responseType: "arraybuffer",
    });

    await fs.writeFile(filePath, response.data);
  }

  private async processTransaction(transaction: any): Promise<number> {
    let processedReceipts = 0;

    if (!transaction.attachments) {
      return processedReceipts;
    }

    const attachments: Attachment[] = transaction.attachments;
    const pdfAttachments = attachments.filter(
      (att) =>
        att.extension.toLowerCase() === "pdf" && !att.custom_properties.fake,
    );

    if (pdfAttachments.length === 0) {
      return processedReceipts;
    }

    // Создаем директорию для чеков этой транзакции
    const transactionDir = path.join(
      this.receiptBasePath,
      transaction.id.toString(),
    );
    await this.ensureDirectoryExists(transactionDir);

    for (const attachment of pdfAttachments) {
      try {
        // Проверяем, не обработан ли уже этот чек
        const existingReceipt = await this.db.receipt.findFirst({
          where: {
            gateId: transaction.id,
            fileName: attachment.file_name,
          },
        });

        if (existingReceipt) {
          console.log(
            `Receipt ${attachment.file_name} already processed for transaction ${transaction.id}`,
          );
          continue;
        }

        const filePath = path.join(transactionDir, attachment.file_name);
        const fileUrl = `${this.baseUrl}${attachment.original_url}`;

        console.log(`Downloading receipt from ${fileUrl} to ${filePath}`);
        await this.downloadFile(fileUrl, filePath);

        // Создаем запись в базе данных
        await this.db.receipt.create({
          data: {
            gateId: transaction.id,
            bankLabel: transaction.bankLabel,
            fileName: attachment.file_name,
            fileSize: attachment.size,
            filePath: filePath,
            isVerified: false,
          },
        });

        processedReceipts++;
        console.log(
          `✅ Successfully processed receipt ${attachment.file_name} for transaction ${transaction.id}`,
        );
      } catch (error) {
        console.error(
          `❌ Error processing receipt for transaction ${transaction.id}:`,
          error,
        );
      }
    }

    return processedReceipts;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("🟨 Service is already running");
      return;
    }

    console.log("🟢 Starting Receipt Processing Service");
    this.isRunning = true;
    this.updateServiceStats({ isRunning: true });

    // Создаем базовую директорию для чеков
    await this.ensureDirectoryExists(this.receiptBasePath);

    while (this.isRunning) {
      try {
        console.log("\n🔄 Starting receipt processing cycle");
        let processedTransactions = 0;
        let processedReceipts = 0;
        let errors = 0;

        // Получаем транзакции с непроверенными чеками
        const transactions = await this.db.gateTransaction.findMany({
          where: {
            attachments: { not: null },
            receipts: { none: {} }, // Только транзакции без обработанных чеков
          },
        });

        console.log(
          `📝 Found ${transactions.length} transactions with unprocessed receipts`,
        );

        for (const transaction of transactions) {
          try {
            const receiptsCount = await this.processTransaction(transaction);
            if (receiptsCount > 0) {
              processedTransactions++;
              processedReceipts += receiptsCount;
            }
          } catch (error) {
            console.error(
              `❌ Error processing transaction ${transaction.id}:`,
              error,
            );
            errors++;
          }

          await this.delay(1000); // Задержка между обработкой транзакций
        }

        // Обновляем статистику
        this.updateServiceStats({
          processedTransactions,
          processedReceipts,
          errors,
          lastRunTime: new Date(),
        });

        // Логируем итоги цикла
        console.log("\n📊 Cycle Summary:");
        console.log(`   Processed Transactions: ${processedTransactions}`);
        console.log(`   Processed Receipts: ${processedReceipts}`);
        console.log(`   Errors: ${errors}`);

        this.monitor.logStats(this.serviceName);

        // Ждем перед следующим циклом
        await this.delay(60000);
      } catch (error) {
        console.error("❌ Critical error in receipt processing cycle:", error);
        this.updateServiceStats({ errors: 1 });
        await this.delay(60000);
      }
    }
  }

  stop(): void {
    console.log("🔴 Stopping Receipt Processing Service");
    this.isRunning = false;
    this.updateServiceStats({ isRunning: false });
  }
}
