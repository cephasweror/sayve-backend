import { Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { onboardingService } from '../services/onboarding.service';
import { parserService } from '../services/parser.service';
import { summaryService } from '../services/summary.service';
import { exportService } from '../services/export.service';
import { whatsappService } from '../services/whatsapp.service';
import { audioService } from '../services/audio.service';
import { imageService } from '../services/image.service';
import { Transaction } from '../models/Transaction';
import { formatCurrency } from '../utils/formatters';

const HELP_MESSAGE =
  '📖 *Sayve Commands*\n\n' +
  '*Log income:*\n• "sold 3 bags of rice for 45000"\n\n' +
  '*Log expense:*\n• "spent 5000 on transport"\n\n' +
  '*Fix category:*\n• "no, it\'s Rent"\n\n' +
  '*Financial summary:*\n• "how much did I make this week"\n• "show my expenses this month"\n\n' +
  '*Export report:*\n• "send my report"\n\n' +
  '*Voice notes:* Just record and send a voice note describing your day! 🎙️\n\n' +
  '*Receipt photos:* Send a photo of a receipt or written note! 📷';

export class WebhookController {
  /**
   * GET /webhook - Meta Webhook Verification
   */
  verifyWebhook(req: Request, res: Response): void {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    logger.info(`Received Meta Webhook verification request. Mode: ${mode}, Token match: ${token === env.WHATSAPP_VERIFY_TOKEN}`);

    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
      logger.info('✅ Meta Webhook verified successfully!');
      res.status(200).send(challenge);
    } else {
      logger.warn('❌ Meta Webhook verification failed. Token mismatch.');
      res.sendStatus(403);
    }
  }

  /**
   * POST /webhook - Handle incoming WhatsApp messages
   */
  async handleIncomingMessage(req: Request, res: Response): Promise<void> {
    // Meta requires 200 OK immediately to acknowledge receipt
    res.status(200).send('EVENT_RECEIVED');

    try {
      const body = req.body;

      if (!body.object || body.object !== 'whatsapp_business_account') {
        return;
      }

      const entry = body.entry?.[0];
      const change = entry?.changes?.[0]?.value;
      const message = change?.messages?.[0];

      if (!message) {
        // Status update or non-message event
        return;
      }

      const senderPhone = message.from;
      const messageType = message.type;

      logger.info(`Incoming WhatsApp message from ${senderPhone} (type: ${messageType})`);

      let incomingText = '';

      if (messageType === 'audio') {
        // ── Voice Note Handler ──────────────────────────────────────────
        const audioMediaId: string = message.audio?.id;
        if (!audioMediaId) {
          logger.warn(`Received audio message from ${senderPhone} but no media ID found.`);
          await whatsappService.sendTextMessage(
            senderPhone,
            '⚠️ Could not retrieve your voice note. Please try recording and sending it again.'
          );
          return;
        }

        logger.info(`Processing voice note (media ID: ${audioMediaId}) from ${senderPhone}...`);
        await whatsappService.sendTextMessage(
          senderPhone,
          '🎙️ Got your voice note! Transcribing...'
        );

        // Download the audio buffer from Meta
        const audioBuffer = await whatsappService.downloadAudioBuffer(audioMediaId);
        if (!audioBuffer) {
          await whatsappService.sendTextMessage(
            senderPhone,
            '⚠️ I had trouble downloading your voice note. Please try again or type your transaction instead.'
          );
          return;
        }

        // Transcribe with Groq Whisper
        const transcript = await audioService.transcribeAudio(audioBuffer, message.audio?.mime_type || 'audio/ogg');
        if (!transcript) {
          await whatsappService.sendTextMessage(
            senderPhone,
            '🔇 I could not hear that clearly. Please send a clearer voice note, or type your transaction instead.'
          );
          return;
        }

        logger.info(`Transcript from voice note: "${transcript.substring(0, 100)}"`);
        incomingText = transcript;

      } else if (messageType === 'image') {
        // ── Receipt / Image Photo Handler ──────────────────────────────
        const imageMediaId: string = message.image?.id;
        if (!imageMediaId) {
          logger.warn(`Received image message from ${senderPhone} but no media ID found.`);
          await whatsappService.sendTextMessage(
            senderPhone,
            '⚠️ Could not retrieve your receipt photo. Please try sending it again.'
          );
          return;
        }

        logger.info(`Processing receipt photo (media ID: ${imageMediaId}) from ${senderPhone}...`);
        await whatsappService.sendTextMessage(
          senderPhone,
          '📷 Reading your receipt photo...'
        );

        // Download the image buffer from Meta
        const imageBuffer = await whatsappService.downloadImageBuffer(imageMediaId);
        if (!imageBuffer) {
          await whatsappService.sendTextMessage(
            senderPhone,
            '⚠️ I had trouble downloading your receipt photo. Please try again or type your transaction instead.'
          );
          return;
        }

        // Analyze image using Gemini Flash Vision
        const analyzedText = await imageService.analyzeReceiptImage(imageBuffer, message.image?.mime_type || 'image/jpeg');
        if (!analyzedText) {
          await whatsappService.sendTextMessage(
            senderPhone,
            '🔍 I could not read clear transaction details from that photo. Please make sure the text/amounts are clear, or type the transaction instead.'
          );
          return;
        }

        logger.info(`Extracted text from receipt image: "${analyzedText.substring(0, 100)}"`);
        incomingText = analyzedText;

      } else if (messageType === 'text') {
        incomingText = message.text?.body || '';

      } else {
        // Video, sticker, reaction, document, etc.
        await whatsappService.sendTextMessage(
          senderPhone,
          '📝 Sayve supports *text messages*, *voice notes*, and *receipt photos*. Send a voice note, photo, or type a transaction like *"sold rice for 5000"*.'
        );
        return;
      }

      if (!incomingText.trim()) return;

      // 1. Get or create user record
      const user = await onboardingService.getOrCreateUser(senderPhone);

      // 2. Check if user is in onboarding flow
      const isOnboardingConsumed = await onboardingService.processOnboardingStep(user, incomingText);
      if (isOnboardingConsumed) {
        return;
      }

      // 3. Check for help command before LLM parsing (cheap shortcut)
      const lowerText = incomingText.trim().toLowerCase();
      if (lowerText === 'help' || lowerText === '?' || lowerText === 'commands') {
        await whatsappService.sendTextMessage(senderPhone, HELP_MESSAGE);
        return;
      }

      // 4. Parse intent and structured transaction using LLM
      const intent = await parserService.parseUserMessage(incomingText);

      if (!intent) {
        await whatsappService.sendTextMessage(
          senderPhone,
          '🤔 I could not understand that. Try: *"sold 3 bags of rice for 45000"*, *"spent 5000 on transport"*, or type *"help"* to see all commands.'
        );
        return;
      }

      // 5. Intent Routing
      // Option A: Category Correction (e.g., "no, it's Rent")
      if (intent.isCorrection) {
        if (!user.lastTransactionId) {
          await whatsappService.sendTextMessage(senderPhone, '⚠️ No recent transaction found to correct.');
          return;
        }

        const lastTx = await Transaction.findById(user.lastTransactionId);
        if (lastTx && intent.correctedCategory) {
          const oldCat = lastTx.category;
          lastTx.category = intent.correctedCategory as any;
          await lastTx.save();

          await whatsappService.sendTextMessage(
            senderPhone,
            `✏️ Category updated for *${lastTx.description}* from ${oldCat} ➡️ *${lastTx.category}*.`
          );
          return;
        }
      }

      // Option B: Financial Summary Query
      if (intent.isSummaryQuery) {
        const summaryText = await summaryService.getSummary(user, intent.queryPeriod);
        await whatsappService.sendTextMessage(senderPhone, summaryText);
        return;
      }

      // Option C: CSV Data Export Request
      if (intent.isExportRequest) {
        await whatsappService.sendTextMessage(senderPhone, '⏳ Generating your 30-day transaction report CSV...');
        await exportService.exportAndSendReport(user);
        return;
      }

      // Option D: Log Transaction
      if (intent.isTransaction && intent.amount && intent.amount > 0) {
        const tx = await Transaction.create({
          userId: user._id,
          phoneNumber: senderPhone,
          type: intent.type || 'income',
          amount: intent.amount,
          category: intent.category || 'Other',
          description: intent.description || incomingText,
          rawMessage: incomingText,
          date: new Date(),
        });

        // Store last transaction ID for correction tracking
        user.lastTransactionId = tx._id as any;
        try {
          await user.save();
        } catch (e) {}

        const formattedAmount = formatCurrency(tx.amount, user.currency);
        const typeLabel = tx.type === 'income' ? 'income' : 'expense';

        await whatsappService.sendTextMessage(
          senderPhone,
          `✅ Logged: *${formattedAmount} ${typeLabel}* — ${tx.category} (${tx.description}).`
        );
        return;
      }

      // Fallback response
      await whatsappService.sendTextMessage(
        senderPhone,
        'ℹ️ I could not find a clear transaction or command. You can log income/expenses, ask *"how much did I make this week"*, or reply *"send my report"*.'
      );
    } catch (error) {
      logger.error('Error handling webhook POST:', error);
    }
  }
}

export const webhookController = new WebhookController();
