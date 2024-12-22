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

// Initialize monitor and services
const serviceMonitor = new ServiceMonitor();
const tokenService = new TokenValidationService(serviceMonitor);
const matchingService = new TransactionMatchingService(serviceMonitor);
const gateService = new GateMonitoringService(serviceMonitor);

// Start background services
tokenService.start().catch(console.error);
matchingService.start().catch(console.error);
gateService.start().catch(console.error);

const server = Bun.serve({
  fetch(req) {
    // Handle HTTP endpoints
    if (req.url.endsWith("/api/service-stats")) {
      const stats = Object.fromEntries(serviceMonitor.getAllStats());
      return new Response(JSON.stringify(stats, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle WebSocket upgrade
    const success = server.upgrade(req);
    if (success) {
      return undefined;
    }

    return new Response("Upgrade failed", { status: 500 });
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
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Unknown message type",
              }),
            );
        }
      } catch (error) {
        console.error("❌ Ошибка:", error);
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Internal server error",
          }),
        );
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
