// src/utils/receipts.ts
import prisma from "@/db";
import { join } from "path";

export async function getReceiptPath(receiptId: number): Promise<string> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
  });

  if (!receipt) {
    throw new Error("Receipt not found");
  }

  return join(process.cwd(), receipt.filePath);
}
