import { existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import prisma from "./db";

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

// Инициализация фоновых сервисов
const serviceMonitor = new ServiceMonitor();
const tokenService = new TokenValidationService(serviceMonitor);
const matchingService = new TransactionMatchingService(serviceMonitor);
const gateService = new GateMonitoringService(serviceMonitor, matchingService);
// const receiptProcessor = new ReceiptProcessingService(serviceMonitor);

// Общие CORS заголовки
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS, POST, PUT, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Запуск фоновых сервисов
tokenService.start().catch(console.error);
matchingService.start().catch(console.error);
gateService.start().catch(console.error);
// receiptProcessor.start().catch(console.error);

// Функция-обработчик для загрузки новой версии (без multipart/form-data)
// Ожидается, что клиент отправит JSON, например:
// {
//   "fileContent": "<base64-encoded>",
//   "fileName": "myFile.exe",
//   "version": "1.2.3",
//   "userId": "123"
// }
async function handleAddVersion(req: Request): Promise<Response> {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response("Ожидается JSON", {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain",
        },
      });
    }

    // Читаем JSON из тела запроса
    const { fileContent, fileName, version, userId } = await req.json();

    if (!fileContent || !fileName || !version || !userId) {
      return new Response("Отсутствуют необходимые поля", {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain",
        },
      });
    }

    // 1. Ensure the user exists, or the create() will fail with a foreign key error
    const user = await prisma.user.findUnique({
      where: { id: Number(userId) },
    });
    if (!user) {
      return new Response("Пользователь с таким ID не существует", {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain",
        },
      });
    }

    // 2. Decode base64 to a Buffer
    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileContent, "base64");
    } catch (err) {
      console.error("Ошибка декодирования base64:", err);
      return new Response("Ошибка декодирования base64", {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain",
        },
      });
    }

    // 3. Compute hash
    const hash = createHash("sha256").update(buffer).digest("hex");

    // 4. Ensure ./uploads directory exists
    const uploadsDir = "./uploads";
    if (!existsSync(uploadsDir)) {
      mkdirSync(uploadsDir, { recursive: true });
    }

    // 5. Write the file
    const finalFileName = `${version}-${fileName}`;
    const filePath = `${uploadsDir}/${finalFileName}`;
    await Bun.write(filePath, buffer);

    // 6. Build download URL
    const downloadUrl = `../uploads/${finalFileName}`;

    // 7. Create AppVersion record
    const appVersion = await prisma.appVersion.create({
      data: {
        version,
        fileName: finalFileName,
        hash,
        downloadUrl,
        isMain: false,
        uploadedBy: user.id, // reference the existing user
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // 8. Return success response
    return new Response(
      JSON.stringify({
        hash,
        downloadUrl,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Ошибка в addVersion эндпоинте:", error);
    return new Response("Internal Server Error", {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain",
      },
    });
  }
}

const server = Bun.serve({
  async fetch(req) {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    // /api/service-stats
    if (req.url.endsWith("/api/service-stats")) {
      const stats = Object.fromEntries(serviceMonitor.getAllStats());
      return new Response(JSON.stringify(stats, null, 2), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    // /addVersion
    if (req.url.endsWith("/addVersion") && req.method === "POST") {
      return handleAddVersion(req);
    }

    // /api/latest-version
    if (req.url.endsWith("/api/latest-version")) {
      try {
        const latestVersion = await prisma.appVersion.findFirst({
          where: { isMain: true },
          orderBy: { createdAt: "desc" },
        });
        if (!latestVersion) {
          return new Response("No version found", {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "text/plain",
            },
          });
        }
        const responseBody = JSON.stringify({
          version: latestVersion.version,
          download_url: latestVersion.downloadUrl,
          hash: latestVersion.hash,
        });
        return new Response(responseBody, {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        });
      } catch (error) {
        console.error("Error fetching latest version:", error);
        return new Response("Internal Server Error", {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/plain",
          },
        });
      }
    }

    // PDF receipts
    if (req.url.includes("/api/receipts/")) {
      const urlParts = req.url.split("/");
      const receiptIdWithParams = urlParts[urlParts.length - 1];
      const receiptId = parseInt(
        receiptIdWithParams.split("?")[0].split("#")[0]
      );

      if (isNaN(receiptId)) {
        return new Response("Invalid receipt ID", {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/plain",
          },
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
          headers["Content-Disposition"] = `attachment; filename=\"receipt_${receiptId}.pdf\"`;
        } else {
          headers["Content-Disposition"] = "inline";
        }
        return new Response(file, { headers });
      } catch (error) {
        console.error(`Error serving receipt ${receiptId}:`, error);
        return new Response("Receipt not found", {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/plain",
          },
        });
      }
    }

    // WebSocket upgrades
    if (req.headers.get("upgrade") === "websocket") {
      const success = server.upgrade(req);
      if (success) return undefined;
      return new Response("Upgrade failed", {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain",
        },
      });
    }

    // Everything else: 404
    return new Response("Not Found", {
      status: 404,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain",
      },
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
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Unknown message type",
              })
            );
        }
      } catch (error) {
        console.error("❌ Ошибка:", error);
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Internal server error",
          })
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
