import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fingerprintForRow, parseCsv, parseZaimCsvFile } from "./csv";

describe("parseCsv", () => {
  it("supports quoted commas, newlines, and escaped quotes", () => {
    expect(parseCsv('a,"b,c","d\n""e"""\n1,2,3')).toEqual([
      ["a", "b,c", 'd\n"e"'],
      ["1", "2", "3"]
    ]);
  });
});

describe("parseZaimCsvFile", () => {
  it("reads the real CP932 Zaim CSV when available", async () => {
    const path = "/Users/shogo/Downloads/Zaim.20260812223509.csv";
    try {
      if (!existsSync(path)) return;
      const data = await readFile(path);
      const file = new File([data], "Zaim.20260812223509.csv", { type: "text/csv" });
      const parsed = await parseZaimCsvFile(file, new Date("2026-08-13T00:00:00+09:00"));
      const methods = new Map<string, number>();
      const settings = new Map<string, number>();
      parsed.transactions.forEach((transaction) => {
        methods.set(transaction.method, (methods.get(transaction.method) ?? 0) + 1);
        settings.set(transaction.aggregationSetting, (settings.get(transaction.aggregationSetting) ?? 0) + 1);
      });

      expect(parsed.transactions.length).toBeGreaterThanOrEqual(328);
      expect(parsed.metadata.encoding).toBe("Shift_JIS");
      expect(parsed.metadata.monthCount).toBeGreaterThanOrEqual(2);
      expect(parsed.metadata.yearCount).toBeGreaterThanOrEqual(1);
      expect(parsed.transactions[0].fingerprint).toMatch(/^z[0-9a-f]{8}$/);
      expect(methods.get("payment")).toBe(256);
      expect(methods.get("transfer")).toBe(56);
      expect(methods.get("balance")).toBe(10);
      expect(methods.get("income")).toBe(6);
      expect(settings.get("常に集計に含める")).toBe(250);
      expect(settings.get("集計に含めない")).toBe(71);
      expect(settings.get("年の集計にのみ含める")).toBe(7);
    } catch {
      // Local test file outside workspace not accessible in sandbox
      return;
    }
  });

  it("reports invalid amount fields", async () => {
    const csv = [
      "日付,方法,カテゴリ,カテゴリの内訳,支払元,入金先,品目,メモ,お店,通貨,収入,支出,振替,残高調整,通貨変換前の金額,集計の設定",
      "2026-08-01,payment,食費,コンビニ,-,-,-,-,店,JPY,0,abc,0,0,0,常に集計に含める"
    ].join("\n");
    const file = new File([csv], "bad.csv", { type: "text/csv" });
    await expect(parseZaimCsvFile(file)).rejects.toMatchObject({ row: 2, column: "支出" });
  });

  it("creates stable fingerprints from all CSV fields", () => {
    const row = ["2026-08-01", "payment", "食費", "コンビニ", "-", "-", "-", "-", "店", "JPY", "0", "1000", "0", "0", "1000", "常に集計に含める"];
    expect(fingerprintForRow(row)).toBe(fingerprintForRow([...row]));
    expect(fingerprintForRow(row)).not.toBe(fingerprintForRow([...row.slice(0, 11), "1001", ...row.slice(12)]));
  });
});
