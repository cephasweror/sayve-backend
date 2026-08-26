export const logger = {
  info: (message: string, ...meta: any[]) => {
    console.log(`[INFO] [${new Date().toISOString()}] ${message}`, ...meta);
  },
  warn: (message: string, ...meta: any[]) => {
    console.warn(`[WARN] [${new Date().toISOString()}] ${message}`, ...meta);
  },
  error: (message: string, ...meta: any[]) => {
    console.error(`[ERROR] [${new Date().toISOString()}] ${message}`, ...meta);
  },
  llm: (provider: string, prompt: string, output: string) => {
    console.log(`\n🤖 --- [LLM LOG: ${provider}] ---`);
    console.log(`Prompt snippet: ${prompt.substring(0, 150)}...`);
    console.log(`Raw output: ${output}`);
    console.log(`-------------------------------\n`);
  }
};
