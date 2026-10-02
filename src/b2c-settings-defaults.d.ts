export type Locale = "fr" | "en" | "es" | "pt";
export type LocalizedText = Record<Locale, string | null>;

export interface NewsletterPopupSetting {
  delaySeconds: number;
  dismissDays: number;
  subscribedDays: number;
  pages: Array<"catalogue" | "collections" | "produit">;
}
export interface HomeSetting {
  heroImages: string[];
  slideDurationMs: number;
  shippingBanner: LocalizedText;
  editorialImages: { histoire: string; savoirFaire: string[]; boutique: string };
}
export interface SeoSetting {
  title: LocalizedText;
  description: LocalizedText;
  ogImage: string;
}
export interface ShippingRatesSetting {
  europe: number;
  world: number;
  express: number;
  premium: number;
}
export interface EmailsSetting {
  fromName: string | null;
  replyTo: string | null;
  internalCc: string | null;
  signature: string;
}
export interface BoutiqueSetting {
  street: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  hours: string;
}

export interface B2CSettingsMap {
  newsletterPopup: NewsletterPopupSetting;
  home: HomeSetting;
  seo: SeoSetting;
  shippingRates: ShippingRatesSetting;
  emails: EmailsSetting;
  boutique: BoutiqueSetting;
}
export type B2CSettingName = keyof B2CSettingsMap;
export type B2CPublicSettings = Omit<B2CSettingsMap, "emails">;

export const LOCALES: Locale[];
export const POPUP_PAGE_CHOICES: NewsletterPopupSetting["pages"];
export const HERO_IMAGE_CHOICES: string[];
export const BRAND_IMAGE_CHOICES: string[];
export const OG_IMAGE_CHOICES: string[];
export const B2C_SETTINGS: {
  [K in B2CSettingName]: { key: string; public: boolean; default: B2CSettingsMap[K]; validate(data: unknown): B2CSettingsMap[K] };
};
export const B2C_SETTING_NAMES: B2CSettingName[];
export function getB2CSettingDefault<K extends B2CSettingName>(name: K): B2CSettingsMap[K];
export function parseB2CSetting<K extends B2CSettingName>(name: K, raw: string | false | null | undefined): B2CSettingsMap[K];
export function phoneHref(phone: string): string;
