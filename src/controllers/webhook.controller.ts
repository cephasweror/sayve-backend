import { Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { onboardingService } from '../services/onboarding.service';
import { parserService } from '../services/parser.service';
import { pipelineService } from '../services/pipeline.service';
import { summaryService } from '../services/summary.service';
import { exportService } from '../services/export.service';
import { whatsappService } from '../services/whatsapp.service';
import { audioService } from '../services/audio.service';
import { imageService } from '../services/image.service';
import { Transaction } from '../models/Transaction';
import { formatCurrency } from '../utils/formatters';
import { replyService } from '../services/reply.service';

const HELP_MESSAGE =
  '📖 *Sayve Commands*\n\n' +
  '*Log income:*\n• "sold 3 bags of rice for 45000"\n\n' +
  '*Log expense:*\n• "spent 5000 on transport"\n\n' +
  '*Fix category / transaction:*\n• "no, it\'s Rent"\n• "I meant 15000 not 5000"\n\n' +
  '*Financial summary:*\n• "how much did I make this week"\n• "show my expenses this month"\n\n' +
  '*Export report (Excel/PDF/CSV):*\n• "send my report"\n• "export pdf report"\n\n' +
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
   * POST /webhook - Handle incoming WhatsApp messages via 2-stage pipeline
   */
  async handleIncomingMessage(req: Request, res: Response): Promise<void> {
    // Meta requires 200 OK immediately to acknowledge receipt
    res.status(200).send('EVENT_RECEIVED');

    let senderPhone = '';
    try {
      const body = req.body;

      if (!body.object || body.object !== 'whatsapp_business_account') {
        return;
      }

      const entry = body.entry?.[0];
      const change = entry?.changes?.[0]?.value;
      const message = change?.messages?.[0];

      if (!message) {
        return;
      }

      senderPhone = message.from || '';
      const messageType = message.type;

      logger.info(`Incoming WhatsApp message from ${senderPhone} (type: ${messageType})`);

      let incomingText = '';
      let buttonId: string | null = null;

      if (messageType === 'interactive') {
        const interactive = message.interactive;
        if (interactive?.type === 'button_reply') {
          buttonId = interactive.button_reply?.id || null;
          incomingText = interactive.button_reply?.title || buttonId || '';
        } else if (interactive?.type === 'list_reply') {
          buttonId = interactive.list_reply?.id || null;
          incomingText = interactive.list_reply?.title || buttonId || '';
        }
      } else if (messageType === 'audio') {
        // Voice Note Handler
        const audioMediaId: string = message.audio?.id;
        if (!audioMediaId) {
          await whatsappService.sendTextMessage(senderPhone, '⚠️ Could not retrieve your voice note. Please try again.');
          return;
        }

        await whatsappService.sendTextMessage(senderPhone, '🎙️ Got your voice note! Transcribing...');
        const audioBuffer = await whatsappService.downloadAudioBuffer(audioMediaId);
        if (!audioBuffer) {
          await whatsappService.sendTextMessage(senderPhone, '⚠️ I had trouble downloading your voice note. Please try typing instead.');
          return;
        }

        const transcript = await audioService.transcribeAudio(audioBuffer, message.audio?.mime_type || 'audio/ogg');
        if (!transcript) {
          await whatsappService.sendTextMessage(senderPhone, '🔇 I could not hear that clearly. Please send a clearer voice note.');
          return;
        }

        incomingText = transcript;

      } else if (messageType === 'image') {
        // Receipt Photo Handler
        const imageMediaId: string = message.image?.id;
        if (!imageMediaId) {
          await whatsappService.sendTextMessage(senderPhone, '⚠️ Could not retrieve your receipt photo. Please try again.');
          return;
        }

        await whatsappService.sendTextMessage(senderPhone, '📷 Reading your receipt photo...');
        const imageBuffer = await whatsappService.downloadImageBuffer(imageMediaId);
        if (!imageBuffer) {
          await whatsappService.sendTextMessage(senderPhone, '⚠️ I had trouble downloading your receipt photo.');
          return;
        }

        const analyzedText = await imageService.analyzeReceiptImage(imageBuffer, message.image?.mime_type || 'image/jpeg');
        if (!analyzedText) {
          await whatsappService.sendTextMessage(senderPhone, '🔍 I could not read clear transaction details from that photo.');
          return;
        }

        incomingText = analyzedText;

      } else if (messageType === 'text') {
        incomingText = message.text?.body || '';

      } else {
        await whatsappService.sendTextMessage(
          senderPhone,
          '📝 Sayve supports *text messages*, *voice notes*, and *receipt photos*. Type a transaction like *"sold rice for 5000"*.'
        );
        return;
      }

      if (!incomingText.trim() && !buttonId) return;

      // 1. Get or create user record
      const user = await onboardingService.getOrCreateUser(senderPhone);

      // 2. Check onboarding state
      const isOnboardingConsumed = await onboardingService.processOnboardingStep(user, incomingText);
      if (isOnboardingConsumed) {
        return;
      }

      // 3. Help shortcut
      const lowerText = incomingText.trim().toLowerCase();
      if (lowerText === 'help' || lowerText === '?' || lowerText === 'commands') {
        await whatsappService.sendTextMessage(senderPhone, HELP_MESSAGE);
        return;
      }

      // 4. DIRECT ROUTING FOR BUTTON REPLIES & PENDING CLARIFICATION
      if (buttonId || user.pendingClarification) {
        // Case A: Export Format Selection
        if (buttonId === 'btn_fmt_csv' || buttonId === 'btn_fmt_excel' || buttonId === 'btn_fmt_pdf' || (user.pendingClarification?.type === 'export_format')) {
          let fmt: 'excel' | 'pdf' | 'csv' = 'excel';
          if (buttonId === 'btn_fmt_csv' || lowerText.includes('csv')) fmt = 'csv';
          else if (buttonId === 'btn_fmt_pdf' || lowerText.includes('pdf')) fmt = 'pdf';
          else if (buttonId === 'btn_fmt_excel' || lowerText.includes('excel')) fmt = 'excel';

          user.pendingClarification = null;
          await user.save();

          await whatsappService.sendTextMessage(senderPhone, `⏳ Generating your transaction report (${fmt.toUpperCase()})...`);
          await exportService.exportAndSendReport(user, fmt, '30 Days');
          return;
        }

        // Case B: Income vs Expense Clarification
        if (buttonId === 'btn_money_in' || buttonId === 'btn_money_out' || (user.pendingClarification?.type === 'transaction_type')) {
          const partial = user.pendingClarification?.partialData || {};
          let type: 'income' | 'expense' | null = partial.type || null;

          if (buttonId === 'btn_money_in' || lowerText.includes('income') || lowerText.includes('money in') || lowerText.includes('sold') || lowerText.includes('sale') || lowerText.includes('in')) {
            type = 'income';
          } else if (buttonId === 'btn_money_out' || lowerText.includes('expense') || lowerText.includes('money out') || lowerText.includes('spent') || lowerText.includes('buy') || lowerText.includes('out')) {
            type = 'expense';
          }

          let amount = partial.amount;
          if (!amount) {
            const nums = incomingText.match(/\d+[\d,]*/g);
            if (nums?.length) amount = parseInt(nums[0].replace(/,/g, ''), 10);
          }

          if (type && amount) {
            const tx = await Transaction.create({
              userId: user._id,
              phoneNumber: senderPhone,
              type,
              amount,
              category: partial.category || (type === 'income' ? 'Sales' : 'Other'),
              description: partial.description || incomingText,
              rawMessage: incomingText,
              businessName: user.businessName,
              date: new Date(),
            });

            user.pendingClarification = null;
            user.lastTransactionId = tx._id as any;
            await user.save();

            const replyText = await replyService.generateLogReply(user, [tx]);
            await whatsappService.sendTextMessage(senderPhone, replyText);
            return;
          }
        }

        // Case C: Report Period Selection
        if (buttonId === 'btn_period_today' || buttonId === 'btn_period_week' || buttonId === 'btn_period_month' || (user.pendingClarification?.type === 'period')) {
          let period: 'today' | 'week' | 'month' = 'month';
          if (buttonId === 'btn_period_today' || lowerText.includes('today')) period = 'today';
          else if (buttonId === 'btn_period_week' || lowerText.includes('week')) period = 'week';
          else if (buttonId === 'btn_period_month' || lowerText.includes('month')) period = 'month';

          user.pendingClarification = null;
          await user.save();

          const summaryText = await summaryService.getSummary(user, period);
          await whatsappService.sendTextMessage(senderPhone, summaryText);
          return;
        }

        // Case E: Currency Change Button Reply
        if (buttonId === 'btn_curr_ngn' || buttonId === 'btn_curr_usd' || buttonId === 'btn_curr_eur' || user.pendingClarification?.type === 'currency_change') {
          let newCurr = 'NGN';
          if (buttonId === 'btn_curr_usd' || lowerText.includes('usd') || lowerText.includes('dollar')) newCurr = 'USD';
          else if (buttonId === 'btn_curr_eur' || lowerText.includes('eur') || lowerText.includes('euro')) newCurr = 'EUR';
          else if (buttonId === 'btn_curr_ngn' || lowerText.includes('ngn') || lowerText.includes('naira')) newCurr = 'NGN';
          else if (incomingText.trim()) newCurr = incomingText.trim().toUpperCase();

          user.currency = newCurr;
          user.pendingClarification = null;
          await user.save();

          await whatsappService.sendTextMessage(senderPhone, `⚙️ Currency updated to *${user.currency}* ✅`);
          return;
        }

        // Case F: Business Name Change Reply
        if (user.pendingClarification?.type === 'business_name_change') {
          if (incomingText.trim()) {
            user.businessName = incomingText.trim();
            user.pendingClarification = null;
            await user.save();
            await whatsappService.sendTextMessage(senderPhone, `⚙️ Business name updated to *${user.businessName}* ✅`);
            return;
          }
        }

        // Case D: Category Confirmation Button
        if (buttonId && buttonId.startsWith('btn_cat_')) {
          const catName = buttonId.replace('btn_cat_', '');
          const partial = user.pendingClarification?.partialData || {};
          const type = partial.type || 'expense';
          const amount = partial.amount || 0;

          if (amount > 0) {
            const tx = await Transaction.create({
              userId: user._id,
              phoneNumber: senderPhone,
              type,
              amount,
              category: catName,
              description: partial.description || incomingText,
              rawMessage: incomingText,
              businessName: user.businessName,
              date: new Date(),
            });

            user.pendingClarification = null;
            user.lastTransactionId = tx._id as any;
            await user.save();

            const replyText = await replyService.generateLogReply(user, [tx]);
            await whatsappService.sendTextMessage(senderPhone, replyText);
            return;
          }
        }
      }

      // 5. Stage 1 & Stage 2 Pipeline Parsing
      const knownCategories = (await Transaction.distinct('category', { userId: user._id })) as string[];
      const context = {
        business_name: user.businessName || null,
        known_categories: knownCategories.length ? knownCategories : ['Sales', 'Inventory', 'Transport', 'Utilities', 'Salaries', 'Rent', 'Food', 'Fuel', 'Other'],
        today_date: new Date().toISOString().split('T')[0],
        is_batch: messageType === 'image',
        pendingClarification: user.pendingClarification,
      };

      const parsed = await parserService.parseUserMessage(incomingText, context);

      if (!parsed) {
        await whatsappService.sendTextMessage(
          senderPhone,
          '🤔 I could not understand that. Try: *"sold 3 bags of rice for 45000"*, *"spent 5000 on transport"*, or type *"help"*.'
        );
        return;
      }

      // Route Option 0: Greeting Handler
      if (parsed.isGreeting) {
        const greetingMsg = replyService.generateGreetingReply(user);
        await whatsappService.sendTextMessage(senderPhone, greetingMsg);
        return;
      }

      // Route Option 00: Transaction Deletion / Undo Handler
      if (parsed.isDeleteLastTx) {
        if (!user.lastTransactionId) {
          await whatsappService.sendTextMessage(senderPhone, '⚠️ No recent transaction found to delete.');
          return;
        }

        const lastTx = await Transaction.findByIdAndDelete(user.lastTransactionId);
        user.lastTransactionId = undefined;
        await user.save();

        if (lastTx) {
          await whatsappService.sendTextMessage(
            senderPhone,
            `🗑️ Deleted: *${lastTx.description}* (${formatCurrency(lastTx.amount, user.currency || 'NGN')}) ✅`
          );
        } else {
          await whatsappService.sendTextMessage(senderPhone, '⚠️ No recent transaction found to delete.');
        }
        return;
      }

      // Route Option 000: Settings Management Handler
      if (parsed.isSettingsChange) {
        if (parsed.settingsType === 'currency') {
          if (parsed.newSettingValue) {
            user.currency = parsed.newSettingValue;
            await user.save();
            await whatsappService.sendTextMessage(senderPhone, `⚙️ Currency updated to *${user.currency}* ✅`);
          } else {
            user.pendingClarification = { type: 'currency_change', askedAt: new Date() };
            await user.save();
            await whatsappService.sendButtonMessage(senderPhone, '⚙️ Which currency would you like to set?', [
              { id: 'btn_curr_ngn', title: 'NGN (₦)' },
              { id: 'btn_curr_usd', title: 'USD ($)' },
              { id: 'btn_curr_eur', title: 'EUR (€)' },
            ]);
          }
          return;
        } else if (parsed.settingsType === 'business_name') {
          if (parsed.newSettingValue) {
            user.businessName = parsed.newSettingValue;
            await user.save();
            await whatsappService.sendTextMessage(senderPhone, `⚙️ Business name updated to *${user.businessName}* ✅`);
          } else {
            user.pendingClarification = { type: 'business_name_change', askedAt: new Date() };
            await user.save();
            await whatsappService.sendTextMessage(senderPhone, '⚙️ What is your new business name?');
          }
          return;
        }
      }

      // Route Option A: Needs Clarification (Set pending state in DB & send interactive buttons if applicable)
      if (parsed.needs_clarification && parsed.clarification_question) {
        const item = parsed.items[0];
        user.pendingClarification = {
          type: 'transaction_type',
          partialData: {
            amount: item?.amount || null,
            description: item?.description || incomingText,
            type: item?.type || null,
            category: item?.category || null,
          },
          askedAt: new Date(),
        };
        await user.save();

        const humanQuestion = replyService.generateClarifyingQuestion(parsed.clarification_question);
        logger.info(`Saved pending clarification for ${senderPhone}. Question: "${humanQuestion}"`);

        // Send quick reply buttons for money in / money out if income/expense is ambiguous
        if (humanQuestion.toLowerCase().includes('money in or money out')) {
          await whatsappService.sendButtonMessage(senderPhone, `❓ ${humanQuestion}`, [
            { id: 'btn_money_in', title: 'Money In' },
            { id: 'btn_money_out', title: 'Money Out' },
          ]);
        } else {
          await whatsappService.sendTextMessage(senderPhone, `❓ ${humanQuestion}`);
        }
        return;
      }

      // Route Option B: Correction Handler (Stage 2b diff update)
      if (parsed.isCorrection) {
        if (!user.lastTransactionId) {
          await whatsappService.sendTextMessage(senderPhone, '⚠️ No recent transaction found to correct.');
          return;
        }

        const lastTx = await Transaction.findById(user.lastTransactionId);
        if (lastTx) {
          const diff = await pipelineService.handleCorrection(incomingText, lastTx);

          if (parsed.correctedCategory) lastTx.category = parsed.correctedCategory;
          if (diff.category) lastTx.category = diff.category;
          if (diff.amount) lastTx.amount = diff.amount;
          if (diff.type) lastTx.type = diff.type;
          if (diff.description) lastTx.description = diff.description;

          await lastTx.save();

          await whatsappService.sendTextMessage(
            senderPhone,
            `✏️ Updated: *${lastTx.description}* (${formatCurrency(lastTx.amount, user.currency || 'NGN')}, ${lastTx.category}) ✅`
          );
          return;
        }
      }

      // Route Option C: Financial Summary Query
      if (parsed.isSummaryQuery) {
        const summaryText = await summaryService.getSummary(
          user,
          parsed.queryPeriod,
          parsed.startDate,
          parsed.endDate,
          parsed.periodLabel
        );
        await whatsappService.sendTextMessage(senderPhone, summaryText);
        return;
      }

      // Route Option D: Export Report Request (Excel default, PDF or CSV if specified, ask format via buttons if unspecified)
      if (parsed.isExportRequest) {
        let format = parsed.exportFormat || 'unspecified';

        if (format === 'unspecified') {
          user.pendingClarification = {
            type: 'export_format',
            askedAt: new Date(),
          };
          await user.save();

          await whatsappService.sendButtonMessage(
            senderPhone,
            '📊 Which format would you like for your financial report?',
            [
              { id: 'btn_fmt_csv', title: 'CSV' },
              { id: 'btn_fmt_excel', title: 'Excel' },
              { id: 'btn_fmt_pdf', title: 'PDF' },
            ]
          );
          return;
        }

        const periodLabel = parsed.periodLabel || '30 Days';
        await whatsappService.sendTextMessage(senderPhone, `⏳ Generating your transaction report (${format.toUpperCase()}, ${periodLabel})...`);
        await exportService.exportAndSendReport(user, format, periodLabel, parsed.startDate, parsed.endDate);
        return;
      }

      // Route Option E: Log Transactions (Single or Batch)
      const validItems = parsed.items.filter(item => item.amount !== null && item.amount > 0);

      if (validItems.length > 0) {
        const createdTxs = [];

        for (const item of validItems) {
          const txDate = item.date ? new Date(item.date) : new Date();
          const tx = await Transaction.create({
            userId: user._id,
            phoneNumber: senderPhone,
            type: item.type || 'income',
            amount: item.amount!,
            category: item.category || (item.type === 'income' ? 'Sales' : 'Other'),
            description: item.description || incomingText,
            rawMessage: incomingText,
            businessName: item.business_name || user.businessName,
            date: isNaN(txDate.getTime()) ? new Date() : txDate,
          });
          createdTxs.push(tx);
        }

        if (createdTxs.length > 0) {
          user.lastTransactionId = createdTxs[createdTxs.length - 1]._id as any;
          user.pendingClarification = null; // Clear pending state on clean log
          try {
            await user.save();
          } catch (e) {}
        }

        const replyText = await replyService.generateLogReply(user, createdTxs);
        await whatsappService.sendTextMessage(senderPhone, replyText);
        return;
      }

      // Fallback response
      await whatsappService.sendTextMessage(
        senderPhone,
        'ℹ️ I could not find a clear transaction or command. You can log income/expenses, ask *"how much did I make this week"*, or reply *"send my report"*.'
      );
    } catch (error: any) {
      logger.error(`Error processing incoming message from ${senderPhone}:`, error?.message || error);
      try {
        await whatsappService.sendTextMessage(
          senderPhone,
          "Sorry, I'm having trouble processing that right now — please try again in a moment."
        );
      } catch (replyError) {
        logger.error('Failed to send error fallback WhatsApp message:', replyError);
      }
    }
  }
}

export const webhookController = new WebhookController();
