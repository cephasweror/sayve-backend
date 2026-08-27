import { User, IUser } from '../models/User';
import { whatsappService } from './whatsapp.service';
import { logger } from '../utils/logger';

export class OnboardingService {
  /**
   * Get or initialize user record
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

        // Send the welcome greeting immediately when a new user first contacts Sayve
        await whatsappService.sendTextMessage(
          phoneNumber,
          `👋 Welcome to *Sayve* — your AI bookkeeping assistant!\n\nI help small business owners track sales and expenses automatically.\n\nTo get started, what is the name of your business?`
        );
      }
      return user;
    } catch (error) {
      logger.error('Error finding/creating user:', error);
      // Fallback in-memory object if DB connection unavailable
      return new User({
        phoneNumber,
        businessName: 'My Business',
        currency: 'NGN',
        onboardingState: 'COMPLETED',
      });
    }
  }

  /**
   * Handle active onboarding state machine steps
   * Returns true if message was consumed by onboarding, false if user has completed setup
   */
  async processOnboardingStep(user: IUser, incomingText: string): Promise<boolean> {
    if (user.onboardingState === 'COMPLETED') {
      return false;
    }

    const trimmedMessage = incomingText.trim();

    if (user.onboardingState === 'AWAITING_BUSINESS_NAME') {
      user.businessName = trimmedMessage;
      user.onboardingState = 'AWAITING_CURRENCY';
      try {
        await user.save();
      } catch (e) {}

      await whatsappService.sendTextMessage(
        user.phoneNumber,
        `Nice to meet you, *${trimmedMessage}*! 🎉\n\nWhat currency do you use? (Reply *NGN* for ₦ Naira, or enter your currency code/symbol)`
      );
      return true;
    }

    if (user.onboardingState === 'AWAITING_CURRENCY') {
      const currencyInput = trimmedMessage.toUpperCase();
      user.currency = currencyInput === 'NGN' || currencyInput === 'NAIRA' || currencyInput === '₦' ? 'NGN' : currencyInput;
      user.onboardingState = 'COMPLETED';
      try {
        await user.save();
      } catch (e) {}

      await whatsappService.sendTextMessage(
        user.phoneNumber,
        `Awesome! Setup complete for *${user.businessName}* (Currency: ${user.currency}). 🚀\n\nYou can now log transactions anytime by sending text messages like:\n• *"sold 3 bags of rice for 45000"*\n• *"spent 5000 on transport"*\n• *"how much did I make this week"*\n• *"send my report"*`
      );
      return true;
    }

    return false;
  }
}

export const onboardingService = new OnboardingService();
