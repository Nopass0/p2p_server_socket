import { PrismaClient } from '@prisma/client';
import { WebSocket } from 'bun';
import * as path from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();

interface StreamClient {
  ws: WebSocket;
  userId: number;
}

class StreamManager {
  private clients: Map<number, StreamClient> = new Map();
  private checkInterval: number = 5000; // 5 seconds
  private cleanupInterval: number = 24 * 60 * 60 * 1000; // 24 hours
  private intervalId: NodeJS.Timeout | null = null;
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.startChecking();
    this.startCleanup();
  }

  public addClient(userId: number, ws: WebSocket) {
    this.clients.set(userId, { ws, userId });
  }

  public removeClient(userId: number) {
    this.clients.delete(userId);
  }

  private async checkWorkTimes() {
    try {
      // Проверяем активные рабочие времена без трансляций
      const activeWorkTimes = await prisma.workTime.findMany({
        where: {
          isActive: true,
          endTime: null,
          Stream: null
        },
        include: {
          Stream: true
        }
      });

      // Запускаем трансляции для новых рабочих времен
      for (const workTime of activeWorkTimes) {
        const client = this.clients.get(workTime.userId);
        if (client) {
          client.ws.send(JSON.stringify({
            type: 'start-stream',
            workTimeId: workTime.id
          }));
        }
      }

      // Проверяем завершенные рабочие времена с активными трансляциями
      const completedWorkTimes = await prisma.workTime.findMany({
        where: {
          isActive: true,
          endTime: { not: null },
          Stream: {
            isActive: true
          }
        },
        include: {
          Stream: true
        }
      });

      // Останавливаем трансляции для завершенных рабочих времен
      for (const workTime of completedWorkTimes) {
        const client = this.clients.get(workTime.userId);
        if (client) {
          client.ws.send(JSON.stringify({
            type: 'stop-stream'
          }));
        }

        if (workTime.Stream) {
          await prisma.stream.update({
            where: { id: workTime.Stream.id },
            data: {
              isActive: false,
              endTime: workTime.endTime
            }
          });
        }
      }
    } catch (error) {
      console.error('Error checking work times:', error);
    }
  }

  private async cleanupOldRecords() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Получаем старые записи
      const oldStreams = await prisma.stream.findMany({
        where: {
          startTime: {
            lt: thirtyDaysAgo
          }
        }
      });

      // Удаляем файлы и записи в БД
      for (const stream of oldStreams) {
        const filePath = stream.filePath;
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }

        await prisma.stream.delete({
          where: { id: stream.id }
        });
      }
    } catch (error) {
      console.error('Error cleaning up old records:', error);
    }
  }

  private startChecking() {
    this.intervalId = setInterval(() => this.checkWorkTimes(), this.checkInterval);
  }

  private startCleanup() {
    this.cleanupIntervalId = setInterval(() => this.cleanupOldRecords(), this.cleanupInterval);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }
  }
}

export const streamManager = new StreamManager();
