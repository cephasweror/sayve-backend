import { formatCurrency, formatDate } from '../utils/formatters';

describe('Formatter Utilities Unit Tests', () => {
  it('should format Naira currency correctly', () => {
    expect(formatCurrency(45000, 'NGN')).toBe('₦45,000');
    expect(formatCurrency(5000, 'NGN')).toBe('₦5,000');
    expect(formatCurrency(1250.5, 'NGN')).toBe('₦1,250.5');
  });

  it('should format dates properly', () => {
    const date = new Date('2026-08-10T12:00:00Z');
    const formatted = formatDate(date);
    expect(formatted).toContain('2026');
    expect(formatted).toContain('Aug');
  });
});
