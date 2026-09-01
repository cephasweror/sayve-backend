import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  WHATSAPP_TOKEN: z.string().default('mock_whatsapp_token'),
  PHONE_NUMBER_ID: z.string().default('mock_phone_number_id'),
  WHATSAPP_VERIFY_TOKEN: z.string().default('sayve_webhook_secret_token'),
  GROQ_API_KEY: z.string().default('mock_groq_key'),
  GROQ_MODEL: z.string().default('groq/compound'),
  GEMINI_API_KEY: z.string().default('mock_gemini_key'),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash-lite'),
  OPENROUTER_API_KEY: z.string().default('mock_openrouter_key'),
  OPENROUTER_MODEL: z.string().default('meta-llama/llama-3.3-70b-instruct:free'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/sayve_db'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
}

export const env = parsedEnv.success
  ? parsedEnv.data
  : envSchema.parse({
      PORT: process.env.PORT || '3000',
      NODE_ENV: process.env.NODE_ENV || 'development',
      WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || 'mock_whatsapp_token',
      PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || 'mock_phone_number_id',
      WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || 'sayve_webhook_secret_token',
      GROQ_API_KEY: process.env.GROQ_API_KEY || 'mock_groq_key',
      GROQ_MODEL: process.env.GROQ_MODEL || 'groq/compound',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'mock_gemini_key',
      GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || 'mock_openrouter_key',
      OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sayve_db',
    });
