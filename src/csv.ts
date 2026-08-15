import type { AggregationSetting, ImportIssue, ParsedImport, Transaction, TransactionMethod } from "./types";

export const expectedHeader = [
  "日付",
  "方法",
  "カテゴリ",
  "カテゴリの内訳",
  "支払元",
  "入金先",
  "品目",
  "メモ",
  "お店",
  "通貨",
  "収入",
  "支出",
  "振替",
  "残高調整",
  "通貨変換前の金額",
  "集計の設定"
];

const methods = new Set<TransactionMethod>(["payment", "income", "transfer", "balance"]);
const aggregationSettings = new Set<AggregationSetting>(["常に集計に含める", "集計に含めない", "年の集計にのみ含める"]);

export async function parseZaimCsvFile(file: File, importedAt = new Date()): Promise<ParsedImport> {
  const buffer = await file.arrayBuffer();
  const decoded = decodeCsv(buffer);
  const rows = parseCsv(decoded.text);
  const header = rows[0];

  if (!header) {
    throw issue("CSVが空です。");
  }
  if (!sameHeader(header)) {
    throw issue(`ヘッダがZaim CSV形式と一致しません。期待: ${expectedHeader.join(", ")} / 実際: ${header.join(", ")}`, 1);
  }

  const transactions = rows.slice(1).filter((row) => row.some((field) => field.trim() !== "")).map((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== expectedHeader.length) {
      throw issue(`列数が${expectedHeader.length}列ではありません。`, rowNumber);
    }
    return toTransaction(row, rowNumber, importedAt);
  });

  const sortedDates = transactions.map((transaction) => transaction.date).sort();
  const months = new Set(transactions.map((transaction) => monthKey(transaction.date)));
  const years = new Set(transactions.map((transaction) => monthKey(transaction.date).slice(0, 4)));
  return {
    transactions,
    metadata: {
      sourceFileName: file.name,
      importedAt: importedAt.toISOString(),
      rowCount: transactions.length,
      dateStart: sortedDates[0] ?? null,
      dateEnd: sortedDates.at(-1) ?? null,
      monthCount: months.size,
      yearCount: years.size,
      encoding: decoded.encoding,
      csvHeaderSignature: header.join(",")
    }
  };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(stripTrailingCr(field));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw issue("引用符が閉じられていません。");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(stripTrailingCr(field));
    rows.push(row);
  }
  return rows;
}

function decodeCsv(buffer: ArrayBuffer): { text: string; encoding: "Shift_JIS" | "UTF-8" } {
  const shiftJis = new TextDecoder("shift_jis", { fatal: false }).decode(buffer);
  if (sameHeader(parseCsv(shiftJis)[0] ?? [])) {
    return { text: shiftJis, encoding: "Shift_JIS" };
  }

  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (sameHeader(parseCsv(utf8)[0] ?? [])) {
    return { text: utf8, encoding: "UTF-8" };
  }

  return { text: shiftJis, encoding: "Shift_JIS" };
}

function toTransaction(row: string[], rowNumber: number, importedAt: Date): Transaction {
  const date = parseDate(row[0], rowNumber);
  const method = row[1] as TransactionMethod;
  if (!methods.has(method)) {
    throw issue("payment / income / transfer / balance のいずれでもありません。", rowNumber, "方法");
  }
  const currency = normalize(row[9]);
  if (!currency) {
    throw issue("通貨が空です。", rowNumber, "通貨");
  }
  const aggregationSetting = row[15] as AggregationSetting;
  if (!aggregationSettings.has(aggregationSetting)) {
    throw issue("未知の集計設定です。", rowNumber, "集計の設定");
  }

  return {
    id: crypto.randomUUID(),
    fingerprint: fingerprintForRow(row),
    date,
    method,
    category: normalize(row[2]),
    subcategory: normalize(row[3]),
    fromAccount: normalize(row[4]),
    toAccount: normalize(row[5]),
    item: normalize(row[6]),
    memo: normalize(row[7]),
    shop: normalize(row[8]),
    currency,
    incomeAmount: amount(row[10], rowNumber, "収入"),
    expenseAmount: amount(row[11], rowNumber, "支出"),
    transferAmount: amount(row[12], rowNumber, "振替"),
    balanceAdjustmentAmount: amount(row[13], rowNumber, "残高調整"),
    originalAmount: amount(row[14], rowNumber, "通貨変換前の金額"),
    aggregationSetting,
    sourceRowNumber: rowNumber,
    importedAt: importedAt.toISOString()
  };
}

export function fingerprintForRow(row: string[]): string {
  let hash = 2166136261;
  const text = row.join("\u001f");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `z${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function parseDate(value: string, rowNumber: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw issue("yyyy-MM-dd形式の日付ではありません。", rowNumber, "日付");
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw issue("yyyy-MM-dd形式の日付ではありません。", rowNumber, "日付");
  }
  return date.toISOString();
}

function amount(value: string, rowNumber: number, column: string): number {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw issue("整数の金額ではありません。", rowNumber, column);
  }
  return Number(trimmed);
}

function normalize(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "-" ? null : trimmed;
}

function sameHeader(header: string[]): boolean {
  return header.length === expectedHeader.length && header.every((value, index) => value === expectedHeader[index]);
}

function stripTrailingCr(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function issue(message: string, row?: number, column?: string): ImportIssue {
  return { message, row, column };
}

function monthKey(dateValue: string): string {
  const date = new Date(dateValue);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
