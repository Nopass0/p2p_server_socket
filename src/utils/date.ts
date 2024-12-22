export function formatDate(date: Date): string {
  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function getDurationInSeconds(startTime: Date): number {
  return Math.floor((Date.now() - startTime.getTime()) / 1000);
}
