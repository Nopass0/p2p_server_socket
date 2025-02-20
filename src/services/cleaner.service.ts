import { BaseService } from "./base.service";
import { ServiceMonitor } from "../utils/service-monitor";
import { PrismaClient } from "@prisma/client";

export class CleanerService extends BaseService {
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
  private intervalId: NodeJS.Timeout | null = null;
  private db: PrismaClient;

  constructor(monitor: ServiceMonitor) {
    super("CleanerService", monitor);
    this.db = new PrismaClient();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log("🧹 Starting CleanerService");
    
    // Initial cleanup
    await this.cleanupCookies();
    
    // Set up periodic cleanup
    this.intervalId = setInterval(async () => {
      await this.cleanupCookies();
    }, this.CLEANUP_INTERVAL);
  }

  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log("🛑 Stopping CleanerService");
  }

  private async cleanupCookies(): Promise<void> {
    try {
      const result = await this.db.gateCookie.deleteMany({
        where: {
          isActive: false
        }
      });

      this.updateServiceStats({
        processed: result.count,
        total: result.count,
        errors: 0
      });

      console.log(`🧹 Cleaned up ${result.count} inactive cookies`);
    } catch (error) {
      console.error("Error cleaning up cookies:", error);
      this.updateServiceStats({
        errors: 1
      });
    }
  }
}