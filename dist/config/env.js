"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    PORT: zod_1.z.string().default('3000'),
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    WHATSAPP_TOKEN: zod_1.z.string().default('mock_whatsapp_token'),
    PHONE_NUMBER_ID: zod_1.z.string().default('mock_phone_number_id'),
    WHATSAPP_VERIFY_TOKEN: zod_1.z.string().default('sayve_webhook_secret_token'),
    GROQ_API_KEY: zod_1.z.string().default('mock_groq_key'),
    GEMINI_API_KEY: zod_1.z.string().default('mock_gemini_key'),
    MONGODB_URI: zod_1.z.string().default('mongodb://127.0.0.1:27017/sayve_db'),
});
const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
    console.error('❌ Invalid environment variables:', parsedEnv.error.format());
}
exports.env = parsedEnv.success
    ? parsedEnv.data
    : envSchema.parse({
        PORT: process.env.PORT || '3000',
        NODE_ENV: process.env.NODE_ENV || 'development',
        WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || 'mock_whatsapp_token',
        PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || 'mock_phone_number_id',
        WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || 'sayve_webhook_secret_token',
        GROQ_API_KEY: process.env.GROQ_API_KEY || 'mock_groq_key',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'mock_gemini_key',
        MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sayve_db',
    });
