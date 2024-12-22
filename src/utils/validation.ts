import type { ActionMessage, ScreenshotMessage } from "@/types/messages";

export function validateActionMessage(message: ActionMessage): boolean {
  return (
    typeof message.url === "string" &&
    typeof message.action === "string" &&
    typeof message.window_name === "string" &&
    message.device_info &&
    typeof message.device_info.app_name === "string" &&
    typeof message.device_info.app_version === "string" &&
    typeof message.device_info.os_info === "string"
  );
}

export function validateScreenshotMessage(message: ScreenshotMessage): boolean {
  return (
    typeof message.data === "string" &&
    message.data.startsWith("data:image/png;base64,") &&
    message.metadata &&
    typeof message.metadata.width === "number" &&
    typeof message.metadata.height === "number" &&
    typeof message.metadata.timestamp === "number"
  );
}
