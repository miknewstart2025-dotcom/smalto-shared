export type SocialLink = { name: string; href: string };
export const DEFAULT_SOCIAL_LINKS: SocialLink[];
export const DEFAULT_B2B_API_URL: string;
export function mergeSocialLinks(remote: unknown, defaults?: readonly SocialLink[]): SocialLink[];
export function fetchSocialLinks(options?: {
  baseUrl?: string;
  timeoutMs?: number;
  fetchOptions?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<SocialLink[]>;
