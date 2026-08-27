import { llmService } from './llm.service';
import { logger } from '../utils/logger';

export interface ParsedItem {
  type: 'income' | 'expense' | 'gain' | 'loss' | null;
  amount: number | null;
  currency: string;
  category: string | null;
  description: string;
  date: string;
  business_name: string | null;
}

export interface ParsedResponse {
  needs_clarification: boolean;
  clarification_question: string | null;
  is_batch: boolean;
  items: ParsedItem[];

  // Non-transaction intents
  isSummaryQuery?: boolean;
  queryPeriod?: 'today' | 'week' | 'month';
  isExportRequest?: boolean;
  isCorrection?: boolean;
  correctedCategory?: string;
  rawText: string;
}

export interface ParserContext {
  business_name: string | null;
  known_categories: string[];
  today_date: string;
  is_batch?: boolean;
}

/**
 * Normalizes Nigerian market number expressions:
 * - "2k5" / "2K5" -> "2500"
 * - "3k500" -> "3500"
 * - "10k5" -> "10500"
 * - "1m2" -> "1200000"
 * - "5k" -> "5000"
 * - "1.5k" -> "1500"
 * - "2m" -> "2000000"
 */
export function normalizeNigerianMarketNumbers(text: string): string {
  return text
    // Handle "2k5", "3k500", "10k5"
    .replace(/\b(\d+)\s*k\s*(\d{1,3})\b/gi, (_, thousands, hundreds) => {
      const h = hundreds.padEnd(3, '0').substring(0, 3);
      return String(parseInt(thousands, 10) * 1000 + parseInt(h, 10));
    })
    // Handle "1m2"
    .replace(/\b(\d+)\s*m\s*(\d{1,3})\b/gi, (_, millions, hundreds) => {
      const h = hundreds.padEnd(3, '0').substring(0, 3);
      return String(parseInt(millions, 10) * 1000000 + parseInt(h, 10) * 1000);
    })
    // Handle standard "5k", "1.5k", "500k"
    .replace(/\b(\d+(?:\.\d+)?)\s*k\b/gi, (_, n) => String(Math.round(parseFloat(n) * 1000)))
    // Handle standard "1m", "1.2m"
    .replace(/\b(\d+(?:\.\d+)?)\s*m\b/gi, (_, n) => String(Math.round(parseFloat(n) * 1000000)));
}

const SYSTEM_PROMPT = `
You are an expert AI financial record assistant for Nigerian small business owners and market traders using WhatsApp.
You deeply understand Nigerian Market English, Pidgin, local business slangs, and trade phrasing.

YOUR TASKS, IN ORDER:

1. IDENTIFY COMMANDS / FINANCIAL OVERVIEW QUERIES:
   - If user asks about their sales, profit, or market status ("how market be today", "how much I make", "track my money for today", "how far today", "show my level", "my total balance", "how money move this week", "make I see my breakdown"):
     Set "isSummaryQuery": true, "queryPeriod": "today" | "week" | "month", "needs_clarification": false, "items": [].
   - If user asks for file, statement, or report export ("send report", "export csv", "CVS", "excel", "report sheet", "download file", "send statement", "send my book", "document", "history"):
     Set "isExportRequest": true, "needs_clarification": false, "items": [].
   - If user is correcting a category ("no, it's Rent", "change category to Transport"):
     Set "isCorrection": true, "correctedCategory": string, "needs_clarification": false, "items": [].

2. IDENTIFY TRANSACTION TYPE (income, expense, gain, loss):
   - Recognize Nigerian Market & Pidgin Phrasing:
     * INCOME: "sold", "customer paid", "received", "alert", "cash enter", "sales today", "somebody buy", "collect money from", "sell 3 mudu"
     * EXPENSE: "bought", "paid for", "spent on", "chop money", "fuel gen", "give boys", "pay transport", "okada", "keke", "buy market", "feeding", "staff salary", "nepa bill", "light bill"
     * GAIN: "profit from", "extra from", "dash", "bonus", "tips", "gift"
     * LOSS: "lost", "damaged", "spoilt", "wrote off", "stolen", "spill", "police chop", "task force take"
   - If type is ambiguous (e.g. just "600000 fuel"), set "needs_clarification": true and ask: "Is this money coming in or going out?"

3. IDENTIFY AMOUNT:
   Amounts arrive normalized. If no amount is mentioned at all, set "needs_clarification": true and ask for it.
   If quantity & total exist (e.g. "sell 3 bags of rice for 45000"), pick total (45000) as amount and note quantity in description.

4. IDENTIFY CATEGORY:
   Match against known_categories first.
   Common categories: Sales, Inventory, Transport, Fuel, Rent, Salaries, Utilities, Food, Other.

5. IDENTIFY PERIOD:
   Default to today_date if no date is specified.

6. IDENTIFY BUSINESS:
   If business_name is null AND logging a transaction, set "needs_clarification": true and ask: "Which business is this for?"

7. BATCH LIST HANDLING (is_batch = true):
   Extract every line item found into the "items" array.

RESPONSE FORMAT:
Respond ONLY with valid JSON:
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
`;

export class ParserService {
  /**
   * Parse user text message into structured intent & transaction data
   */
  async parseUserMessage(userMessage: string, context?: ParserContext): Promise<ParsedResponse | null> {
    try {
      const todayDate = context?.today_date || new Date().toISOString().split('T')[0];
      const businessName = context?.business_name || null;
      const knownCategories = context?.known_categories || ['Sales', 'Inventory', 'Transport', 'Utilities', 'Salaries', 'Rent', 'Food', 'Fuel', 'Other'];
      const isBatch = Boolean(context?.is_batch);

      // Normalize Nigerian market numbers (e.g. 2k5 -> 2500, 3k500 -> 3500, 1m2 -> 1200000, 500k -> 500000)
      const normalizedMessage = normalizeNigerianMarketNumbers(userMessage);

      const promptContext = JSON.stringify({
        business_name: businessName,
        known_categories: knownCategories,
        today_date: todayDate,
        message_text: normalizedMessage,
        is_batch: isBatch,
      });

      const prompt = `CONTEXT:\n${promptContext}\n\nParse this incoming WhatsApp message from a business owner: "${normalizedMessage}"`;
      const rawJson = await llmService.generateCompletion(prompt, SYSTEM_PROMPT);

      // Clean JSON string in case backticks or markdown fences were attached
      const cleanJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      let queryPeriod: 'today' | 'week' | 'month' = 'month';
      const lower = userMessage.toLowerCase();
      if (lower.includes('today') || lower.includes('for today') || lower.includes("today's")) {
        queryPeriod = 'today';
      } else if (lower.includes('week') || lower.includes('this week')) {
        queryPeriod = 'week';
      } else if (parsed.queryPeriod && ['today', 'week', 'month'].includes(parsed.queryPeriod)) {
        queryPeriod = parsed.queryPeriod;
      }

      return {
        needs_clarification: Boolean(parsed.needs_clarification),
        clarification_question: parsed.clarification_question || null,
        is_batch: Boolean(parsed.is_batch),
        items: Array.isArray(parsed.items) ? parsed.items : [],
        isSummaryQuery: Boolean(parsed.isSummaryQuery),
        queryPeriod,
        isExportRequest: Boolean(parsed.isExportRequest),
        isCorrection: Boolean(parsed.isCorrection),
        correctedCategory: parsed.correctedCategory || undefined,
        rawText: userMessage,
      };
    } catch (error) {
      logger.error('Failed to parse user message with LLM:', error);
      return null;
    }
  }
}

export const parserService = new ParserService();
