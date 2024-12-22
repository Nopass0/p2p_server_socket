import type { MyWebSocket } from "../types/websocket";
import type { AuthMessage } from "../types/messages";
import { connectionStore } from "../store/connections";
import { formatDate } from "@/utils/date";
import { sendTelegramMessage } from "../services/telegram";
import "@prisma/client";
import db from "@/db";

export async function handleAuth(ws: MyWebSocket, message: AuthMessage) {
  const deviceToken = await db.deviceToken.findUnique({
    where: { token: message.token },
    include: { User: true },
  });

  if (!deviceToken) {
    ws.send(
      JSON.stringify({
        type: "auth_response",
        success: false,
        error: "Invalid token",
      }),
    );
    return;
  }

  if (!deviceToken.User) {
    ws.send(
      JSON.stringify({
        type: "auth_response",
        success: false,
        error: "User not found",
      }),
    );
    return;
  }

  const session = await db.userSession.create({
    data: {
      userId: deviceToken.userId,
      deviceId: deviceToken.id,
      //@ts-ignore
      metadata: {
        deviceInfo: message.device_info,
        timestamp: new Date().toISOString(),
      },
    },
  });

  ws.data = {
    userId: deviceToken.userId,
    deviceToken: message.token,
    device_info: message.device_info,
    sessionId: session.id,
    //@ts-ignore
    geminiToken: deviceToken.User?.geminiToken,
  };

  connectionStore.add(ws, ws.data);

  await db.deviceToken.update({
    where: { id: deviceToken.id },
    data: { lastUsed: new Date() },
  });

  ws.send(
    JSON.stringify({
      type: "auth_response",
      success: true,
      user: {
        id: deviceToken.User.id,
        firstName: deviceToken.User.firstName,
        telegramId: deviceToken.User.telegramId,
      },
    }),
  );

  if (process.env.NODE_ENV === "development") {
    await sendTelegramMessage(
      deviceToken.User.telegramId,
      `🔐 Новый вход в систему\n\n` +
        `👤 Пользователь: ${deviceToken.User.firstName}\n` +
        `💻 Устройство: ${deviceToken.name || "Неизвестное устройство"}\n` +
        `🖥️ ОС: ${message.device_info.os_info}\n` +
        `⏰ Время: ${formatDate(new Date())}`,
    );
  }
}
