"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const env_1 = require("./config/env");
const database_1 = require("./config/database");
const logger_1 = require("./utils/logger");
const webhook_routes_1 = __importDefault(require("./routes/webhook.routes"));
const app = (0, express_1.default)();
exports.app = app;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Health Check Endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'online',
        app: 'Sayve WhatsApp AI Expense Tracker',
        timestamp: new Date().toISOString(),
    });
});
// Webhook Routes
app.use('/webhook', webhook_routes_1.default);
// Start Server
async function startServer() {
    await (0, database_1.connectDB)();
    const PORT = parseInt(env_1.env.PORT, 10);
    app.listen(PORT, () => {
        logger_1.logger.info(`🚀 Sayve Express Webhook server running on port ${PORT}`);
        logger_1.logger.info(`🔗 Webhook Callback URL: http://localhost:${PORT}/webhook`);
        logger_1.logger.info(`🔑 Verification Token: ${env_1.env.WHATSAPP_VERIFY_TOKEN}`);
    });
}
if (require.main === module) {
    startServer();
}
