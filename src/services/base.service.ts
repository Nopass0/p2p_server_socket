// src/services/base.service.ts
import { ServiceMonitor } from "../utils/service-monitor";
import type { ServiceStats } from "../types/services";

export abstract class BaseService {
  protected isRunning = false;
  protected monitor: ServiceMonitor;
  protected serviceName: string;

  constructor(serviceName: string, monitor: ServiceMonitor) {
    this.serviceName = serviceName;
    this.monitor = monitor;
    this.monitor.initializeStats(this.serviceName);
  }

  protected updateServiceStats(stats: Partial<ServiceStats>): void {
    this.monitor.updateStats(this.serviceName, stats);
  }

  protected async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  abstract start(): Promise<void>;
  abstract stop(): void;
}
