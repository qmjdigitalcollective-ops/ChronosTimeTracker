import { Pipe, PipeTransform } from '@angular/core';
import { CURRENCY_SYMBOL } from '../app.constants';

/** Formats a number as money in the app currency, e.g. 1234.5 -> "₱1,234.50". */
@Pipe({
  name: 'money',
  standalone: true,
})
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, perHour = false): string {
    const n = Number(value) || 0;
    const formatted = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${n < 0 ? '-' : ''}${CURRENCY_SYMBOL}${formatted}${perHour ? '/hr' : ''}`;
  }
}
