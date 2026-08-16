import type { AppSettings, BudgetItem } from "./types";

export const defaultBudgetItems: BudgetItem[] = [
  ["親カテゴリ", "食材・飲料", "自炊用の買い出し等", 35000],
  ["親カテゴリ", "日々のごはん・カフェ", "日々の外食・カフェ", 30000],
  ["親カテゴリ", "チリツモ", "コンビニ・自販機", 10000],
  ["親カテゴリ", "お楽しみ・趣味交際", "外食・交際・趣味娯楽", 35000],
  ["親カテゴリ", "日用品・猫・その他", "日用品・猫・交通・医療・美容", 50000],
  ["親カテゴリ", "固定費", "生活インフラ・保険料", 135000],
  ["親カテゴリ", "特別費", "家具家電・旅行・冠婚葬祭・突発費", 0],
  ["親カテゴリ", "貯蓄・投資", "投資・貯金", 0],
  ["親カテゴリ", "その他", "未分類", 0]
].map(([classification, name, detail, monthlyBudget], displayOrder) => ({
  id: `${classification}-${name}`,
  classification: String(classification),
  name: String(name),
  detail: String(detail),
  monthlyBudget: Number(monthlyBudget),
  displayOrder,
  isEnabled: true
}));

export const defaultSettings: AppSettings = {
  monthlyIncomeEstimate: 500000,
  aggregationMode: "zaimCompliant"
};
