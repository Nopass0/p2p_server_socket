export async function sendTelegramMessage(chatId: string, message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
  }
}

export async function sendTelegramPhoto(
  chatId: string,
  photoPath: string,
  caption: string,
) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", Bun.file(photoPath));
    form.append("caption", caption);

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendPhoto`,
      {
        method: "POST",
        body: form,
      },
    );

    if (!response.ok) {
      console.error(
        "Telegram API error:",
        response.status,
        response.statusText,
      );
      const errorData = await response.text();
      console.error("Error details:", errorData);
    }
  } catch (error) {
    console.error("Failed to send Telegram photo:", error);
  }
}
