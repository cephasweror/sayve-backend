import { Groq } from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { normalizeNigerianMarketNumbers } from './parser.service';

const TransactionItemSchema = z.object({
  type: z.enum(['income', 'expense', 'gain', 'loss']).nullable(),
  amount: z.number().nullable(),
  currency: z.literal('NGN').default('NGN'),
  category: z.string().nullable(),
  description: z.string(),
  date: z.string(), // YYYY-MM-DD
  business_name: z.string().nullable(),
});

const ParsedMessageSchema = z.object({
  needs_clarification: z.boolean(),
  clarification_question: z.string().nullable(),
  is_batch: z.boolean(),
  isSummaryQuery: z.boolean().default(false),
  queryPeriod: z.enum(['today', 'week', 'month']).optional(),
  isExportRequest: z.boolean().default(false),
  isCorrection: z.boolean().default(false),
  correctedCategory: z.string().optional(),
  items: z.array(TransactionItemSchema),
});

export type ParsedMessage = z.infer<typeof ParsedMessageSchema>;

export interface UserContext {
  businessName: string | null;
  knownCategories: string[];
}

export class LLMService {
  private geminiClient: GoogleGenerativeAI | null = null;
  private groqClient: Groq | null = null;

  constructor() {
    const rawGeminiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;
    const rawGroqKey = process.env.GROQ_API_KEY || env.GROQ_API_KEY;

    if (rawGeminiKey && rawGeminiKey !== 'mock_gemini_key' && !rawGeminiKey.includes('your_') && rawGeminiKey.length > 10) {
      this.geminiClient = new GoogleGenerativeAI(rawGeminiKey);
    }
    if (rawGroqKey && rawGroqKey !== 'mock_groq_key' && !rawGroqKey.includes('your_') && rawGroqKey.length > 10) {
      this.groqClient = new Groq({ apiKey: rawGroqKey });
    }
  }

  private async callOpenRouter(systemPrompt: string, userPrompt: string, isJson: boolean = true): Promise<string | null> {
    const apiKey = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY;
    if (!apiKey || apiKey === 'mock_openrouter_key' || apiKey.includes('your_') || apiKey.length < 10) {
      return null;
    }

    const primaryModel = process.env.OPENROUTER_MODEL || env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
    const models = Array.from(new Set([primaryModel, 'meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-lite-001:free', 'openrouter/auto']));

    for (const model of models) {
      try {
        const payload: any = {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
        };
        if (isJson) {
          payload.response_format = { type: 'json_object' };
        }

        const response = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          payload,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://sayve.app',
              'X-Title': 'Sayve WhatsApp Expense Tracker',
              'Content-Type': 'application/json',
            },
            timeout: 12000,
          }
        );

        const content = response.data?.choices?.[0]?.message?.content;
        if (content) {
          logger.info(`[AI] OpenRouter (${model}) succeeded`);
          return content;
        }
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 401) {
          logger.error(`[AI] OpenRouter 401 error: ${err.message}`);
          break;
        }
        logger.warn(`[AI] OpenRouter (${model}) failed: ${err.message}`);
      }
    }
    return null;
  }

  /**
   * Parse a raw WhatsApp message into a structured, validated
   * transaction using priority order: Gemini (Primary) -> Groq (Fallback) -> OpenRouter (Tertiary) -> Heuristic.
   */
  async parseMessage(rawText: string, ctx: UserContext): Promise<ParsedMessage> {
    const normalizedText = normalizeNigerianMarketNumbers(rawText);
    const systemPrompt = buildSystemPrompt(ctx);
    const today = new Date().toISOString().split('T')[0];
    const userPrompt = `today_date: ${today}\nis_batch: false\nmessage_text: "${normalizedText}"`;

    let isGeminiConfigError = false;

    // 1. Gemini (PRIMARY PROVIDER)
    if (this.geminiClient) {
      const geminiModel = process.env.GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
      try {
        const model = this.geminiClient.getGenerativeModel({
          model: geminiModel,
          generationConfig: { responseMimeType: 'application/json' },
        });
        const response = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
        const raw = response.response.text() || '';
        const parsed = safeParseAndValidate(raw);
        if (parsed) {
          logger.llm(`Gemini Primary (${geminiModel})`, userPrompt, raw);
          return parsed;
        }
      } catch (err: any) {
        const status = err?.status || err?.statusCode;
        if (status === 401 || status === 403 || status === 404) {
          isGeminiConfigError = true;
          logger.error(`[AI] Gemini Primary config error (${status}): ${err.message}`);
        } else {
          logger.warn(`[AI] Gemini Primary failed (${err.message}). Trying Groq fallback...`);
        }
      }
    } else {
      logger.info('Gemini API key not configured, going to Groq fallback');
    }

    // 2. Groq (SECONDARY FALLBACK PROVIDER)
    let isGroqConfigError = false;
    if (this.groqClient && !isGeminiConfigError) {
      const candidateModels = [
        process.env.GROQ_MODEL || env.GROQ_MODEL || 'groq/compound',
        'groq/compound',
        'groq/compound-mini',
        'qwen/qwen3.6-27b',
        'llama-3.1-8b-instant',
        'llama-3.3-70b-versatile',
      ];
      const uniqueModels = Array.from(new Set(candidateModels));

      for (const model of uniqueModels) {
        try {
          const completion = await this.groqClient.chat.completions.create({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            model,
            temperature: 0.1,
            response_format: { type: 'json_object' },
          });
          const raw = completion.choices[0]?.message?.content || '';
          const parsed = safeParseAndValidate(raw);
          if (parsed) {
            logger.llm(`Groq Fallback (${model})`, userPrompt, raw);
            return parsed;
          }
        } catch (err: any) {
          const status = err?.status || err?.statusCode;
          if (status === 401 || status === 403) {
            isGroqConfigError = true;
            logger.error(`[AI] Groq Fallback config error (${status}): ${err.message}`);
            break;
          }
          logger.warn(`[AI] Groq Fallback (${model}) parseMessage failed: ${err.message}`);
        }
      }
    }

    // 3. OpenRouter (TERTIARY FALLBACK PROVIDER)
    if (!isGeminiConfigError && !isGroqConfigError) {
      const openRouterRaw = await this.callOpenRouter(systemPrompt, userPrompt, true);
      if (openRouterRaw) {
        const parsed = safeParseAndValidate(openRouterRaw);
        if (parsed) {
          logger.llm('OpenRouter Fallback', userPrompt, openRouterRaw);
          return parsed;
        }
      }
    }

    // 4. Heuristic Fallback
    logger.info('[AI] All AI providers unavailable or failed — using heuristic fallback');
    return heuristicFallback(normalizedText, today, ctx);
  }

  /**
   * Conversational reply generation with priority: Gemini (Primary) -> Groq (Fallback) -> OpenRouter (Tertiary) -> Fallback text
   */
  async generateCompletion(prompt: string, systemPrompt?: string): Promise<string> {
    const fullUserPrompt = prompt;

    // 1. Gemini Primary
    if (this.geminiClient) {
      try {
        const geminiModel = process.env.GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
        const model = this.geminiClient.getGenerativeModel({ model: geminiModel });
        const textToPass = `${systemPrompt ? systemPrompt + '\n\n' : ''}${fullUserPrompt}`;
        const response = await model.generateContent(textToPass);
        const raw = response.response.text() || '';
        if (raw) {
          logger.llm(`Gemini Primary (${geminiModel}) reply`, prompt, raw);
          return raw;
        }
      } catch (err: any) {
        logger.warn('Gemini Primary reply generation failed:', err.message);
      }
    }

    // 2. Groq Fallback
    if (this.groqClient) {
      const candidateModels = [
        process.env.GROQ_MODEL || env.GROQ_MODEL || 'groq/compound',
        'groq/compound',
        'llama-3.1-8b-instant',
      ];
      for (const model of Array.from(new Set(candidateModels))) {
        try {
          const completion = await this.groqClient.chat.completions.create({
            messages: [
              ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
              { role: 'user' as const, content: fullUserPrompt },
            ],
            model,
            temperature: 0.7,
          });
          const raw = completion.choices[0]?.message?.content || '';
          if (raw) {
            logger.llm(`Groq Fallback (${model}) reply`, prompt, raw);
            return raw;
          }
        } catch (err: any) {
          logger.warn(`Groq Fallback reply generation failed (${model}):`, err.message);
        }
      }
    }

    // 3. OpenRouter Tertiary
    const openRouterReply = await this.callOpenRouter(
      systemPrompt || 'You are Sayve, a helpful WhatsApp financial assistant.',
      fullUserPrompt,
      false
    );
    if (openRouterReply) {
      return openRouterReply;
    }

    // 4. Fallback Text
    logger.warn('All LLM providers failed — returning default reply text');
    return "Got it — noted. (I'm having trouble phrasing this nicely right now, but your entry was saved.)";
  }
}

function safeParseAndValidate(raw: string): ParsedMessage | null {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const json = JSON.parse(cleaned);
    return ParsedMessageSchema.parse(json);
  } catch {
    return null;
  }
}

function buildSystemPrompt(ctx: UserContext): string {
  return `You are Sayve, a bookkeeping assistant for Nigerian small business owners using WhatsApp. Turn informal messages into structured financial records. Ask a clarifying question whenever something important is missing or ambiguous — never guess silently on anything that affects the numbers in a report.

CONTEXT:
business_name: ${ctx.businessName ?? 'null (not set — must ask before saving)'}
known_categories: ${ctx.knownCategories.length ? ctx.knownCategories.join(', ') : 'none yet'}

TASKS, IN ORDER:
1. TYPE — classify as income, expense, gain, or loss. If unclear (e.g. "600000 fuel" with no verb), set needs_clarification true and ask "Is this money coming in or going out?". Recognize local phrasing without asking: sold/received/customer paid -> income; bought/spent on/paid for -> expense; profit from/dash/bonus -> gain; lost/spoilt/damaged/stolen/wrote off -> loss.
2. AMOUNT — numbers arrive pre-normalized (1k -> 1000, 600k -> 600000). If missing, ask. If several numbers appear, use the total transaction amount; put quantities/units in description.
3. CATEGORY — match known_categories first (fuzzy: fuel/petrol/diesel may be one category). If nothing matches and it's not obvious, ask "What category should I file this under?".
4. PERIOD — look for explicit date words ("yesterday", "last Monday"). If none, default to today_date; do not ask about period for ordinary single messages. Only ask for period on a clearly ambiguous backlog dump.
5. BUSINESS — if business_name is null, always ask "Which business is this for?". If set, attach it silently.
6. BATCH (is_batch true) — extract every line item into items[]. Don't ask type/period per item; group by type if types clearly differ, otherwise ask once for the whole batch. Always return the extracted list for user confirmation.

Respond ONLY with valid JSON matching this shape, no preamble, no markdown fences:
{
  "needs_clarification": boolean,
  "clarification_question": string | null,
  "is_batch": boolean,
  "isSummaryQuery": boolean,
  "queryPeriod": "today" | "week" | "month" | null,
  "isExportRequest": boolean,
  "isCorrection": boolean,
  "correctedCategory": string | null,
  "items": [
    {
      "type": "income" | "expense" | "gain" | "loss" | null,
      "amount": number | null,
      "currency": "NGN",
      "category": string | null,
      "description": string,
      "date": "YYYY-MM-DD",
      "business_name": string | null
    }
  ]
}

Never invent a business name, category, or amount. When unsure, ask one short, specific, conversational question — this is WhatsApp, not a form.`;
}

function heuristicFallback(text: string, today: string, ctx: UserContext): ParsedMessage {
  const lower = text.toLowerCase().trim();

  // Summary queries
  if (
    lower.includes('how much') || lower.includes('summary') ||
    lower.includes('spent this month') || lower.includes('expenses this month') ||
    lower.includes('made this week') || lower.includes('made today') ||
    lower.includes('income today') || lower.includes('profit this')
  ) {
    let queryPeriod: 'today' | 'week' | 'month' = 'month';
    if (lower.includes('week')) queryPeriod = 'week';
    else if (lower.includes('today')) queryPeriod = 'today';
    return ParsedMessageSchema.parse({
      needs_clarification: false, clarification_question: null, is_batch: false,
      isSummaryQuery: true, queryPeriod, isExportRequest: false, isCorrection: false, items: [],
    });
  }

  // Export requests
  if (['export', 'csv', 'cvs', 'report', 'excel', 'download', 'spreadsheet', 'pdf', 'image'].some(k => lower.includes(k))) {
    return ParsedMessageSchema.parse({
      needs_clarification: false, clarification_question: null, is_batch: false,
      isSummaryQuery: false, isExportRequest: true, isCorrection: false, items: [],
    });
  }

  // Corrections
  if (lower.startsWith('no,') || lower.includes("it's") || lower.includes('change category')) {
    const categoryMap: [string, string][] = [
      ['rent', 'Rent'], ['sales', 'Sales'], ['sale', 'Sales'], ['transport', 'Transport'],
      ['inventory', 'Inventory'], ['stock', 'Inventory'], ['salary', 'Salaries'],
      ['salaries', 'Salaries'], ['utility', 'Utilities'], ['bill', 'Utilities'], ['nepa', 'Utilities'],
    ];
    const match = categoryMap.find(([kw]) => lower.includes(kw));
    return ParsedMessageSchema.parse({
      needs_clarification: false, clarification_question: null, is_batch: false,
      isSummaryQuery: false, isExportRequest: false, isCorrection: true,
      correctedCategory: match ? match[1] : 'Other', items: [],
    });
  }

  // Transaction parsing
  const isIncome = ['sold', 'sale', 'received', 'paid me', 'alert', 'cash enter', 'made', 'earn', 'earned', 'collect'].some(k => lower.includes(k));
  const isExpense = ['spent', 'bought', 'paid for', 'chop money', 'expense'].some(k => lower.includes(k));
  const isGain = ['profit', 'dash', 'bonus', 'gain'].some(k => lower.includes(k));
  const isLoss = ['loss', 'lost', 'spoilt', 'damaged', 'stolen', 'spill', 'wrote off'].some(k => lower.includes(k));

  let type: 'income' | 'expense' | 'gain' | 'loss' | null = null;
  if (isLoss) type = 'loss';
  else if (isGain) type = 'gain';
  else if (isExpense) type = 'expense';
  else if (isIncome) type = 'income';

  const numbers = text.match(/\d+[\d,]*/g);
  const amount = numbers?.length ? Math.max(...numbers.map(n => parseInt(n.replace(/,/g, ''), 10))) : null;

  if (!type && amount !== null) {
    return ParsedMessageSchema.parse({
      needs_clarification: true,
      clarification_question: 'Is this money coming in or going out?',
      is_batch: false, isSummaryQuery: false, isExportRequest: false, isCorrection: false,
      items: [{ type: null, amount, currency: 'NGN', category: null, description: text, date: today, business_name: ctx.businessName }],
    });
  }

  if (!type || amount === null) {
    return ParsedMessageSchema.parse({
      needs_clarification: true,
      clarification_question: !type ? 'Is this money coming in or going out?' : 'How much was this for?',
      is_batch: false, isSummaryQuery: false, isExportRequest: false, isCorrection: false,
      items: [{ type, amount, currency: 'NGN', category: null, description: text, date: today, business_name: ctx.businessName }],
    });
  }

  const categoryMap: [string, string][] = [
    ['transport', 'Transport'], ['bus', 'Transport'], ['okada', 'Transport'], ['cab', 'Transport'],
    ['fuel', 'Fuel'], ['petrol', 'Fuel'], ['diesel', 'Fuel'], ['gen', 'Fuel'],
    ['sold', 'Sales'], ['sales', 'Sales'], ['rice', 'Sales'],
    ['stock', 'Inventory'], ['goods', 'Inventory'], ['bag', 'Inventory'],
    ['light', 'Utilities'], ['nepa', 'Utilities'], ['water', 'Utilities'],
    ['rent', 'Rent'], ['shop', 'Rent'],
    ['salary', 'Salaries'], ['staff', 'Salaries'],
  ];
  const categoryMatch = categoryMap.find(([kw]) => lower.includes(kw));

  return ParsedMessageSchema.parse({
    needs_clarification: false, clarification_question: null, is_batch: false,
    isSummaryQuery: false, isExportRequest: false, isCorrection: false,
    items: [{
      type, amount, currency: 'NGN',
      category: categoryMatch ? categoryMatch[1] : 'Other',
      description: text.substring(0, 100), date: today, business_name: ctx.businessName,
    }],
  });
}

export const llmService = new LLMService();