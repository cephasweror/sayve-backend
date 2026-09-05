import { Groq } from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { normalizeNigerianMarketNumbers } from './parser.service';
import { IPendingClarification } from '../models/User';
import { ITransaction } from '../models/Transaction';

export type AIProvider = 'gemini' | 'groq' | 'openrouter' | 'heuristic';

export type IntentCategory =
  | 'new_transaction'
  | 'correction'
  | 'report_request'
  | 'clarification_reply'
  | 'greeting'
  | 'settings'
  | 'deletion'
  | 'unclear';

export interface ExtractedTransaction {
  type: 'income' | 'expense' | 'gain' | 'loss' | 'unclear';
  amount: number | null;
  category: string;
  description: string;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  date?: string;
  provider?: AIProvider;
}

export interface CorrectionDiff {
  amount?: number;
  type?: 'income' | 'expense' | 'gain' | 'loss';
  category?: string;
  description?: string;
  provider?: AIProvider;
}

export interface ReportParams {
  period: 'today' | 'week' | 'month' | 'all';
  format: 'excel' | 'pdf' | 'csv';
}

export interface GroqErrorAnalysis {
  status: number | undefined;
  isConfigError: boolean;
  isTransientError: boolean;
  message: string;
}

export function analyzeGroqError(err: any, modelName: string): GroqErrorAnalysis {
  const status = err?.status || err?.statusCode || (err?.response ? err.response.status : undefined);
  const rawMsg = err?.error?.message || err?.message || String(err);

  if (status === 401 || rawMsg.includes('invalid_api_key') || rawMsg.includes('Unauthorized')) {
    logger.error(`[AI] Groq authentication failed (401). Check GROQ_API_KEY. (${rawMsg})`);
    return { status: 401, isConfigError: true, isTransientError: false, message: rawMsg };
  }

  if (status === 403) {
    logger.error(`[AI] Groq access forbidden (403) for model "${modelName}". (${rawMsg})`);
    return { status: 403, isConfigError: true, isTransientError: false, message: rawMsg };
  }

  if (status === 404 || rawMsg.includes('model_not_found')) {
    logger.error(`[AI] Groq model not found (404) for model "${modelName}". Check GROQ_MODEL configuration. (${rawMsg})`);
    return { status: 404, isConfigError: true, isTransientError: false, message: rawMsg };
  }

  if (status === 429 || rawMsg.includes('rate_limit_exceeded')) {
    logger.warn(`[AI] Groq rate limited (429) for model "${modelName}". Falling back to OpenRouter.`);
    return { status: 429, isConfigError: false, isTransientError: true, message: rawMsg };
  }

  if (status && status >= 500) {
    logger.warn(`[AI] Groq server error (${status}) for model "${modelName}". Falling back to OpenRouter.`);
    return { status, isConfigError: false, isTransientError: true, message: rawMsg };
  }

  logger.warn(`[AI] Groq request failed for model "${modelName}": ${rawMsg}`);
  return { status, isConfigError: false, isTransientError: true, message: rawMsg };
}

export class PipelineService {
  private geminiClient: GoogleGenerativeAI | null = null;
  private groqClient: Groq | null = null;

  constructor() {
    this.initProviders();
  }

  private initProviders(): void {
    const rawGeminiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY;
    const rawGroqKey = process.env.GROQ_API_KEY || env.GROQ_API_KEY;
    const rawOpenRouterKey = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY;

    const isGeminiConfigured = Boolean(rawGeminiKey && rawGeminiKey !== 'mock_gemini_key' && !rawGeminiKey.includes('your_') && rawGeminiKey.length > 10);
    const isGroqConfigured = Boolean(rawGroqKey && rawGroqKey !== 'mock_groq_key' && !rawGroqKey.includes('your_') && rawGroqKey.length > 10);
    const isOpenRouterConfigured = Boolean(rawOpenRouterKey && rawOpenRouterKey !== 'mock_openrouter_key' && !rawOpenRouterKey.includes('your_') && rawOpenRouterKey.length > 10);

    // Diagnostic Startup Logs (Gemini Primary -> Groq Fallback -> OpenRouter Tertiary)
    logger.info(`[AI] Gemini (Primary) configured: ${isGeminiConfigured} ${isGeminiConfigured ? `(Length: ${rawGeminiKey!.length}, Prefix: "${rawGeminiKey!.substring(0, 4)}***")` : ''}`);
    logger.info(`[AI] Groq (Secondary Fallback) configured: ${isGroqConfigured} ${isGroqConfigured ? `(Length: ${rawGroqKey!.length}, Prefix: "${rawGroqKey!.substring(0, 4)}***")` : ''}`);
    logger.info(`[AI] OpenRouter (Tertiary Fallback) configured: ${isOpenRouterConfigured} ${isOpenRouterConfigured ? `(Length: ${rawOpenRouterKey!.length}, Prefix: "${rawOpenRouterKey!.substring(0, 4)}***")` : ''}`);

    if (isGeminiConfigured) {
      this.geminiClient = new GoogleGenerativeAI(rawGeminiKey!);
    }
    if (isGroqConfigured) {
      this.groqClient = new Groq({ apiKey: rawGroqKey });
    }
  }

  private getGeminiModelName(): string {
    return process.env.GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-2.0-flash';
  }

  private getGroqCandidateModels(): string[] {
    const primary = process.env.GROQ_MODEL || env.GROQ_MODEL || 'groq/compound';
    const fallbackList = ['groq/compound', 'groq/compound-mini', 'qwen/qwen3.6-27b', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];
    return Array.from(new Set([primary, ...fallbackList]));
  }

  private getOpenRouterCandidateModels(): string[] {
    const primary = process.env.OPENROUTER_MODEL || env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
    const fallbackList = ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-lite-001:free', 'openrouter/auto'];
    return Array.from(new Set([primary, ...fallbackList]));
  }

  /**
   * OpenRouter HTTP Integration (Tertiary Fallback)
   */
  private async callOpenRouter(systemPrompt: string, userPrompt: string, isJson: boolean = false): Promise<string | null> {
    const apiKey = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY;
    if (!apiKey || apiKey === 'mock_openrouter_key' || apiKey.includes('your_') || apiKey.length < 10) {
      return null;
    }

    const candidateModels = this.getOpenRouterCandidateModels();

    for (const model of candidateModels) {
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
        const rawMsg = err.response?.data?.error?.message || err.message;

        if (status === 401) {
          logger.error(`[AI] OpenRouter authentication failed (401). Check OPENROUTER_API_KEY. (${rawMsg})`);
          break;
        } else if (status === 403) {
          logger.error(`[AI] OpenRouter access forbidden (403) for model "${model}". (${rawMsg})`);
        } else if (status === 404) {
          logger.error(`[AI] OpenRouter model not found (404) for model "${model}". Check OPENROUTER_MODEL. (${rawMsg})`);
        } else if (status === 429) {
          logger.warn(`[AI] OpenRouter rate limited (429) for model "${model}". (${rawMsg})`);
        } else {
          logger.warn(`[AI] OpenRouter call failed for model "${model}": ${rawMsg}`);
        }
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // STAGE 1: INTENT CLASSIFIER (Gemini Primary -> Groq Secondary -> OpenRouter Tertiary -> Heuristic)
  // ─────────────────────────────────────────────────────────────
  async classifyIntent(
    rawMessage: string,
    pendingClarification?: IPendingClarification | null
  ): Promise<IntentCategory> {
    const text = normalizeNigerianMarketNumbers(rawMessage).trim();
    const lower = text.toLowerCase();
    const heuristicIntent = this.heuristicClassifyIntent(lower, pendingClarification);

    const pendingContextStr = pendingClarification
      ? `Pending question type: "${pendingClarification.type}", asked at ${pendingClarification.askedAt}`
      : 'None';

    const systemPrompt = `You are an intent classifier for a WhatsApp financial assistant. Given a user's message, classify it into exactly one of these categories. Reply with ONLY the category name, nothing else.

Categories:
- greeting: friendly conversational openers or greetings with no transaction numbers (e.g. "hello", "hi", "good morning", "good evening", "how far", "hey", "what are we doing today").
- settings: user wants to update their currency, business name, or account settings (e.g. "change currency to USD", "set currency", "change business name to X").
- deletion: user wants to delete or undo their previous transaction (e.g. "delete last transaction", "undo", "remove last item", "delete entry").
- new_transaction: describes money coming in or going out (a sale, a purchase, an expense, income of any kind), even if worded informally or with typos.
- correction: the user is correcting, disputing, or amending their previous message (e.g. "no that's wrong", "I meant 15000 not 5000", "actually it was an expense").
- report_request: the user wants a summary, total, breakdown, or report of their finances over any time period, however phrased ("how much did I make", "what's my report", "send my summary", "show me this week", "export excel").
- clarification_reply: a short reply that only makes sense as an answer to a question the assistant just asked (e.g. a bare number, "yes", "expense", "this week") — you will be told if a question is pending.
- unclear: none of the above fit, or the message has no financial content.

Pending Question Context: ${pendingContextStr}
A pending question context may be provided. If present, strongly favor classifying as clarification_reply unless the message clearly starts a new, unrelated transaction.`;

    const userPrompt = `Message: "${text}"`;
    let isGeminiConfigError = false;

    // 1. Gemini (PRIMARY PROVIDER)
    if (this.geminiClient) {
      const geminiModel = this.getGeminiModelName();
      logger.info(`[AI] Trying Gemini Primary (${geminiModel})...`);
      try {
        const model = this.geminiClient.getGenerativeModel({ model: geminiModel });
        const response = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
        const raw = response.response.text().trim().toLowerCase();
        const intent = this.normalizeIntentLabel(raw);
        if (intent) {
          logger.info(`[AI] Gemini succeeded (${geminiModel}) -> Intent: "${intent}"`);
          return intent;
        }
      } catch (err: any) {
        const status = err?.status || err?.statusCode;
        if (status === 401 || status === 403 || status === 404) {
          isGeminiConfigError = true;
          logger.error(`[AI] Gemini configuration error (${status}): ${err.message}`);
        } else {
          logger.warn(`[AI] Gemini rate limited / failed (${err.message}). Falling back to Groq...`);
        }
      }
    }

    // 2. Groq (SECONDARY FALLBACK PROVIDER)
    let isGroqConfigError = false;
    if (this.groqClient && !isGeminiConfigError) {
      logger.info(`[AI] Gemini unavailable or rate limited. Trying Groq fallback (${process.env.GROQ_MODEL || env.GROQ_MODEL || 'groq/compound'})...`);
      const candidateModels = this.getGroqCandidateModels();
      for (const model of candidateModels) {
        try {
          const completion = await this.groqClient.chat.completions.create({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            model,
            temperature: 0.0,
          });
          const raw = completion.choices[0]?.message?.content?.trim().toLowerCase() || '';
          const intent = this.normalizeIntentLabel(raw);
          if (intent) {
            logger.info(`[AI] Groq fallback succeeded (${model}) -> Intent: "${intent}"`);
            return intent;
          }
        } catch (err: any) {
          const analysis = analyzeGroqError(err, model);
          if (analysis.isConfigError) {
            isGroqConfigError = true;
          }
        }
      }
    }

    // 3. OpenRouter (TERTIARY FALLBACK PROVIDER)
    if (!isGeminiConfigError && !isGroqConfigError) {
      logger.info('[AI] Gemini and Groq unavailable. Trying OpenRouter fallback...');
      const openRouterRaw = await this.callOpenRouter(systemPrompt, userPrompt, false);
      if (openRouterRaw) {
        const intent = this.normalizeIntentLabel(openRouterRaw.trim().toLowerCase());
        if (intent) {
          logger.info(`[AI] OpenRouter fallback succeeded -> Intent: "${intent}"`);
          return intent;
        }
      }
    }

    // 4. Heuristic Fallback Classifier
    logger.info(`[AI] All AI providers failed or unconfigured. Fallback heuristic classified "${text}" as "${heuristicIntent}"`);
    return heuristicIntent;
  }

  private normalizeIntentLabel(raw: string): IntentCategory | null {
    const cleaned = raw.replace(/[^a-z_]/g, '');
    if (['new_transaction', 'correction', 'report_request', 'clarification_reply', 'greeting', 'settings', 'deletion', 'unclear'].includes(cleaned)) {
      return cleaned as IntentCategory;
    }
    if (cleaned.includes('greeting') || cleaned.includes('hello')) return 'greeting';
    if (cleaned.includes('setting') || cleaned.includes('currency')) return 'settings';
    if (cleaned.includes('delete') || cleaned.includes('undo') || cleaned.includes('remove')) return 'deletion';
    if (cleaned.includes('transaction')) return 'new_transaction';
    if (cleaned.includes('correction')) return 'correction';
    if (cleaned.includes('report') || cleaned.includes('summary')) return 'report_request';
    if (cleaned.includes('clarification') || cleaned.includes('reply')) return 'clarification_reply';
    return null;
  }

  private heuristicClassifyIntent(
    lower: string,
    pendingClarification?: IPendingClarification | null
  ): IntentCategory {
    if (pendingClarification) {
      const words = lower.split(' ').filter(Boolean);
      if (words.length <= 2) {
        return 'clarification_reply';
      }
      const startsFullNewTx = ['sold ', 'bought ', 'spent ', 'received ', 'paid '].some(k => lower.startsWith(k)) && /\d+/.test(lower);
      if (!startsFullNewTx) {
        return 'clarification_reply';
      }
    }

    if (
      lower.startsWith('delete') ||
      lower.includes('delete last') ||
      lower.includes('undo last') ||
      lower.includes('remove last') ||
      lower === 'undo'
    ) {
      return 'deletion';
    }

    if (
      lower.includes('change currency') ||
      lower.includes('set currency') ||
      lower.includes('update currency') ||
      lower.includes('change business name') ||
      lower.includes('set business name') ||
      lower === 'settings'
    ) {
      return 'settings';
    }

    const greetingWords = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'how far', 'whats up', 'what up'];
    if (greetingWords.some(g => lower === g || lower.startsWith(`${g} `) || lower.startsWith(`${g},`))) {
      return 'greeting';
    }

    if (
      lower.startsWith('no,') ||
      lower.startsWith('no ') ||
      lower.includes("that's wrong") ||
      lower.includes('i meant') ||
      lower.includes('actually it was') ||
      lower.includes('change category')
    ) {
      return 'correction';
    }

    if (
      lower.includes('report') ||
      lower.includes('summary') ||
      lower.includes('how much did i make') ||
      lower.includes('how much i make') ||
      lower.includes('how much') ||
      lower.includes('net profit') ||
      lower.includes('profit') ||
      lower.includes('what\'s my report') ||
      lower.includes('whats my report') ||
      lower.includes('send my summary') ||
      lower.includes('show me this week') ||
      lower.includes('spent this month') ||
      lower.includes('expenses this month') ||
      lower.includes('export') ||
      lower.includes('csv') ||
      lower.includes('excel') ||
      lower.includes('pdf') ||
      lower.includes('breakdown') ||
      lower.includes('balance')
    ) {
      return 'report_request';
    }

    const txKeywords = ['sold', 'sale', 'bought', 'spent', 'paid', 'cost me', 'received', 'earned', 'made', 'profit', 'loss', 'fuel', 'salary', 'rent'];
    if (txKeywords.some(k => lower.includes(k)) || /\d+/.test(lower)) {
      return 'new_transaction';
    }

    return 'unclear';
  }

  // ─────────────────────────────────────────────────────────────
  // STAGE 2a: TRANSACTION EXTRACTION (Gemini Primary -> Groq Secondary -> OpenRouter Tertiary -> Heuristic)
  // ─────────────────────────────────────────────────────────────
  async extractTransaction(
    rawMessage: string,
    knownCategories: string[] = ['Sales', 'Inventory', 'Transport', 'Utilities', 'Salaries', 'Rent', 'Supplies', 'Other']
  ): Promise<ExtractedTransaction> {
    const text = normalizeNigerianMarketNumbers(rawMessage).trim();
    const systemPrompt = `You extract structured transaction data from a WhatsApp message written by a Nigerian small business owner. Return ONLY valid JSON, no other text.

Output format:
{
  "type": "income" | "expense" | "unclear",
  "amount": number | null,
  "category": string,
  "description": string,
  "needsClarification": boolean,
  "clarificationQuestion": string | null
}

Rules:
1. Words like "spent", "paid", "bought", "cost me", "expense" mean type = "expense". Words like "sold", "earned", "made", "received", "income" mean type = "income". If genuinely ambiguous, set type = "unclear" and needsClarification = true.
2. Parse Nigerian shorthand: "5k" = 5000, "600k" = 600000, "1.2m" or "1.2 million" = 1200000, "600 thousand" = 600000.
3. Categories must be one of: ${knownCategories.join(', ')}. Pick the closest fit; default to "Other" only if nothing fits.
4. If amount is missing or the message is just a list of items with no numbers, set needsClarification = true and write a short, specific clarificationQuestion (e.g. "Got it — is this a sale or a purchase, and what was the total amount?").
5. Never guess a type just to avoid asking — false data is worse than one extra question.

Examples:
Message: "My expense for today is 13000 for fuel"
Output: {"type":"expense","amount":13000,"category":"Transport","description":"fuel","needsClarification":false,"clarificationQuestion":null}

Message: "sold 3 bags of rice for 45k"
Output: {"type":"income","amount":45000,"category":"Sales","description":"3 bags of rice","needsClarification":false,"clarificationQuestion":null}

Message: "paid salaries this month 600 thousand"
Output: {"type":"expense","amount":600000,"category":"Salaries","description":"monthly salaries","needsClarification":false,"clarificationQuestion":null}

Message: "rice and beans, 20000"
Output: {"type":"unclear","amount":20000,"category":"Other","description":"rice and beans","needsClarification":true,"clarificationQuestion":"Is this money you spent (buying rice and beans) or money you made (selling them)?"}`;

    const userPrompt = `Message: "${text}"`;
    let isGeminiConfigError = false;

    // 1. Gemini (PRIMARY PROVIDER)
    if (this.geminiClient) {
      const geminiModel = this.getGeminiModelName();
      try {
        const model = this.geminiClient.getGenerativeModel({
          model: geminiModel,
          generationConfig: { responseMimeType: 'application/json' },
        });
        const response = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
        const raw = response.response.text() || '';
        const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
        if (json) {
          logger.info(`[AI] Gemini (${geminiModel}) successfully extracted transaction.`);
          return {
            type: json.type || 'unclear',
            amount: typeof json.amount === 'number' ? json.amount : null,
            category: json.category || 'Other',
            description: json.description || text,
            needsClarification: Boolean(json.needsClarification),
            clarificationQuestion: json.clarificationQuestion || null,
            provider: 'gemini',
          };
        }
      } catch (err: any) {
        const status = err?.status || err?.statusCode;
        if (status === 401 || status === 403 || status === 404) {
          isGeminiConfigError = true;
          logger.error(`[AI] Gemini configuration error (${status}): ${err.message}`);
        } else {
          logger.warn(`[AI] Gemini extraction failed: ${err.message}. Trying Groq fallback...`);
        }
      }
    }

    // 2. Groq (SECONDARY FALLBACK PROVIDER)
    let isGroqConfigError = false;
    if (this.groqClient && !isGeminiConfigError) {
      const candidateModels = this.getGroqCandidateModels();
      for (const model of candidateModels) {
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
          const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
          if (json && (json.type || json.amount !== undefined)) {
            logger.info(`[AI] Groq fallback (${model}) successfully extracted transaction.`);
            return {
              type: json.type || 'unclear',
              amount: typeof json.amount === 'number' ? json.amount : null,
              category: json.category || 'Other',
              description: json.description || text,
              needsClarification: Boolean(json.needsClarification),
              clarificationQuestion: json.clarificationQuestion || null,
              provider: 'groq',
            };
          }
        } catch (err: any) {
          const analysis = analyzeGroqError(err, model);
          if (analysis.isConfigError) {
            isGroqConfigError = true;
          }
        }
      }
    }

    // 3. OpenRouter (TERTIARY FALLBACK PROVIDER)
    if (!isGeminiConfigError && !isGroqConfigError) {
      const openRouterRaw = await this.callOpenRouter(systemPrompt, userPrompt, true);
      if (openRouterRaw) {
        try {
          const json = JSON.parse(openRouterRaw.replace(/```json|```/g, '').trim());
          if (json) {
            logger.info('[AI] OpenRouter fallback successfully extracted transaction.');
            return {
              type: json.type || 'unclear',
              amount: typeof json.amount === 'number' ? json.amount : null,
              category: json.category || 'Other',
              description: json.description || text,
              needsClarification: Boolean(json.needsClarification),
              clarificationQuestion: json.clarificationQuestion || null,
              provider: 'openrouter',
            };
          }
        } catch (err: any) {
          logger.warn(`[AI] Failed to parse JSON from OpenRouter response: ${err.message}`);
        }
      }
    }

    // 4. Heuristic Fallback
    const fallbackResult = this.heuristicExtractTransaction(text, knownCategories);
    fallbackResult.provider = 'heuristic';
    return fallbackResult;
  }

  private heuristicExtractTransaction(text: string, knownCategories: string[]): ExtractedTransaction {
    const lower = text.toLowerCase();
    const isIncome = ['sold', 'sale', 'received', 'paid me', 'alert', 'made', 'earned'].some(k => lower.includes(k));
    const isExpense = !isIncome && ['spent', 'bought', 'paid', 'cost me', 'expense'].some(k => lower.includes(k));

    let type: 'income' | 'expense' | 'unclear' = 'unclear';
    if (isExpense) type = 'expense';
    else if (isIncome) type = 'income';

    const numbers = text.match(/\d+[\d,]*/g);
    const amount = numbers?.length ? Math.max(...numbers.map(n => parseInt(n.replace(/,/g, ''), 10))) : null;

    let category = 'Other';
    if (lower.includes('rice') || lower.includes('sold') || lower.includes('sales')) category = 'Sales';
    else if (lower.includes('transport') || lower.includes('okada') || lower.includes('keke') || lower.includes('bus')) category = 'Transport';
    else if (lower.includes('fuel') || lower.includes('petrol') || lower.includes('diesel')) category = 'Fuel';
    else if (lower.includes('rent')) category = 'Rent';
    else if (lower.includes('salary') || lower.includes('salaries')) category = 'Salaries';

    if (type === 'unclear' && amount !== null) {
      return {
        type: 'unclear',
        amount,
        category,
        description: text,
        needsClarification: true,
        clarificationQuestion: 'Is this money coming in or going out?',
      };
    }

    if (amount === null) {
      return {
        type,
        amount: null,
        category,
        description: text,
        needsClarification: true,
        clarificationQuestion: 'How much was this for?',
      };
    }

    return {
      type,
      amount,
      category,
      description: text,
      needsClarification: false,
      clarificationQuestion: null,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // STAGE 2b: CORRECTION HANDLER (Gemini Primary -> Groq Secondary -> OpenRouter Tertiary -> Heuristic)
  // ─────────────────────────────────────────────────────────────
  async handleCorrection(
    rawMessage: string,
    lastTransaction: ITransaction
  ): Promise<CorrectionDiff> {
    const text = normalizeNigerianMarketNumbers(rawMessage).trim();
    const lastTxJSON = JSON.stringify({
      amount: lastTransaction.amount,
      type: lastTransaction.type,
      category: lastTransaction.category,
      description: lastTransaction.description,
    });

    const systemPrompt = `The user is correcting their previous transaction. Their last logged transaction was: ${lastTxJSON}

Their correction message: "${text}"

Return ONLY JSON with the fields that should change (omit unchanged fields):
{"amount": number, "type": "income"|"expense", "category": string, "description": string}

If the correction doesn't specify a field, don't include it — the existing value stays.`;

    const userPrompt = `Correction text: "${text}"`;
    let isGeminiConfigError = false;

    // 1. Gemini (PRIMARY PROVIDER)
    if (this.geminiClient) {
      const geminiModel = this.getGeminiModelName();
      try {
        const model = this.geminiClient.getGenerativeModel({
          model: geminiModel,
          generationConfig: { responseMimeType: 'application/json' },
        });
        const response = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
        const raw = response.response.text() || '';
        const diff = JSON.parse(raw.replace(/```json|```/g, '').trim());
        if (diff) {
          diff.provider = 'gemini';
          return diff;
        }
      } catch (err: any) {
        const status = err?.status || err?.statusCode;
        if (status === 401 || status === 403 || status === 404) {
          isGeminiConfigError = true;
        }
      }
    }

    // 2. Groq (SECONDARY FALLBACK PROVIDER)
    let isGroqConfigError = false;
    if (this.groqClient && !isGeminiConfigError) {
      const candidateModels = this.getGroqCandidateModels();
      for (const model of candidateModels) {
        try {
          const completion = await this.groqClient.chat.completions.create({
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            model,
            temperature: 0.0,
            response_format: { type: 'json_object' },
          });
          const raw = completion.choices[0]?.message?.content || '';
          const diff = JSON.parse(raw.replace(/```json|```/g, '').trim());
          if (diff) {
            diff.provider = 'groq';
            return diff;
          }
        } catch (err: any) {
          const analysis = analyzeGroqError(err, model);
          if (analysis.isConfigError) {
            isGroqConfigError = true;
          }
        }
      }
    }

    // 3. OpenRouter (TERTIARY FALLBACK PROVIDER)
    if (!isGeminiConfigError && !isGroqConfigError) {
      const openRouterRaw = await this.callOpenRouter(systemPrompt, userPrompt, true);
      if (openRouterRaw) {
        try {
          const diff = JSON.parse(openRouterRaw.replace(/```json|```/g, '').trim());
          if (diff) {
            diff.provider = 'openrouter';
            return diff;
          }
        } catch (err: any) {
          logger.warn(`Stage 2b OpenRouter diff JSON parse failed: ${err.message}`);
        }
      }
    }

    // 4. Heuristic Fallback
    const lower = text.toLowerCase();
    const diff: CorrectionDiff = { provider: 'heuristic' };

    const categoryMap: [string, string][] = [
      ['rent', 'Rent'], ['sales', 'Sales'], ['sale', 'Sales'], ['transport', 'Transport'],
      ['inventory', 'Inventory'], ['stock', 'Inventory'], ['salary', 'Salaries'],
      ['salaries', 'Salaries'], ['utility', 'Utilities'], ['fuel', 'Fuel'],
    ];
    const catMatch = categoryMap.find(([kw]) => lower.includes(kw));
    if (catMatch) diff.category = catMatch[1];

    if (lower.includes('expense') || lower.includes('spent') || lower.includes('going out')) diff.type = 'expense';
    else if (lower.includes('income') || lower.includes('sold') || lower.includes('coming in')) diff.type = 'income';

    const numbers = text.match(/\d+[\d,]*/g);
    if (numbers?.length) {
      diff.amount = parseInt(numbers[0].replace(/,/g, ''), 10);
    }

    return diff;
  }
}

export const pipelineService = new PipelineService();
