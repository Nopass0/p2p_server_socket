import { describe, test, expect } from "bun:test";
import process from "process";
import { generateText } from "@/services/gemini";

describe("generateText", () => {
  // Увеличиваем таймаут для всех тестов
  const TEST_TIMEOUT = 15000;

  // Проверяем текстовый ответ
  test(
    "should return a string for a text prompt",
    async () => {
      const response = await generateText(process.env.GEMINI_TEST_TOKEN!, {
        prompt: "Say hello",
      });
      expect(typeof response === "string").toBe(true);
    },
    TEST_TIMEOUT,
  );

  // Проверяем JSON ответ
  test(
    "should return a JSON object matching the expected structure",
    async () => {
      interface ExpectedResponse {
        greeting: string;
      }

      const response = await generateText<ExpectedResponse>(
        process.env.GEMINI_TEST_TOKEN!,
        {
          prompt:
            'Return only this exact JSON without any markdown or extra text: {"greeting": "Hello"}',
          responseType: {} as ExpectedResponse,
        },
      );

      expect(response).toBeTypeOf("object");
      if (typeof response === "object" && response !== null) {
        expect("greeting" in response).toBe(true);
        const typedResponse = response as ExpectedResponse;
        expect(typeof typedResponse.greeting).toBe("string");
      }
    },
    TEST_TIMEOUT,
  );

  // Проверяем обработку ошибок при неверном JSON
  test(
    "should handle invalid JSON response gracefully",
    async () => {
      interface ExpectedResponse {
        greeting: string;
      }

      const response = await generateText<ExpectedResponse>(
        process.env.GEMINI_TEST_TOKEN!,
        {
          prompt: "Say hello (not in JSON format)",
          responseType: {} as ExpectedResponse,
        },
      );

      expect(typeof response === "string").toBe(true);
    },
    TEST_TIMEOUT,
  );

  // Проверяем параметры конфигурации
  test(
    "should respect maxTokens and temperature parameters",
    async () => {
      const response = await generateText(process.env.GEMINI_TEST_TOKEN!, {
        prompt: "Write a short story",
        maxTokens: 100,
        temperature: 0.8,
      });

      expect(typeof response === "string").toBe(true);
      // Проверяем, что ответ не слишком длинный (примерно)
      expect((response as string).length).toBeLessThan(500);
    },
    TEST_TIMEOUT,
  );
});
