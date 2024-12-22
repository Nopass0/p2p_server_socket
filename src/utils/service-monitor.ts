// src/utils/service-monitor.ts
export class ServiceMonitor {
  private stats: Map<string, ServiceStats> = new Map();

  initializeStats(serviceName: string): void {
    this.stats.set(serviceName, {
      processedUsers: 0,
      processedTransactions: 0,
      errors: 0,
      lastRunTime: new Date(),
      isRunning: false,
    });
  }

  updateStats(serviceName: string, update: Partial<ServiceStats>): void {
    const currentStats = this.stats.get(serviceName);
    if (currentStats) {
      this.stats.set(serviceName, { ...currentStats, ...update });
    }
  }

  getStats(serviceName: string): ServiceStats | undefined {
    return this.stats.get(serviceName);
  }

  getAllStats(): Map<string, ServiceStats> {
    return this.stats;
  }

  logStats(serviceName: string): void {
    const stats = this.stats.get(serviceName);
    if (stats) {
      console.log(`📊 ${serviceName} Stats:`, {
        processedUsers: stats.processedUsers,
        processedTransactions: stats.processedTransactions,
        errors: stats.errors,
        lastRunTime: stats.lastRunTime,
        isRunning: stats.isRunning,
      });
    }
  }
}
