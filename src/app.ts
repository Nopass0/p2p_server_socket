// src/app.ts
import type { Server } from "bun";
import type { MyWebSocket } from "./types/websocket";
import { handleAuth } from "./handlers/auth.handler";
import { handleScreenshot } from "./handlers/screenshot.handler";
import type { Message } from "./types/messages";
import { ServiceMonitor } from "./utils/service-monitor";
import { TokenValidationService } from "./services/token-validation.service";
import { TransactionMatchingService } from "./services/transaction-matching.service";
import { GateMonitoringService } from "./services/gate-monitoring.service";
import { ReceiptProcessingService } from "./services/receipt-processing.service";
import { getReceiptPath } from "./utils/receipts";

// Initialize monitor and services
const serviceMonitor = new ServiceMonitor();
const tokenService = new TokenValidationService(serviceMonitor);
const matchingService = new TransactionMatchingService(serviceMonitor);
const gateService = new GateMonitoringService(serviceMonitor, matchingService);
// const receiptProcessor = new ReceiptProcessingService(serviceMonitor);

// Общие CORS заголовки
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Start background services
tokenService.start().catch(console.error);
matchingService.start().catch(console.error);
gateService.start().catch(console.error);
// receiptProcessor.start().catch(console.error);

const server = Bun.serve({
  async fetch(req) {
    // Обработка CORS preflight запросов
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // HTTP endpoint: получение статистики сервиса
    if (req.url.endsWith("/api/service-stats")) {
      const stats = Object.fromEntries(serviceMonitor.getAllStats());
      return new Response(JSON.stringify(stats, null, 2), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    // Обработка запросов на получение PDF
    if (req.url.includes("/api/receipts/")) {
      const urlParts = req.url.split("/");
      const receiptIdWithParams = urlParts[urlParts.length - 1];
      const receiptId = parseInt(
        receiptIdWithParams.split("?")[0].split("#")[0],
      );

      if (isNaN(receiptId)) {
        return new Response("Invalid receipt ID", {
          status: 400,
          headers: corsHeaders,
        });
      }

      try {
        const filePath = await getReceiptPath(receiptId);
        const file = await Bun.file(filePath);
        const isDownload = req.url.includes("/download");
        const headers = {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=31536000",
        };
        if (isDownload) {
          headers["Content-Disposition"] =
            `attachment; filename="receipt_${receiptId}.pdf"`;
        } else {
          headers["Content-Disposition"] = "inline";
        }
        return new Response(file, { headers });
      } catch (error) {
        console.error(`Error serving receipt ${receiptId}:`, error);
        return new Response("Receipt not found", {
          status: 404,
          headers: corsHeaders,
        });
      }
    }

    // Handle WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      const success = server.upgrade(req);
      if (success) return undefined;
      return new Response("Upgrade failed", {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Все остальные запросы возвращают 404
    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders,
    });
  },

  websocket: {
    async message(ws: MyWebSocket, message: string | Buffer) {
      try {
        const data = JSON.parse(message.toString()) as Message;
        console.log("📩 Получено сообщение:", data);
        switch (data.type) {
          case "auth":
            await handleAuth(ws, data);
            break;
          case "screenshot":
            await handleScreenshot(ws, data);
            break;
          default:
            ws.send(JSON.stringify({
              type: "error",
              message: "Unknown message type",
            }));
        }
      } catch (error) {
        console.error("❌ Ошибка:", error);
        ws.send(JSON.stringify({
          type: "error",
          message: "Internal server error",
        }));
      }
    },
    open(ws: MyWebSocket) {
      console.log("🔌 Новое подключение установлено");
    },
    close(ws: MyWebSocket) {
      console.log("🔌 Соединение закрыто");
    },
  },

  port: 3000,
});

console.log("🚀 WebSocket сервер запущен на ws://localhost:3000");
console.log("🔄 Фоновые сервисы запущены");
