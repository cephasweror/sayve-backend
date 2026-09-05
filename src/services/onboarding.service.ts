import { User, IUser } from '../models/User';
import { whatsappService } from './whatsapp.service';
import { logger } from '../utils/logger';
import { validateCurrency, formatCurrency, QUICK_CURRENCY_OPTIONS, CURRENCIES, CurrencyInfo } from '../utils/currency';

/**
 * NOTE ON THE User MODEL:
 * IUser has been extended with:
 *   onboardingState: 'AWAITING_BUSINESS_NAME' | 'AWAITING_CURRENCY' |
 *                    'AWAITING_CURRENCY_CONFIRM' | 'COMPLETED'
 *   pendingCurrencyCode?: string   // holds the matched code while awaiting confirmation
 */

const WELCOME_MESSAGE =
  `👋 Hi, I'm *Sayve* — your AI bookkeeping assistant.\n\n` +
  `Text me your sales and expenses like you'd tell a friend — "sold 3 bags of rice for 45000" or ` +
  `"spent 5k on fuel" — and I'll keep your books for you. Ask me for a summary or a report anytime.\n\n` +
  `First, what's the name of your business?`;

const INFO_REPLY =
  `Good question! Here's what I do:\n\n` +
  `• You text me sales and expenses in plain language — no forms, no spreadsheets\n` +
  `• I log them automatically and sort them into categories\n` +
  `• Ask me things like "how much did I make this week" and I'll pull a summary\n` +
  `• I can send you a CSV, Excel, or PDF report for any period — a week, a month, a year, or a custom range\n` +
  `• Made a mistake? Just tell me right after and I'll fix it\n\n` +
  `Whenever you're ready — what's the name of your business?`;

// Heuristic for "this looks like a question about the bot, not a business name"
function isQuestionAboutBot(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return false;
  const questionStarters = ['what', 'how', 'who', 'why', 'can you', 'do you', 'are you', 'tell me'];
  const mentionsBot = /\b(you|this|it|sayve|bot|app|work|do)\b/.test(t);
  const looksLikeQuestion = t.endsWith('?') || questionStarters.some(q => t.startsWith(q));
  return looksLikeQuestion && mentionsBot;
}

function isBlankOrUnusable(text: string): boolean {
  const stripped = text.trim().replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
  return stripped.length === 0;
}

export class OnboardingService {
  /**
   * Get or initialize user record.
   */
  async getOrCreateUser(phoneNumber: string): Promise<IUser> {
    try {
      let user = await User.findOne({ phoneNumber });
      if (!user) {
        user = await User.create({
          phoneNumber,
          businessName: 'My Business',
          currency: 'NGN',
          onboardingState: 'AWAITING_BUSINESS_NAME',
        });
        logger.info(`Created new user record for ${phoneNumber}`);
        await whatsappService.sendTextMessage(phoneNumber, WELCOME_MESSAGE);
      }
      return user;
    } catch (error) {
      logger.error('Error finding/creating user:', error);
      // Fallback in-memory object if DB connection unavailable.
      return new User({
        phoneNumber,
        businessName: 'My Business',
        currency: 'NGN',
        onboardingState: 'COMPLETED',
      });
    }
  }

  /**
   * Handle active onboarding state machine steps.
   * Returns true if the message was consumed by onboarding, false if the
   * user has completed setup and the message should flow to normal intent
   * handling instead.
   */
  async processOnboardingStep(user: IUser, incomingText: string): Promise<boolean> {
    if (user.onboardingState === 'COMPLETED') {
      return false;
    }

    const trimmedMessage = incomingText.trim();

    if (user.onboardingState === 'AWAITING_BUSINESS_NAME') {
      return this.handleAwaitingBusinessName(user, trimmedMessage);
    }

    if (user.onboardingState === 'AWAITING_CURRENCY') {
      return this.handleAwaitingCurrency(user, trimmedMessage);
    }

    if (user.onboardingState === 'AWAITING_CURRENCY_CONFIRM') {
      return this.handleAwaitingCurrencyConfirm(user, trimmedMessage);
    }

    return false;
  }

  /**
   * Handles a button-tap payload during onboarding (currency confirm/retry,
   * or a quick-pick currency button). Call this from your webhook handler
   * when the incoming payload is an interactive.button_reply, instead of
   * processOnboardingStep, while onboarding is still in progress.
   */
  async processOnboardingButton(user: IUser, buttonId: string): Promise<boolean> {
    if (user.onboardingState === 'AWAITING_CURRENCY_CONFIRM') {
      if (buttonId === 'currency_confirm') {
        return this.finalizeCurrency(user, user.pendingCurrencyCode || user.currency || 'NGN');
      }
      if (buttonId === 'currency_retry') {
        user.pendingCurrencyCode = undefined;
        user.onboardingState = 'AWAITING_CURRENCY';
        await this.trySave(user);
        await whatsappService.sendTextMessage(
          user.phoneNumber,
          `No problem — what currency do you use? You can type the code (USD), the name (dollars), or the symbol ($).`
        );
        return true;
      }
    }

    if (user.onboardingState === 'AWAITING_CURRENCY' && buttonId.startsWith('currency_pick_')) {
      const code = buttonId.replace('currency_pick_', '');
      return this.handleAwaitingCurrency(user, code);
    }

    return false;
  }

  private async handleAwaitingBusinessName(user: IUser, trimmedMessage: string): Promise<boolean> {
    if (isQuestionAboutBot(trimmedMessage)) {
      await whatsappService.sendTextMessage(user.phoneNumber, INFO_REPLY);
      return true; // stay in AWAITING_BUSINESS_NAME, don't save anything
    }

    if (isBlankOrUnusable(trimmedMessage)) {
      await whatsappService.sendTextMessage(
        user.phoneNumber,
        `I didn't quite catch a business name there — what should I call your business?`
      );
      return true;
    }

    user.businessName = trimmedMessage;
    user.onboardingState = 'AWAITING_CURRENCY';
    const saved = await this.trySave(user);
    if (!saved) {
      await whatsappService.sendTextMessage(
        user.phoneNumber,
        `Sorry, something went wrong on my end saving that — could you send your business name again?`
      );
      user.onboardingState = 'AWAITING_BUSINESS_NAME';
      return true;
    }

    await whatsappService.sendButtonMessage(
      user.phoneNumber,
      `Nice to meet you, *${trimmedMessage}*! 🎉\n\nWhat currency do you use? Pick one below, or just type it (code, name, or symbol all work).`,
      QUICK_CURRENCY_OPTIONS.map(code => ({
        id: `currency_pick_${code}`,
        title: code,
      }))
    );
    return true;
  }

  private async handleAwaitingCurrency(user: IUser, trimmedMessage: string): Promise<boolean> {
    const match = validateCurrency(trimmedMessage);

    if (!match) {
      await whatsappService.sendButtonMessage(
        user.phoneNumber,
        `I couldn't match "${trimmedMessage}" to a currency I recognize. Try one of these, or type your currency's code (e.g. "EUR"), name, or symbol:`,
        QUICK_CURRENCY_OPTIONS.map(code => ({
          id: `currency_pick_${code}`,
          title: code,
        }))
      );
      return true;
    }

    user.pendingCurrencyCode = match.code;
    user.onboardingState = 'AWAITING_CURRENCY_CONFIRM';
    const saved = await this.trySave(user);
    if (!saved) {
      await whatsappService.sendTextMessage(
        user.phoneNumber,
        `Sorry, something went wrong on my end — could you send your currency again?`
      );
      user.onboardingState = 'AWAITING_CURRENCY';
      return true;
    }

    await whatsappService.sendButtonMessage(
      user.phoneNumber,
      `Got it — using *${formatCurrency(match)}*. Is that right?`,
      [
        { id: 'currency_confirm', title: 'Confirm' },
        { id: 'currency_retry', title: 'Try Again' },
      ]
    );
    return true;
  }

  private async handleAwaitingCurrencyConfirm(user: IUser, trimmedMessage: string): Promise<boolean> {
    const t = trimmedMessage.toLowerCase();
    if (['yes', 'y', 'confirm', 'correct', 'yeah', 'yep'].includes(t)) {
      return this.finalizeCurrency(user, user.pendingCurrencyCode || user.currency || 'NGN');
    }
    if (['no', 'n', 'wrong', 'nope', 'try again'].includes(t)) {
      user.pendingCurrencyCode = undefined;
      user.onboardingState = 'AWAITING_CURRENCY';
      await this.trySave(user);
      await whatsappService.sendTextMessage(
        user.phoneNumber,
        `No problem — what currency do you use?`
      );
      return true;
    }

    const pendingCode = user.pendingCurrencyCode || user.currency || 'NGN';
    const currencyInfo: CurrencyInfo = validateCurrency(pendingCode) || {
      code: pendingCode,
      name: pendingCode,
      symbol: pendingCode,
    };

    // Anything else while awaiting confirmation: re-prompt rather than guess.
    await whatsappService.sendButtonMessage(
      user.phoneNumber,
      `Just checking — should I use *${formatCurrency(currencyInfo)}*?`,
      [
        { id: 'currency_confirm', title: 'Confirm' },
        { id: 'currency_retry', title: 'Try Again' },
      ]
    );
    return true;
  }

  private async finalizeCurrency(user: IUser, currencyCode: string): Promise<boolean> {
    user.currency = currencyCode;
    user.pendingCurrencyCode = undefined;
    user.onboardingState = 'COMPLETED';
    const saved = await this.trySave(user);
    if (!saved) {
      await whatsappService.sendTextMessage(
        user.phoneNumber,
        `Sorry, something went wrong finishing setup — mind confirming your currency again?`
      );
      user.onboardingState = 'AWAITING_CURRENCY_CONFIRM';
      return true;
    }

    const currencyInfo: CurrencyInfo = validateCurrency(currencyCode) || {
      code: currencyCode,
      name: currencyCode,
      symbol: currencyCode,
    };

    await whatsappService.sendTextMessage(
      user.phoneNumber,
      `All set for *${user.businessName}* — logging in ${formatCurrency(currencyInfo)}. 🚀\n\n` +
      `Go ahead — text me your first sale or expense right now, like "sold 3 bags of rice for 45000" or "spent 5k on fuel."\n\n` +
      `Made a mistake? Just tell me right after and I'll fix it. You can change your currency anytime by saying "change my currency."`
    );
    return true;
  }

  /** Saves the user document, retrying once on failure. Returns success. */
  private async trySave(user: IUser): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await user.save();
        return true;
      } catch (error) {
        logger.error(
          `Failed to save user ${user.phoneNumber} on attempt ${attempt + 1}:`,
          error
        );
      }
    }
    return false;
  }
}

export const onboardingService = new OnboardingService();