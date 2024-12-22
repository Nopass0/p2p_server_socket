export interface DeviceInfo {
  app_name: string;
  app_version: string;
  os_info: string;
}

export interface AuthMessage {
  type: "auth";
  token: string;
  device_info: DeviceInfo;
}

export interface ActionMessage {
  type: "action";
  url: string;
  action: string;
  device_info: DeviceInfo;
  window_name: string;
  metadata?: any;
}

export interface ScreenshotMessage {
  type: "screenshot";
  data: string;
  metadata: {
    width: number;
    height: number;
    timestamp: number;
  };
}

export type Message = AuthMessage | ActionMessage | ScreenshotMessage | { type: string; [key: string]: any };
