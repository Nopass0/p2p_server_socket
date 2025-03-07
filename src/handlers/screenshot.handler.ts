// src/handlers/screenshot.handler.ts
import type { MyWebSocket } from "../types/websocket";
import type { ScreenshotMessage } from "../types/messages";
import { saveScreenshot } from "../services/screenshot";
import { GeminiService } from "../services/gemini";
import { connectionStore } from "../store/connections";
import db from "@/db";

export async function handleScreenshot(
  ws: MyWebSocket,
  message: ScreenshotMessage,
) {
  if (!ws.data) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Not authenticated",
      }),
    );
    return;
  }

  const connectionData = connectionStore.get(ws);
  if (!connectionData?.geminiToken) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Gemini token not found",
      }),
    );
    return;
  }

  try {
    // Сохраняем скриншот
    const buffer = Buffer.from(
      message.data.replace(/^data:image\/png;base64,/, ""),
      "base64",
    );
    const filePath = await saveScreenshot(
      ws.data.userId,
      connectionData.deviceId,
      buffer,
      message.metadata,
    );

    // Анализируем скриншот через Gemini
    const gemini = new GeminiService(connectionData.geminiToken);
    const analysis = await gemini.analyzeScreenshot(filePath);

    if (analysis.type === "automation") {
      // Отправляем инструкции для автоматизации
      ws.send(
        JSON.stringify({
          type: "automation_action",
          action: analysis.data,
        }),
      );
    } else {
      // Обрабатываем данные транзакции
      const transactionData = analysis.data;

      // Проверяем существование транзакции
      const existingTransaction = await db.p2PTransaction.findUnique({
        where: {
          userId_telegramId: {
            userId: ws.data.userId,
            telegramId: transactionData.telegramId,
          },
        },
      });

      if (!existingTransaction) {
        // Создаем новую транзакцию
        await db.p2PTransaction.create({
          data: {
            userId: ws.data.userId,
            ...transactionData,
            processed: true,
          },
        });

        // Отправляем подтверждение
        ws.send(
          JSON.stringify({
            type: "transaction_saved",
            telegramId: transactionData.telegramId,
          }),
        );
      } else {
        // Сигнализируем о дубликате
        ws.send(
          JSON.stringify({
            type: "transaction_duplicate",
            telegramId: transactionData.telegramId,
          }),
        );
      }
    }
  } catch (error) {
    console.error("Error processing screenshot:", error);
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Failed to process screenshot",
      }),
    );
  }
}
