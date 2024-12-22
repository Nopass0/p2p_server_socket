// src/services/gemini.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AutomationAction } from "../types/automation";
import { P2PTransactionData } from "../types/transaction";

interface GeminiAnalysisResult {
  type: "automation" | "transaction";
  data: AutomationAction | P2PTransactionData;
}

const TELEGRAM_ANALYZE_PROMPT = `Analyze the provided Telegram screenshot.
Please identify UI elements and return one of two results:

1. For automation guidance:
- Identify clickable elements like menu button (3 lines), wallet button, P2P market button
- Find transaction list items and scroll areas
- Return click coordinates and any required delays for proper UI interaction

2. For transaction details:
- Find and extract transaction ID (#OS-XXXXXXXX)
- Status (Completed/Failed)
- Amount in USDT
- Total in RUB
- Price per USDT
- Buyer name
- Payment method
- Trade statistics
- Completion date/time

Return the data in this JSON format:
{
  "type": "automation" | "transaction",
  "data": {
    // For automation:
    "type": "click" | "scroll" | "wait" | "back",
    "x": number, // for clicks
    "y": number, // for clicks
    "amount": number, // for scrolls
    "delay": number // delay after action in ms

    // For transaction:
    "telegramId": string,
    "status": string,
    "amount": number,
    "totalRub": number,
    "price": number,
    "buyerName": string,
    "method": string,
    "tradeStats": string,
    "completedAt": string
  }
}`;

export class GeminiService {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async analyzeScreenshot(imagePath: string): Promise<GeminiAnalysisResult> {
    const model = this.genAI.getGenerativeModel({ model: "gemini-pro-vision" });

    try {
      const response = await model.generateContent([
        TELEGRAM_ANALYZE_PROMPT,
        {
          inlineData: {
            data: await this.imageToBase64(imagePath),
            mimeType: "image/png",
          },
        },
      ]);

      const textResult = response.response.text();
      return JSON.parse(textResult);
    } catch (error) {
      console.error("Gemini analysis failed:", error);
      throw error;
    }
  }

  private async imageToBase64(imagePath: string): Promise<string> {
    const imageBuffer = await Bun.file(imagePath).arrayBuffer();
    return Buffer.from(imageBuffer).toString("base64");
  }
}
