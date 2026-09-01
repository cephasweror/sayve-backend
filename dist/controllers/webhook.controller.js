"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookController = exports.WebhookController = void 0;
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
const onboarding_service_1 = require("../services/onboarding.service");
const parser_service_1 = require("../services/parser.service");
const summary_service_1 = require("../services/summary.service");
const export_service_1 = require("../services/export.service");
const whatsapp_service_1 = require("../services/whatsapp.service");
const audio_service_1 = require("../services/audio.service");
const image_service_1 = require("../services/image.service");
const Transaction_1 = require("../models/Transaction");
const reply_service_1 = require("../services/reply.service");
const HELP_MESSAGE = '📖 *Sayve Commands*\n\n' +
    '*Log income:*\n• "sold 3 bags of rice for 45000"\n\n' +
    '*Log expense:*\n• "spent 5000 on transport"\n\n' +
    '*Fix category:*\n• "no, it\'s Rent"\n\n' +
    '*Financial summary:*\n• "how much did I make this week"\n• "show my expenses this month"\n\n' +
    '*Export report:*\n• "send my report"\n\n' +
    '*Voice notes:* Just record and send a voice note describing your day! 🎙️\n\n' +
    '*Receipt photos:* Send a photo of a receipt or written note! 📷';
class WebhookController {
    /**
     * GET /webhook - Meta Webhook Verification
     */
    verifyWebhook(req, res) {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        logger_1.logger.info(`Received Meta Webhook verification request. Mode: ${mode}, Token match: ${token === env_1.env.WHATSAPP_VERIFY_TOKEN}`);
        if (mode === 'subscribe' && token === env_1.env.WHATSAPP_VERIFY_TOKEN) {
            logger_1.logger.info('✅ Meta Webhook verified successfully!');
            res.status(200).send(challenge);
        }
        else {
            logger_1.logger.warn('❌ Meta Webhook verification failed. Token mismatch.');
            res.sendStatus(403);
        }
    }
    /**
     * POST /webhook - Handle incoming WhatsApp messages
     */
    async handleIncomingMessage(req, res) {
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
            logger_1.logger.info(`Incoming WhatsApp message from ${senderPhone} (type: ${messageType})`);
            let incomingText = '';
            if (messageType === 'audio') {
                // ── Voice Note Handler ──────────────────────────────────────────
                const audioMediaId = message.audio?.id;
                if (!audioMediaId) {
                    logger_1.logger.warn(`Received audio message from ${senderPhone} but no media ID found.`);
                    await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '⚠️ Could not retrieve your voice note. Please try recording and sending it again.');
                    return;
                }
                logger_1.logger.info(`Processing voice note (media ID: ${audioMediaId}) from ${senderPhone}...`);
                await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '🎙️ Got your voice note! Transcribing...');
                // Download the audio buffer from Meta
                const audioBuffer = await whatsapp_service_1.whatsappService.downloadAudioBuffer(audioMediaId);
                if (!audioBuffer) {
                    await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '⚠️ I had trouble downloading your voice note. Please try again or type your transaction instead.');
                    return;
                }
                // Transcribe with Groq Whisper
                const transcript = await audio_service_1.audioService.transcribeAudio(audioBuffer, message.audio?.mime_type || 'audio/ogg');
                if (!transcript) {
                    await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '🔇 I could not hear that clearly. Please send a clearer voice note, or type your transaction instead.');
                    return;
                }
                logger_1.logger.info(`Transcript from voice note: "${transcript.substring(0, 100)}"`);
                incomingText = transcript;
            }
            else if (messageType === 'image') {
                // ── Receipt / Image Photo Handler ──────────────────────────────
                const imageMediaId = message.image?.id;
                if (!imageMediaId) {
                    logger_1.logger.warn(`Received image message from ${senderPhone} but no media ID found.`);
                    await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '⚠️ Could not retrieve your receipt photo. Please try sending it again.');
                    return;
                }
                logger_1.logger.info(`Processing receipt photo (media ID: ${imageMediaId}) from ${senderPhone}...`);
                await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '📷 Reading your receipt photo...');
                // Download the image buffer from Meta
                const imageBuffer = await whatsapp_service_1.whatsappService.downloadImageBuffer(imageMediaId);
                if (!imageBuffer) {
                    await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '⚠️ I had trouble downloading your receipt photo. Please try again or type your transaction instead.');
                    return;
                }
                // Analyze image using Gemini Flash Vision
                const analyzedText = await image_service_1.imageService.analyzeReceiptImage(imageBuffer, message.image?.mime_type || 'image/jpeg');
                if (!analyzedText) {
                    await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '🔍 I could not read clear transaction details from that photo. Please make sure the text/amounts are clear, or type the transaction instead.');
                    return;
                }
                logger_1.logger.info(`Extracted text from receipt image: "${analyzedText.substring(0, 100)}"`);
                incomingText = analyzedText;
            }
            else if (messageType === 'text') {
                incomingText = message.text?.body || '';
            }
            else {
                // Video, sticker, reaction, document, etc.
                await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '📝 Sayve supports *text messages*, *voice notes*, and *receipt photos*. Send a voice note, photo, or type a transaction like *"sold rice for 5000"*.');
                return;
            }
            if (!incomingText.trim())
                return;
            // 1. Get or create user record
            const user = await onboarding_service_1.onboardingService.getOrCreateUser(senderPhone);
            // 2. Check if user is in onboarding flow
            const isOnboardingConsumed = await onboarding_service_1.onboardingService.processOnboardingStep(user, incomingText);
            if (isOnboardingConsumed) {
                return;
            }
            // 3. Check for help command before LLM parsing (cheap shortcut)
            const lowerText = incomingText.trim().toLowerCase();
            if (lowerText === 'help' || lowerText === '?' || lowerText === 'commands') {
                await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, HELP_MESSAGE);
                return;
            }
            // 4. Pass #1: Extract structured data from user message
            const knownCategories = (await Transaction_1.Transaction.distinct('category', { userId: user._id }));
            const context = {
                business_name: user.businessName || null,
                known_categories: knownCategories && knownCategories.length > 0 ? knownCategories : ['Sales', 'Inventory', 'Transport', 'Utilities', 'Salaries', 'Rent', 'Food', 'Fuel', 'Other'],
                today_date: new Date().toISOString().split('T')[0],
                is_batch: messageType === 'image',
            };
            const parsed = await parser_service_1.parserService.parseUserMessage(incomingText, context);
            if (!parsed) {
                await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '🤔 I could not understand that. Try: *"sold 3 bags of rice for 45000"*, *"spent 5000 on transport"*, or type *"help"* to see all commands.');
                return;
            }
            // 5. Intent Routing & Pass #2 Reply Generation
            // Option A: Clarification needed (missing type, ambiguous direction, or missing business)
            if (parsed.needs_clarification && parsed.clarification_question) {
                const humanQuestion = reply_service_1.replyService.generateClarifyingQuestion(parsed.clarification_question);
                logger_1.logger.info(`Sending human clarification question to ${senderPhone}: "${humanQuestion}"`);
                await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, `❓ ${humanQuestion}`);
                return;
            }
            // Option B: Category Correction (e.g., "no, it's Rent")
            if (parsed.isCorrection) {
                if (!user.lastTransactionId) {
                    await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '⚠️ No recent transaction found to correct.');
                    return;
                }
                const lastTx = await Transaction_1.Transaction.findById(user.lastTransactionId);
                if (lastTx && parsed.correctedCategory) {
                    const oldCat = lastTx.category;
                    lastTx.category = parsed.correctedCategory;
                    await lastTx.save();
                    await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, `Got it! Category updated for *${lastTx.description}* to *${lastTx.category}* ✅`);
                    return;
                }
            }
            // Option C: Financial Summary Query
            if (parsed.isSummaryQuery) {
                const summaryText = await summary_service_1.summaryService.getSummary(user, parsed.queryPeriod);
                await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, summaryText);
                return;
            }
            // Option D: CSV Data Export Request
            if (parsed.isExportRequest) {
                await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, '⏳ Generating your transaction report CSV...');
                await export_service_1.exportService.exportAndSendReport(user);
                return;
            }
            // Option E: Log Transactions (Single or Batch) via Pass #2 Persona Reply Generator
            const validItems = parsed.items.filter(item => item.amount !== null && item.amount > 0);
            if (validItems.length > 0) {
                const createdTxs = [];
                for (const item of validItems) {
                    const txDate = item.date ? new Date(item.date) : new Date();
                    const tx = await Transaction_1.Transaction.create({
                        userId: user._id,
                        phoneNumber: senderPhone,
                        type: item.type || 'income',
                        amount: item.amount,
                        category: item.category || (item.type === 'income' ? 'Sales' : 'Other'),
                        description: item.description || incomingText,
                        rawMessage: incomingText,
                        businessName: item.business_name || user.businessName,
                        date: isNaN(txDate.getTime()) ? new Date() : txDate,
                    });
                    createdTxs.push(tx);
                }
                // Store last transaction ID for correction tracking
                if (createdTxs.length > 0) {
                    user.lastTransactionId = createdTxs[createdTxs.length - 1]._id;
                    try {
                        await user.save();
                    }
                    catch (e) { }
                }
                // Pass #2: Generate human WhatsApp confirmation reply using ReplyService
                const replyText = await reply_service_1.replyService.generateLogReply(user, createdTxs);
                await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, replyText);
                return;
            }
            // Fallback response
            await whatsapp_service_1.whatsappService.sendTextMessage(senderPhone, 'ℹ️ I could not find a clear transaction or command. You can log income/expenses, ask *"how much did I make this week"*, or reply *"send my report"*.');
        }
        catch (error) {
            logger_1.logger.error('Error handling webhook POST:', error);
        }
    }
}
exports.WebhookController = WebhookController;
exports.webhookController = new WebhookController();
