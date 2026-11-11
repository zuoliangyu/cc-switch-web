interface MessageOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
}

export async function message(
  text: string,
  options?: MessageOptions,
): Promise<void> {
  if (typeof window !== "undefined") {
    const title = options?.title ? `${options.title}\n\n` : "";
    window.alert(`${title}${text}`);
  }
}
