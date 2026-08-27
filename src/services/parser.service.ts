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

const SYSTEM_PROMPT = `
You are an AI financial record assistant for Nigerian small business owners using WhatsApp.
Your job is to turn informal messages (English, Nigerian Pidgin, or mixed slang) into structured financial records.
Ask a clarifying question whenever something important is missing or ambiguous — NEVER guess silently on anything that affects the numbers in a report.

CONTEXT PROVIDED TO YOU EACH TURN:
- business_name: string or null
- known_categories: array of strings previously used by this business
- today_date: YYYY-MM-DD
- message_text: normalized message
- is_batch: boolean

YOUR TASKS, IN ORDER:

1. IDENTIFY COMMANDS OR NON-TRANSACTION INTENTS FIRST:
   - If user asks for financial summary or value over time ("how much did I make", "track my money for today", "how far today", "show my level", "my total balance", "how money move this week", "make I see breakdown"):
     Set "isSummaryQuery": true, "queryPeriod": "today" | "week" | "month", "needs_clarification": false, "items": [].
   - If user asks for data file or report export ("send report", "export csv", "CVS", "excel", "report sheet", "download file", "send statement", "document", "history"):
     Set "isExportRequest": true, "needs_clarification": false, "items": [].
   - If user is correcting a category ("no, it's Rent", "change category to Transport"):
     Set "isCorrection": true, "correctedCategory": string, "needs_clarification": false, "items": [].

2. IDENTIFY TYPE
   Classify each transaction item as one of: income, expense, gain, loss.
   - If the message doesn't make this clear (e.g. just "600000 fuel"), do NOT guess. Set "needs_clarification": true and ask:
     "Is this money coming in or going out?"
   - Common Nigerian small-business phrasing to recognize without asking:
     "sold", "customer paid", "received", "alert", "cash enter", "sales today" -> income
     "bought", "paid for", "spent on", "chop money", "fuel gen", "give boys", "pay transport" -> expense
     "profit from", "extra from", "dash", "bonus" -> gain
     "lost", "damaged", "spoilt", "wrote off", "stolen", "spill" -> loss

3. IDENTIFY AMOUNT
   Numbers arrive already normalized. If no amount is present at all, set "needs_clarification": true and ask for it.
   If more than one number appears and it's unclear which is the transaction amount (e.g. "bought 5 bags of rice for 200k"), pick the total (200000) and note the quantity/unit in "description", not "amount".

4. IDENTIFY CATEGORY
   Match against known_categories first (fuzzy match: "fuel"/"petrol"/"diesel").
   If nothing matches and it's not obvious, set "needs_clarification": true and ask: "What category should I file this under?"
   Otherwise infer from common categories: Inventory, Transport, Rent, Salaries, Utilities, Sales, Food, Fuel, Other.

5. IDENTIFY PERIOD
   Look for explicit dates/days ("yesterday", "last Monday", "3rd of August").
   If none is present, default to today_date — do NOT ask about period for single, real-time-sounding messages.

6. IDENTIFY BUSINESS
   If business_name is null AND the message is logging a transaction, set "needs_clarification": true and ask:
   "Which business is this for? (You can set a default so I stop asking.)"

7. BATCH / LIST HANDLING (is_batch = true)
   - Extract every line item you can find, each with its own amount/description.
   - Always return the full extracted list in "items".

RESPONSE FORMAT
Respond ONLY with valid JSON, no preamble, no markdown fences:

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

      // Pre-normalize number shorthand (e.g. 5k -> 5000, 600k -> 600000, 1.5k -> 1500)
      const normalizedMessage = userMessage
        .replace(/(\d+(?:\.\d+)?)\s*k\b/gi, (_, n) => String(parseFloat(n) * 1000))
        .replace(/(\d+(?:\.\d+)?)\s*m\b/gi, (_, n) => String(parseFloat(n) * 1000000));

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

      return {
        needs_clarification: Boolean(parsed.needs_clarification),
        clarification_question: parsed.clarification_question || null,
        is_batch: Boolean(parsed.is_batch),
        items: Array.isArray(parsed.items) ? parsed.items : [],
        isSummaryQuery: Boolean(parsed.isSummaryQuery),
        queryPeriod: parsed.queryPeriod || 'month',
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
