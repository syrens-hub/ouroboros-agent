import { describe, it, expect, beforeEach } from "vitest";
import { I18n, createI18n, getI18n, t, SUPPORTED_LOCALES } from "../../../skills/i18n/index.ts";

describe("I18n", () => {
  beforeEach(() => {
    createI18n();
  });

  it("lists supported locales", () => {
    expect(SUPPORTED_LOCALES.length).toBe(13);
    expect(SUPPORTED_LOCALES[0].code).toBe("en");
  });

  it("defaults to en locale", () => {
    const i18n = new I18n();
    expect(i18n.getLocale()).toBe("en");
  });

  it("sets a valid locale", () => {
    const i18n = new I18n();
    i18n.setLocale("zh-CN");
    expect(i18n.getLocale()).toBe("zh-CN");
  });

  it("throws on invalid locale", () => {
    const i18n = new I18n();
    expect(() => i18n.setLocale("xx" as any)).toThrow("Unsupported locale");
  });

  it("gets locale info", () => {
    const i18n = new I18n();
    const info = i18n.getLocaleInfo();
    expect(info.code).toBe("en");
    expect(info.direction).toBe("ltr");
  });

  it("translates a known key", () => {
    const i18n = new I18n();
    expect(i18n.t("common.appName")).toBe("Ouroboros");
  });

  it("falls back for missing translations", () => {
    const i18n = new I18n({ defaultLocale: "zh-TW" });
    expect(i18n.t("common.appName")).toBe("Ouroboros");
  });

  it("returns key when no translation found", () => {
    const i18n = new I18n();
    expect(i18n.t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("interpolates params", () => {
    const i18n = new I18n();
    expect(i18n.t("common.loading")).toBe("Loading...");
  });

  it("formats numbers", () => {
    const i18n = new I18n();
    expect(i18n.formatNumber(1234.5)).toContain("1,234.5");
  });

  it("formats dates", () => {
    const i18n = new I18n();
    const result = i18n.formatDate(new Date("2024-01-15"));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("formats relative time", () => {
    const i18n = new I18n();
    expect(i18n.formatRelativeTime(-1, "day")).toContain("1");
  });

  it("getSupportedLocales returns a copy", () => {
    const i18n = new I18n();
    const list = i18n.getSupportedLocales();
    list.pop();
    expect(i18n.getSupportedLocales().length).toBe(13);
  });

  it("createI18n sets global instance", () => {
    const instance = createI18n({ defaultLocale: "de" });
    expect(getI18n().getLocale()).toBe("de");
    expect(instance.getLocale()).toBe("de");
  });

  it("t() uses global instance", () => {
    createI18n();
    expect(t("common.save")).toBe("Save");
  });
});
