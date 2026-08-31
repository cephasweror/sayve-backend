import { Groq } from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { normalizeNigerianMarketNumbers } from './parser.service';
import { IPendingClarification } from '../models/User';
import { ITransaction } from '../models/Transaction';

export type IntentCategory =
  | 'new_transaction'
  | 'correction'
  | 'report_request'
  | 'clarification_reply'
  | 'unclear';

export interface ExtractedTransaction {
  type: 'income' | 'expense' | 'gain' | 'loss' | 'unclear';
  amount: number | null;
  category: string;
  description: string;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  date?: string;
}

export interface CorrectionDiff {
  amount?: number;
  type?: 'income' | 'expense' | 'gain' | 'loss';
  category?: string;
  description?: string;
}

export interface ReportParams {
  period: 'today' | 'week' | 'month' | 'all';
  format: 'excel' | 'pdf' | 'csv';
}

export class PipelineService {
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

  // ─────────────────────────────────────────────────────────────
  // STAGE 1: INTENT CLASSIFIER
  // ─────────────────────────────────────────────────────────────
  async classifyIntent(
    rawMessage: string,
    pendingClarification?: IPendingClarification | null
  ): Promise<IntentCategory> {
    const text = normalizeNigerianMarketNumbers(rawMessage).trim();
    const lower = text.toLowerCase();

    // Fast-path heuristic fallback check for offline / unit test reliability
    const heuristicIntent = this.heuristicClassifyIntent(lower, pendingClarification);

    const pendingContextStr = pendingClarification
      ? `Pending question type: "${pendingClarification.type}", asked at ${pendingClarification.askedAt}`
      : 'None';

    const systemPrompt = `You are an intent classifier for a WhatsApp financial assistant. Given a user's message, classify it into exactly one of these categories. Reply with ONLY the category name, nothing else.

Categories:
- new_transaction: describes money coming in or going out (a sale, a purchase, an expense, income of any kind), even if worded informally or with typos.
- correction: the user is correcting, disputing, or amending their previous message (e.g. "no that's wrong", "I meant 15000 not 5000", "actually it was an expense").
- report_request: the user wants a summary, total, breakdown, or report of their finances over any time period, however phrased ("how much did I make", "what's my report", "send my summary", "show me this week").
- clarification_reply: a short reply that only makes sense as an answer to a question the assistant just asked (e.g. a bare number, "yes", "expense", "this week") — you will be told if a question is pending.
- unclear: none of the above fit, or the message has no financial content.

Pending Question Context: ${pendingContextStr}
A pending question context may be provided. If present, strongly favor classifying as clarification_reply unless the message clearly starts a new, unrelated transaction.`;

    const userPrompt = `Message: "${text}"`;

    if (this.groqClient) {
      try {
        const completion = await this.groqClient.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.0,
        });
        const raw = completion.choices[0]?.message?.content?.trim().toLowerCase() || '';
        const intent = this.normalizeIntentLabel(raw);
        if (intent) {
          logger.info(`[Stage 1 Intent Classifier] Groq classified "${text}" as "${intent}"`);
          return intent;
        }
      } catch (err: any) {
        logger.warn(`Stage 1 Groq classification failed: ${err.message}`);
      }
    }

    if (this.geminiClient) {
      try {
        const model = this.geminiClient.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const response = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
        const raw = response.response.text().trim().toLowerCase();
        const intent = this.normalizeIntentLabel(raw);
        if (intent) {
          logger.info(`[Stage 1 Intent Classifier] Gemini classified "${text}" as "${intent}"`);
          return intent;
        }
      } catch (err: any) {
        logger.warn(`Stage 1 Gemini classification failed: ${err.message}`);
      }
    }

    logger.info(`[Stage 1 Intent Classifier] Fallback heuristic classified "${text}" as "${heuristicIntent}"`);
    return heuristicIntent;
  }

  private normalizeIntentLabel(raw: string): IntentCategory | null {
    const cleaned = raw.replace(/[^a-z_]/g, '');
    if (['new_transaction', 'correction', 'report_request', 'clarification_reply', 'unclear'].includes(cleaned)) {
      return cleaned as IntentCategory;
    }
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
      // If user is asked a question and sends a short message (e.g. "expense", "5000", "income", "Sales", "today", "Rent")
      const isShortReply = lower.split(' ').length <= 4;
      const startsNewTx = ['sold', 'bought', 'spent', 'received', 'paid'].some(k => lower.startsWith(k));
      if (isShortReply && !startsNewTx) {
        return 'clarification_reply';
      }
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
      lower.includes('what\'s my report') ||
      lower.includes('whats my report') ||
      lower.includes('send my summary') ||
      lower.includes('show me this week') ||
      lower.includes('spent this month') ||
      lower.includes('expenses this month') ||
      lower.includes('export') ||
      lower.includes('csv') ||
      lower.includes('excel') ||
      lower.includes('pdf')
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
  // STAGE 2a: TRANSACTION EXTRACTION
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

    if (this.groqClient) {
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
        const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
        if (json && (json.type || json.amount !== undefined)) {
          return {
            type: json.type || 'unclear',
            amount: typeof json.amount === 'number' ? json.amount : null,
            category: json.category || 'Other',
            description: json.description || text,
            needsClarification: Boolean(json.needsClarification),
            clarificationQuestion: json.clarificationQuestion || null,
          };
        }
      } catch (err: any) {
        logger.warn(`Stage 2a Groq extraction failed: ${err.message}`);
      }
    }

    if (this.geminiClient) {
      try {
        const model = this.geminiClient.getGenerativeModel({
          model: 'gemini-1.5-flash',
          generationConfig: { responseMimeType: 'application/json' },
        });
        const response = await model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
        const raw = response.response.text() || '';
        const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
        if (json) {
          return {
            type: json.type || 'unclear',
            amount: typeof json.amount === 'number' ? json.amount : null,
            category: json.category || 'Other',
            description: json.description || text,
            needsClarification: Boolean(json.needsClarification),
            clarificationQuestion: json.clarificationQuestion || null,
          };
        }
      } catch (err: any) {
        logger.warn(`Stage 2a Gemini extraction failed: ${err.message}`);
      }
    }

    // Heuristic extraction fallback
    return this.heuristicExtractTransaction(text, knownCategories);
  }

  private heuristicExtractTransaction(text: string, knownCategories: string[]): ExtractedTransaction {
    const lower = text.toLowerCase();
    const isIncome = ['sold', 'sale', 'received', 'paid me', 'alert', 'made', 'earned'].some(k => lower.includes(k));
    const isExpense = ['spent', 'bought', 'paid for', 'cost me', 'expense'].some(k => lower.includes(k));

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
  // STAGE 2b: CORRECTION HANDLER
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

    if (this.groqClient) {
      try {
        const completion = await this.groqClient.chat.completions.create({
          messages: [{ role: 'system', content: systemPrompt }],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.0,
          response_format: { type: 'json_object' },
        });
        const raw = completion.choices[0]?.message?.content || '';
        const diff = JSON.parse(raw.replace(/```json|```/g, '').trim());
        if (diff) return diff;
      } catch (err: any) {
        logger.warn(`Stage 2b Groq correction diff failed: ${err.message}`);
      }
    }

    // Heuristic correction fallback
    const lower = text.toLowerCase();
    const diff: CorrectionDiff = {};

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
