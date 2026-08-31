import { parserService } from '../services/parser.service';

describe('ParserService Unit Tests', () => {
  it('should parse simple income transaction correctly', async () => {
    const text = 'sold 3 bags of rice for 45000';
    const result = await parserService.parseUserMessage(text);

    expect(result).not.toBeNull();
    expect(result?.items.length).toBeGreaterThan(0);
    expect(result?.items[0].type).toBe('income');
    expect(result?.items[0].amount).toBe(45000);
    expect(result?.items[0].category).toBe('Sales');
  });

  it('should parse simple expense transaction correctly', async () => {
    const text = 'spent 5000 on transport';
    const result = await parserService.parseUserMessage(text);

    expect(result).not.toBeNull();
    expect(result?.items.length).toBeGreaterThan(0);
    expect(result?.items[0].type).toBe('expense');
    expect(result?.items[0].amount).toBe(5000);
    expect(result?.items[0].category).toBe('Transport');
  });

  it('should recognize financial summary command', async () => {
    const text = 'how much did I make this week';
    const result = await parserService.parseUserMessage(text);

    expect(result).not.toBeNull();
    expect(result?.isSummaryQuery).toBe(true);
    expect(result?.queryPeriod).toBe('week');
  });

  it('should recognize export command', async () => {
    const text = 'send my report';
    const result = await parserService.parseUserMessage(text);

    expect(result).not.toBeNull();
    expect(result?.isExportRequest).toBe(true);
  });

  it('should recognize category correction command', async () => {
    const text = "no, it's Rent";
    const result = await parserService.parseUserMessage(text);

    expect(result).not.toBeNull();
    expect(result?.isCorrection).toBe(true);
    expect(result?.correctedCategory).toBe('Rent');
  });

  it('should flag needs_clarification for ambiguous direction messages', async () => {
    const text = '600000 fuel';
    const result = await parserService.parseUserMessage(text);

    expect(result).not.toBeNull();
    expect(result?.needs_clarification).toBe(true);
    expect(result?.clarification_question).toContain('coming in or going out');
  });

  it('should parse Nigerian market number expressions (2k5, 3k500) correctly', async () => {
    const text = 'sell 3 mudu garri 2k5';
    const result = await parserService.parseUserMessage(text);

    expect(result).not.toBeNull();
    expect(result?.items[0]?.amount).toBe(2500);
  });

  it('should handle all required shorthand and market currency formats correctly', async () => {
    const { normalizeNigerianMarketNumbers } = require('../services/parser.service');

    expect(normalizeNigerianMarketNumbers('spent 1k on transport')).toBe('spent 1000 on transport');
    expect(normalizeNigerianMarketNumbers('spent 5k fuel')).toBe('spent 5000 fuel');
    expect(normalizeNigerianMarketNumbers('sold 2.4k garri')).toBe('sold 2400 garri');
    expect(normalizeNigerianMarketNumbers('paid 600k for rent')).toBe('paid 600000 for rent');
    expect(normalizeNigerianMarketNumbers('spent 600 thousand')).toBe('spent 600000');
    expect(normalizeNigerianMarketNumbers('bought 1.5m stock')).toBe('bought 1500000 stock');
    expect(normalizeNigerianMarketNumbers('made 600m profit')).toBe('made 600000000 profit');
    expect(normalizeNigerianMarketNumbers('600 million revenue')).toBe('600000000 revenue');
    expect(normalizeNigerianMarketNumbers('budget is 600b')).toBe('budget is 600000000000');
    expect(normalizeNigerianMarketNumbers('paid ₦600,000')).toBe('paid 600000');
    expect(normalizeNigerianMarketNumbers('paid NGN 600000')).toBe('paid 600000');
    expect(normalizeNigerianMarketNumbers('sold 45,000 rice')).toBe('sold 45000 rice');
    expect(normalizeNigerianMarketNumbers('bought 1kg sugar and walked 2km')).toBe('bought 1kg sugar and walked 2km');
  });

  it('should parse real decimal shorthand amounts ("2.4k", "5k") via parseUserMessage', async () => {
    const res24k = await parserService.parseUserMessage('sold 2.4k garri');
    expect(res24k).not.toBeNull();
    expect(res24k?.items[0]?.amount).toBe(2400);

    const res5k = await parserService.parseUserMessage('spent 5k fuel');
    expect(res5k).not.toBeNull();
    expect(res5k?.items[0]?.amount).toBe(5000);
  });
});
