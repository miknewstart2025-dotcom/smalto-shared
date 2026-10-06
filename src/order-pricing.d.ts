export interface PricedLine { qty: number; unitPrice: number | string; discountPct?: number | string }
export interface OrderTotals { pieces: number; subtotal: number; globalAmount: number; untaxed: number; vat: number; total: number; maxDiscount: number }
export function round2(n: number): number;
export function toPct(v: unknown): number;
export function toAmount(v: unknown): number;
export function combinedDiscount(linePct: unknown, globalPct: unknown): number;
export function lineAmount(qty: number, unitPrice: unknown, discountPct: unknown): number;
export function orderTotals(lines: PricedLine[], opts?: { globalDiscountPct?: unknown; vatRate?: unknown }): OrderTotals;
export function exceedsDiscountCap(lines: PricedLine[], globalDiscountPct: unknown, capPct: unknown): boolean;
