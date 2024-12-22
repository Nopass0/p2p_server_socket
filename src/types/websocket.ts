import type { ServerWebSocket } from "bun";
import type { DeviceInfo } from "@/types/messages";

export interface ConnectionData {
  userId: number;
  deviceToken: string;
  device_info: DeviceInfo;
  sessionId: number;
  geminiToken?: string | null;
  currentWindow?: {
    name: string;
    startTime: Date;
    logId: number;
  };
}

export interface MyWebSocket extends ServerWebSocket<ConnectionData> {}
