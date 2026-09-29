import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "../api.ts";
import { ApiError } from "../api.ts";
import { en, type MessageKey } from "./en.ts";
import { uk } from "./uk.ts";

const messages = { en, uk } as const;

export const locales: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "uk", label: "Українська" },
];

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function translator(locale: Locale): Translate {
  return (key, vars) => {
    const text: string = messages[locale][key] ?? en[key];
    return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match)) : text;
  };
}

const I18nContext = createContext<{ locale: Locale; t: Translate }>({ locale: "en", t: translator("en") });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={{ locale, t: translator(locale) }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

/** Language before sign-in: the last one used here, else the browser's. */
export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem("guidepass.locale");
    if (saved === "en" || saved === "uk") return saved;
  } catch {
    // Storage can be unavailable; fall back to the browser language.
  }
  return navigator.language.toLowerCase().startsWith("uk") ? "uk" : "en";
}

export function rememberLocale(locale: Locale) {
  try {
    localStorage.setItem("guidepass.locale", locale);
  } catch {
    // Not critical.
  }
}

/** A message for any error: API codes are translated, validation details listed. */
export function errorMessage(t: Translate, error: unknown): string {
  if (error instanceof ApiError) {
    const key = `error.${error.code}` as MessageKey;
    const base = key in en ? t(key) : error.message;
    if (error.code === "invalid" || error.code === "conflict") {
      const details = Array.isArray(error.details)
        ? (error.details as { path: string; message: string }[]).map((d) => `${d.path}: ${d.message}`)
        : [];
      return [error.message || base, ...details].join("\n");
    }
    return base;
  }
  if (error instanceof TypeError) return t("error.network");
  return error instanceof Error ? error.message : String(error);
}
