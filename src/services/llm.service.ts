import { Groq } from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { normalizeNigerianMarketNumbers } from './parser.service';

// ─────────────────────────────────────────────────────────────
// Output schema — every LLM response (Groq, Gemini, or the local
// fallback) is validated against this before anything downstream
// trusts it. If it doesn't match, we treat it as a failed call.
// ─────────────────────────────────────────────────────────────
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
  private groqClient: Groq | null = null;
  private geminiClient: GoogleGenerativeAI | null = null;

  constructor() {
    if (env.GROQ_API_KEY && env.GROQ_API_KEY !== 'mock_groq_key') {
      this.groqClient = new Groq({ apiKey: env.GROQ_API_KEY });
    }
    if (env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'mock_gemini_key') {
      this.geminiClient = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
  }

  /**
   * Parse a raw WhatsApp message into a structured, validated
   * transaction. Number shorthand is normalized ONCE, up front, so
   * Groq, Gemini, and the last-resort fallback all see the same
   * clean input — this was silently skipped before for both real
   * LLM calls.
   */
  async parseMessage(rawText: string, ctx: UserContext): Promise<ParsedMessage> {
    const normalizedText = normalizeNigerianMarketNumbers(rawText);
    const systemPrompt = buildSystemPrompt(ctx);
    const today = new Date().toISOString().split('T')[0];
    const userPrompt = `today_date: ${today}\nis_batch: false\nmessage_text: "${normalizedText}"`;

    // 1. Groq — primary. One retry with backoff on rate limits/transient errors.
    if (this.groqClient) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const completion = await this.groqClient.chat.completions.create({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' },
          });
          const raw = completion.choices[0]?.message?.content || '';
          const parsed = safeParseAndValidate(raw);
          if (parsed) {
            logger.llm('Groq Llama 3.3 70B', userPrompt, raw);
            return parsed;
          }
          logger.warn(`Groq returned invalid/unvalidatable JSON on attempt ${attempt + 1}`);
        } catch (err: any) {
          logger.warn(`Groq call failed (attempt ${attempt + 1}):`, err.message);
          if (err.status === 429) await sleep(500 * (attempt + 1));
        }
      }
    } else {
      logger.info('Groq API key not configured, going straight to Gemini');
    }

    // 2. Gemini — fallback, JSON mode forced via generationConfig so we're
    // not hoping the model remembers to skip markdown fences / prose.
    if (this.geminiClient) {
      try {
        const model = this.geminiClient.getGenerativeModel({
          model: 'gemini-1.5-flash',
          generationConfig: { responseMimeType: 'application/json' },
        });
        const response = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
        const raw = response.response.text() || '';
        const parsed = safeParseAndValidate(raw);
        if (parsed) {
          logger.llm('Gemini 2.5 Flash', userPrompt, raw);
          return parsed;
        }
        logger.warn('Gemini returned invalid/unvalidatable JSON');
      } catch (err: any) {
        logger.warn('Gemini call failed:', err.message);
      }
    }

    // 3. Last resort ONLY — both providers unreachable or misconfigured.
    // Deliberately conservative: when unsure of direction, it asks rather
    // than guesses, same as the LLM system prompt does. This should be
    // rare in production if retries/backoff above are working; if you see
    // this path firing often, that's a signal to fix upstream reliability,
    // not to make the keyword list smarter.
    logger.warn('Both LLM providers failed — using heuristic fallback');
    return heuristicFallback(normalizedText, today, ctx);
  }

  /**
   * Free-text generation — used by reply.service.ts to write the
   * conversational WhatsApp reply (NOT structured JSON). Same
   * Groq-primary/Gemini-fallback order as parseMessage, but no JSON
   * mode and no schema validation, since the output here is just text.
   */
  async generateCompletion(prompt: string, systemPrompt?: string): Promise<string> {
    if (this.groqClient) {
      try {
        const completion = await this.groqClient.chat.completions.create({
          messages: [
            ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
            { role: 'user' as const, content: prompt },
          ],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.7, // higher than the parser — replies should feel natural, not deterministic
        });
        const raw = completion.choices[0]?.message?.content || '';
        if (raw) {
          logger.llm('Groq Llama 3.3 70B (reply)', prompt, raw);
          return raw;
        }
      } catch (err: any) {
        logger.warn('Groq reply generation failed:', err.message);
      }
    }

    if (this.geminiClient) {
      try {
        const model = this.geminiClient.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const fullPrompt = `${systemPrompt ? systemPrompt + '\n\n' : ''}${prompt}`;
        const response = await model.generateContent(fullPrompt);
        const raw = response.response.text() || '';
        if (raw) {
          logger.llm('Gemini 2.5 Flash (reply)', prompt, raw);
          return raw;
        }
      } catch (err: any) {
        logger.warn('Gemini reply generation failed:', err.message);
      }
    }

    // Last resort: a plain, honest reply rather than nothing.
    logger.warn('Both LLM providers failed — returning generic reply text');
    return "Got it — noted. (I'm having trouble phrasing this nicely right now, but your entry was saved.)";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Rule-based local parser — LAST RESORT ONLY, used when both Groq and
 * Gemini are unreachable. Kept intentionally conservative: on ambiguous
 * direction, it asks rather than guesses.
 */
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

  // Ambiguous direction — ask rather than guess
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