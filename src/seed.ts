import type { AppSettings, BudgetItem } from "./types";

export const defaultBudgetItems: BudgetItem[] = [
  ["固定費", "住宅ローン", "ふくぎん（ローン代表口座）", 93071],
  ["固定費", "生活インフラ", "電気・ガス・水道・ネット・携帯", 32000],
  ["固定費", "保険料", "住友生命・SBIプリズム少短", 5000],
  ["基礎生活費", "食材・飲料", "サニー・西鉄ストア・自炊用の食費", 35000],
  ["基礎生活費", "日用品", "グッデイ、消耗品、洗剤など", 20000],
  ["基礎生活費", "医療費", "レディースクリニック、整骨院、歯科", 10000],
  ["基礎生活費", "交通費", "地下鉄・バス・ガソリン代・ETC", 10000],
  ["基礎生活費", "猫関連費", "フード、砂、保険、おもちゃ", 10000],
  ["基礎生活費", "被服・美容費", "美容室・日常の服など", 5000],
  ["ゆとり費", "日々の外食・カフェ", "惰性での外食、仕事中のランチなど", 30000],
  ["ゆとり費", "価値ある外食・交際", "夫婦ディナー、交際費", 25000],
  ["ゆとり費", "趣味・娯楽費", "お笑いライブ、映画、イベント", 10000],
  ["ゆとり費", "コンビニ・自販機", "セブン、ローソン、ジュースなど", 10000]
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
