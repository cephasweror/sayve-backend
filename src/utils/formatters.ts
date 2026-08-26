/**
 * Format a number into standard Naira currency format (e.g. 45000 -> ₦45,000)
 */
export function formatCurrency(amount: number, currencyCode: string = 'NGN'): string {
  const symbol = currencyCode.toUpperCase() === 'NGN' || currencyCode === '₦' ? '₦' : `${currencyCode} `;
  const formattedNumber = new Intl.NumberFormat('en-NG', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
  
  return `${symbol}${formattedNumber}`;
}

/**
 * Format date for display in responses (e.g., "10 Aug 2026")
 */
export function formatDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}
