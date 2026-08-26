"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const webhook_controller_1 = require("../controllers/webhook.controller");
const router = (0, express_1.Router)();
// GET /webhook - Meta Webhook Verification
router.get('/', (req, res) => webhook_controller_1.webhookController.verifyWebhook(req, res));
// POST /webhook - Meta Incoming Webhook Payload
router.post('/', (req, res) => webhook_controller_1.webhookController.handleIncomingMessage(req, res));
exports.default = router;
