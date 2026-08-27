import { IUser } from '../models/User';
import { ITransaction, Transaction } from '../models/Transaction';
import { formatCurrency } from '../utils/formatters';
import { llmService } from './llm.service';
import { logger } from '../utils/logger';

const PASS2_SYSTEM_PROMPT = `
You are a warm, intelligent Nigerian small business assistant replying to a business owner on WhatsApp.
Your persona is a "small business friend who is good with numbers" — warm, slightly informal, sharp, and helpful (never stiff or corporate).

RULES FOR YOUR WHATSAPP REPLIES:
1. SHORT & PUNCHY: 1 to 3 lines maximum. Never write paragraphs or long disclaimers.
2. VARY YOUR PHRASING: Never repeat the exact same sentence structure every time.
3. FORMAT CURRENCY PROPERLY: Always write amounts with ₦ and commas (e.g. ₦45,000, ₦120,000), NEVER raw numbers like 45000.
4. ACKNOWLEDGE CONTEXT: Highlight intelligence when provided (e.g. "That's your 3rd fuel expense this week — ₦120,000 total so far").
5. SPARING EMOJIS: Use 1 emoji maximum (e.g. ✅ or 📊), do not put decorative emojis on every line.
6. CLARIFICATION QUESTIONS: Ask like a real person ("Money in or money out on this one?" or "What category should we file this under?").
`;

export class ReplyService {
  /**
   * Fetch context statistics for a category in the current week (WAT timezone)
   */
  async getCategoryWeekStats(userId: string, category: string): Promise<{ count: number; total: number }> {
    try {
      const WAT_OFFSET = 1 * 60 * 60 * 1000;
      const now = new Date();
      const watNow = new Date(now.getTime() + WAT_OFFSET);

      const dayOfWeek = watNow.getUTCDay();
      const distanceToMonday = (dayOfWeek + 6) % 7;
      const watMondayMidnight = new Date(Date.UTC(
        watNow.getUTCFullYear(),
        watNow.getUTCMonth(),
        watNow.getUTCDate() - distanceToMonday,
        0, 0, 0, 0
      ));
      const weekStart = new Date(watMondayMidnight.getTime() - WAT_OFFSET);

      const txs = await Transaction.find({
        userId,
        category,
        date: { $gte: weekStart, $lte: now },
      });

      const count = txs.length;
      const total = txs.reduce((sum, t) => sum + t.amount, 0);

      return { count, total };
    } catch (e) {
      return { count: 1, total: 0 };
    }
  }

  /**
   * Pass #2: Generate WhatsApp confirmation reply for logged transactions
   */
  async generateLogReply(user: IUser, createdTxs: ITransaction[]): Promise<string> {
    if (!createdTxs || createdTxs.length === 0) return '';

    if (createdTxs.length === 1) {
      const tx = createdTxs[0];
      const formattedAmount = formatCurrency(tx.amount, user.currency || 'NGN');
      const stats = await this.getCategoryWeekStats(String(user._id), tx.category);
      const formattedTotal = formatCurrency(stats.total, user.currency || 'NGN');

      // Attempt LLM Pass #2 if online
      try {
        const userPrompt = `Logged single transaction:
- Type: ${tx.type}
- Amount: ${formattedAmount}
- Category: ${tx.category}
- Description: ${tx.description}
- Category count this week: ${stats.count}
- Category total this week: ${formattedTotal}

Write a short 1-2 line WhatsApp confirmation reply. Include context if count > 1.`;

        const llmReply = await llmService.generateCompletion(userPrompt, PASS2_SYSTEM_PROMPT);
        if (llmReply && !llmReply.includes('{') && llmReply.length < 200) {
          return llmReply.trim();
        }
      } catch (err) {
        logger.warn('LLM Pass #2 failed, using rule-based persona rotator');
      }

      // Rule-based Persona Fallback
      const phrasingVariants = [
        `Got it — *${formattedAmount}* logged under ${tx.category} ✅`,
        `Noted! *${formattedAmount}* for ${tx.category}, today.`,
        `Added that — ${tx.category}, *${formattedAmount}*.`,
        `Logged! *${formattedAmount}* under ${tx.category} ✅`,
      ];

      // Pick variant deterministically or randomly
      const base = phrasingVariants[Math.floor(Math.random() * phrasingVariants.length)];

      if (stats.count > 1) {
        const ordinal = stats.count === 2 ? '2nd' : stats.count === 3 ? '3rd' : `${stats.count}th`;
        return `${base}\nThat's your ${ordinal} ${tx.category.toLowerCase()} item this week — *${formattedTotal}* total so far.`;
      }

      return base;
    } else {
      // Batch items
      let reply = `Logged ${createdTxs.length} items for today ✅\n`;
      for (const tx of createdTxs) {
        reply += `• *${formatCurrency(tx.amount, user.currency)}* — ${tx.category} (${tx.description})\n`;
      }
      return reply.trim();
    }
  }

  /**
   * Generate human clarifying question for missing info
   */
  generateClarifyingQuestion(questionStr: string): string {
    const q = questionStr.toLowerCase();
    if (q.includes('coming in') || q.includes('going out') || q.includes('type')) {
      return 'Money in or money out on this one?';
    }
    if (q.includes('category')) {
      return 'What category should we log this under?';
    }
    if (q.includes('business')) {
      return 'Which of your businesses is this for?';
    }
    return questionStr;
  }
}

export const replyService = new ReplyService();
