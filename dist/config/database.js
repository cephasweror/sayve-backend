"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDB = connectDB;
exports.disconnectDB = disconnectDB;
const dns_1 = __importDefault(require("dns"));
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./env");
const logger_1 = require("../utils/logger");
async function connectDB() {
    try {
        if (mongoose_1.default.connection.readyState >= 1) {
            return;
        }
        // Set fallback public DNS servers (8.8.8.8, 1.1.1.1) to ensure MongoDB Atlas SRV lookup succeeds on all Wi-Fi routers
        try {
            dns_1.default.setServers(['8.8.8.8', '1.1.1.1']);
        }
        catch (dnsErr) { }
        await mongoose_1.default.connect(env_1.env.MONGODB_URI);
        logger_1.logger.info('✅ Connected to MongoDB database successfully');
    }
    catch (error) {
        logger_1.logger.error('❌ Failed to connect to MongoDB:', error);
        // In production we log error but allow app startup fallback mock mode if DB unavailable
    }
}
async function disconnectDB() {
    if (mongoose_1.default.connection.readyState >= 1) {
        await mongoose_1.default.disconnect();
        logger_1.logger.info('Disconnected from MongoDB database');
    }
}
