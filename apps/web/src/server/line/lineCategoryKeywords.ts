/**
 * Keyword seeds for guessing a category from a chat message's title tokens,
 * when the title itself doesn't name a category (see the "交通 50" case in
 * lineCommand.ts, which is matched before this table is even consulted).
 *
 * Order matters: the first matching entry wins, so a message that could match
 * two categories (rare, given how different the seed lists are) always
 * resolves the same way. Every key here must exist in app/catalog.ts's
 * DEFAULT_CATALOG - pinned by lineCommand.test.ts.
 */
export type LineCategoryKeyword = {
  key: string;
  words: readonly string[];
};

export const LINE_CATEGORY_KEYWORDS: readonly LineCategoryKeyword[] = [
  {
    key: "food",
    words: [
      "早餐", "午餐", "晚餐", "宵夜", "早午餐", "下午茶", "點心", "咖啡", "飲料", "手搖", "便當",
      "breakfast", "lunch", "dinner", "coffee", "snack", "meal",
    ],
  },
  {
    key: "transport",
    words: [
      "捷運", "公車", "計程車", "小黃", "uber", "高鐵", "台鐵", "火車", "加油", "油錢", "停車", "悠遊卡",
      "taxi", "bus", "mrt", "train", "parking",
    ],
  },
  {
    key: "lodging",
    words: ["住宿", "飯店", "旅館", "hotel", "airbnb"],
  },
  {
    key: "shopping",
    words: ["衣服", "鞋", "網購", "蝦皮", "momo", "shopping"],
  },
  {
    key: "entertainment",
    words: ["電影", "遊戲", "ktv", "唱歌", "netflix", "spotify", "movie"],
  },
  {
    key: "home",
    words: ["房租", "日用品", "家具", "rent"],
  },
  {
    key: "bills",
    words: ["水費", "電費", "瓦斯", "電話費", "網路費", "手機費", "帳單", "bill"],
  },
  {
    key: "health",
    words: ["看醫生", "掛號", "診所", "牙醫", "藥", "doctor", "pharmacy"],
  },
  {
    key: "education",
    words: ["學費", "課程", "補習", "tuition", "course"],
  },
  {
    key: "salary",
    words: ["薪水", "薪資", "月薪", "salary", "wage", "paycheck"],
  },
  {
    key: "bonus",
    words: ["獎金", "年終", "bonus"],
  },
  {
    key: "investment",
    words: ["股利", "股息", "利息", "dividend", "interest"],
  },
];
