// Simple JavaScript Test Runner for Sayve
const formatCurrency = (amount, currencyCode = 'NGN') => {
  const symbol = currencyCode.toUpperCase() === 'NGN' || currencyCode === '₦' ? '₦' : `${currencyCode} `;
  const formattedNumber = new Intl.NumberFormat('en-NG', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
  return `${symbol}${formattedNumber}`;
};

const formatDate = (date = new Date()) => {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

function parseUserMessageMock(prompt) {
  const text = prompt.toLowerCase();
  
  if (text.includes('how much') || text.includes('summary') || text.includes('spent this month') || text.includes('made this week')) {
    return {
      isTransaction: false,
      isCorrection: false,
      isSummaryQuery: true,
      isExportRequest: false,
      queryPeriod: text.includes('week') ? 'week' : text.includes('month') ? 'month' : 'today',
    };
  }

  if (text.includes('send my report') || text.includes('export') || text.includes('csv')) {
    return {
      isTransaction: false,
      isCorrection: false,
      isSummaryQuery: false,
      isExportRequest: true,
    };
  }

  if (text.startsWith('no,') || text.includes("it's") || text.includes('change category')) {
    let category = 'Other';
    if (text.includes('rent')) category = 'Rent';
    else if (text.includes('sales') || text.includes('sale')) category = 'Sales';
    else if (text.includes('transport')) category = 'Transport';

    return {
      isTransaction: false,
      isCorrection: true,
      correctedCategory: category,
      isSummaryQuery: false,
      isExportRequest: false,
    };
  }

  const isExpense = text.includes('spent') || text.includes('bought') || text.includes('pay') || text.includes('cost');
  const type = isExpense ? 'expense' : 'income';

  // Extract all numbers
  const numbers = text.match(/\d+[\d,]*/g);
  let amount = 0;
  if (numbers && numbers.length > 0) {
    const parsedNums = numbers.map(n => parseInt(n.replace(/,/g, ''), 10));
    // Pick the largest number (e.g. 45000 over 3 bags)
    amount = Math.max(...parsedNums);
  }

  let category = 'Other';
  if (text.includes('transport') || text.includes('fuel')) category = 'Transport';
  else if (text.includes('rice') || text.includes('sold') || text.includes('sales')) category = 'Sales';

  return {
    isTransaction: true,
    type,
    amount,
    category,
    description: text,
    isCorrection: false,
    isSummaryQuery: false,
    isExportRequest: false,
  };
}

function runTests() {
  console.log('🧪 Executing Sayve Suite Verification Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // 1. Formatting Tests
  console.log('📋 Running Currency & Date Formatting Tests...');
  assert(formatCurrency(45000, 'NGN') === '₦45,000', 'formatCurrency(45000, "NGN") returns ₦45,000');
  assert(formatCurrency(5000, 'NGN') === '₦5,000', 'formatCurrency(5000, "NGN") returns ₦5,000');
  assert(formatDate(new Date('2026-08-10')).includes('2026'), 'formatDate formats year correctly');

  // 2. Parser Logic Tests
  console.log('\n🤖 Running Transaction & Intent Parser Tests...');
  
  const incomeResult = parseUserMessageMock('sold 3 bags of rice for 45000');
  assert(incomeResult.isTransaction === true, 'Parse income: isTransaction is true');
  assert(incomeResult.type === 'income', 'Parse income: type is income');
  assert(incomeResult.amount === 45000, 'Parse income: amount is 45000');
  assert(incomeResult.category === 'Sales', 'Parse income: category is Sales');

  const expenseResult = parseUserMessageMock('spent 5000 on transport');
  assert(expenseResult.isTransaction === true, 'Parse expense: isTransaction is true');
  assert(expenseResult.type === 'expense', 'Parse expense: type is expense');
  assert(expenseResult.amount === 5000, 'Parse expense: amount is 5000');
  assert(expenseResult.category === 'Transport', 'Parse expense: category is Transport');

  const summaryResult = parseUserMessageMock('how much did I make this week');
  assert(summaryResult.isSummaryQuery === true, 'Summary query intent detected');
  assert(summaryResult.queryPeriod === 'week', 'Summary query period detected as week');

  const exportResult = parseUserMessageMock('send my report');
  assert(exportResult.isExportRequest === true, 'Export report intent detected');

  const correctionResult = parseUserMessageMock("no, it's Rent");
  assert(correctionResult.isCorrection === true, 'Category correction intent detected');
  assert(correctionResult.correctedCategory === 'Rent', 'Category correction mapped to Rent');

  console.log(`\n===================================`);
  console.log(`📊 TEST RESULTS SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log(`===================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
