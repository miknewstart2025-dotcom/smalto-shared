export function slugify(text: string): string;
export function productSlug(product: { id: number; name: string }): string;
export function idFromProductSlug(slug: string): number | null;
