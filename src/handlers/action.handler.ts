import type { MyWebSocket } from "@/types/websocket";
import type { ActionMessage } from "@/types/messages";
import { connectionStore } from "@/store/connections";
import { formatDate, getDurationInSeconds } from "@/utils/date";
import { validateActionMessage } from "@/utils/validation";
import { sendTelegramMessage } from "@/services/telegram";
import db from "@/db";

export async function handleAction(ws: MyWebSocket, message: ActionMessage) {
  if (!ws.data) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Not authenticated",
      }),
    );
    return;
  }

  if (!validateActionMessage(message)) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Invalid message format",
      }),
    );
    return;
  }

  const deviceToken = await db.deviceToken.findUnique({
    where: { token: ws.data.deviceToken },
  });

  if (!deviceToken) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Device token not found",
      }),
    );
    return;
  }

  // Закрываем предыдущее окно, если оно было
  const connectionData = connectionStore.get(ws);
  if (connectionData?.currentWindow) {
    const duration = getDurationInSeconds(
      connectionData.currentWindow.startTime,
    );

    await db.userActivityLog.update({
      where: { id: connectionData.currentWindow.logId },
      data: {
        endTime: new Date(),
        duration,
      },
    });
  }

  // Создаем новую запись активности
  const activityLog = await db.userActivityLog.create({
    data: {
      userId: ws.data.userId,
      deviceId: deviceToken.id,
      windowName: message.window_name,
      action: message.action,
      startTime: new Date(),
      url: message.url,
      metadata: {
        ...message.metadata,
        deviceInfo: message.device_info,
      },
    },
  });

  // Обновляем информацию о текущем окне
  if (message.action === "window_open" && ws.data) {
    const newData = {
      ...ws.data,
      currentWindow: {
        name: message.window_name,
        startTime: new Date(),
        logId: activityLog.id,
      },
    };
    connectionStore.add(ws, newData);
  }

  ws.send(
    JSON.stringify({
      type: "action_response",
      success: true,
    }),
  );

  // Отправляем уведомление в Telegram
  if (process.env.NODE_ENV === "development") {
    const user = await db.user.findUnique({
      where: { id: ws.data.userId },
    });

    if (user) {
      await sendTelegramMessage(
        user.telegramId,
        `🔄 Действие пользователя\n\n` +
          `👤 Пользователь: ${user.firstName}\n` +
          `📝 Действие: ${message.action}\n` +
          `🖼️ Окно: ${message.window_name}\n` +
          `🔗 URL: ${message.url || "N/A"}\n` +
          `⏰ Время: ${formatDate(new Date())}`,
      );
    }
  }
}
