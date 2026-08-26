"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.logger = {
    info: (message, ...meta) => {
        console.log(`[INFO] [${new Date().toISOString()}] ${message}`, ...meta);
    },
    warn: (message, ...meta) => {
        console.warn(`[WARN] [${new Date().toISOString()}] ${message}`, ...meta);
    },
    error: (message, ...meta) => {
        console.error(`[ERROR] [${new Date().toISOString()}] ${message}`, ...meta);
    },
    llm: (provider, prompt, output) => {
        console.log(`\n🤖 --- [LLM LOG: ${provider}] ---`);
        console.log(`Prompt snippet: ${prompt.substring(0, 150)}...`);
        console.log(`Raw output: ${output}`);
        console.log(`-------------------------------\n`);
    }
};
