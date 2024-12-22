import path from "path";
import { mkdir } from "fs/promises";
import db from "../db";

export async function saveScreenshot(
  userId: number,
  deviceId: number,
  imageData: Buffer,
  metadata: any,
): Promise<string> {
  const screenshotsDir = path.join(
    process.cwd(),
    "screenshots",
    userId.toString(),
  );
  await mkdir(screenshotsDir, { recursive: true });

  const fileName = `screenshot_${Date.now()}.png`;
  const filePath = path.join(screenshotsDir, fileName);

  await Bun.write(filePath, imageData);

  await db.screenshot.create({
    data: {
      userId,
      deviceId,
      filePath,
      fileSize: imageData.length,
      width: metadata.width,
      height: metadata.height,
      createdAt: new Date(metadata.timestamp * 1000),
      metadata,
    },
  });

  return filePath;
}
