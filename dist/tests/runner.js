"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const parser_service_1 = require("../services/parser.service");
const formatters_1 = require("../utils/formatters");
async function runTests() {
    console.log('🧪 Starting Sayve Test Suite Execution...\n');
    let passed = 0;
    let failed = 0;
    function assert(condition, testName) {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passed++;
        }
        else {
            console.error(`  ❌ FAIL: ${testName}`);
            failed++;
        }
    }
    // 1. Formatting Tests
    console.log('📋 Running Formatting Tests...');
    assert((0, formatters_1.formatCurrency)(45000, 'NGN') === '₦45,000', 'formatCurrency(45000, "NGN") equals ₦45,000');
    assert((0, formatters_1.formatCurrency)(5000, 'NGN') === '₦5,000', 'formatCurrency(5000, "NGN") equals ₦5,000');
    assert((0, formatters_1.formatDate)(new Date('2026-08-10')).includes('2026'), 'formatDate includes year 2026');
    // 2. Transaction Parser Tests
    console.log('\n🤖 Running Transaction Parser Tests...');
    // Test 1: Income
    const incomeResult = await parser_service_1.parserService.parseUserMessage('sold 3 bags of rice for 45000');
    assert(incomeResult?.isTransaction === true, 'Parse income: isTransaction is true');
    assert(incomeResult?.type === 'income', 'Parse income: type is income');
    assert(incomeResult?.amount === 45000, 'Parse income: amount is 45000');
    assert(incomeResult?.category === 'Sales', 'Parse income: category is Sales');
    // Test 2: Expense
    const expenseResult = await parser_service_1.parserService.parseUserMessage('spent 5000 on transport');
    assert(expenseResult?.isTransaction === true, 'Parse expense: isTransaction is true');
    assert(expenseResult?.type === 'expense', 'Parse expense: type is expense');
    assert(expenseResult?.amount === 5000, 'Parse expense: amount is 5000');
    assert(expenseResult?.category === 'Transport', 'Parse expense: category is Transport');
    // Test 3: Financial Summary Query
    const summaryResult = await parser_service_1.parserService.parseUserMessage('how much did I make this week');
    assert(summaryResult?.isSummaryQuery === true, 'Summary query: isSummaryQuery is true');
    assert(summaryResult?.queryPeriod === 'week', 'Summary query: period is week');
    // Test 4: Export Request
    const exportResult = await parser_service_1.parserService.parseUserMessage('send my report');
    assert(exportResult?.isExportRequest === true, 'Export command: isExportRequest is true');
    // Test 5: Category Correction
    const correctionResult = await parser_service_1.parserService.parseUserMessage("no, it's Rent");
    assert(correctionResult?.isCorrection === true, 'Correction command: isCorrection is true');
    assert(correctionResult?.correctedCategory === 'Rent', 'Correction command: category is Rent');
    // Test 6: Expanded summary keywords
    const expensesMonthResult = await parser_service_1.parserService.parseUserMessage('show my expenses this month');
    assert(expensesMonthResult?.isSummaryQuery === true, 'Summary: "show my expenses this month" detected');
    console.log(`\n===================================`);
    console.log(`📊 TEST RESULTS: ${passed} passed, ${failed} failed.`);
    console.log(`===================================\n`);
    if (failed > 0) {
        process.exit(1);
    }
}
runTests().catch((err) => {
    console.error('Test execution failed with error:', err);
    process.exit(1);
});
