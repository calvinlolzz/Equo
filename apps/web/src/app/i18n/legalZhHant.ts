import { LEGAL_CONTACT_EMAIL } from "../legalContact";

/**
 * The privacy policy and terms of service shown in the profile dialog's
 * info sub-sheet. Kept out of uiText.ts because it is long-form prose, not
 * interface labels.
 *
 * Static-in-code by design (see the launch-readiness decision): the text
 * changes rarely enough that editing it here and shipping a deploy is simpler
 * than a DB-backed admin editor. If it ever needs to change without a deploy,
 * move these documents into a table + an admin console editor and fetch the
 * published version — the renderer in ProfileDialog only needs the same shape.
 *
 * Plain-language, Traditional Chinese, ROC (Taiwan) jurisdiction. Reviewed and
 * approved 2026-07-25; receipt-recognition disclosure added 2026-08-03.
 * Contact: support@equomu.com.
 *
 * ⚠️ The receipt-recognition section names the AI provider and its tier, because
 * under a free tier the provider may train on the content and have humans read
 * it — which is a materially different promise from an ordinary sub-processor.
 * Changing the provider or moving to a paid plan makes that text wrong, so the
 * admin console's model picker carries a reminder to come back here.
 *
 * The provider is named in ONE other place: uiText.ts's scanConsentBody, the
 * dialog shown before the camera opens. Both have to move together — the
 * admin console's reminder lists both files.
 */

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  /** A highlighted aside — the "what deletion does" / "not a payment app" boxes. */
  callout?: { tag: string; paragraphs: string[] };
};

export type LegalDocument = {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
};

const LAST_UPDATED = "最後更新：2026 年 8 月 3 日";

export const PRIVACY_POLICY_ZH: LegalDocument = {
  title: "隱私權政策",
  updated: LAST_UPDATED,
  intro:
    "這份說明 Equo（下稱「我們」）會收集你哪些資料、拿來做什麼、跟誰分享，以及你可以怎麼查看、匯出或刪除。",
  sections: [
    {
      heading: "1. 我們收集哪些資料",
      bullets: [
        "你用 Google 登入時：你的電子郵件、顯示名稱，以及 Google 頭像。Equo 只用 Google 登入，我們看不到、也不儲存你的 Google 密碼。",
        "你在 App 裡建立的內容：群組、支出記錄（品項、金額、分類、備註、日期）、你新增的成員名稱（含沒有帳號的「虛擬成員」）、清償記錄，以及你上傳的圖片（收據、群組封面、自訂頭像）。",
      "你選擇使用掃描收據時：那張收據照片，以及從照片辨識出來的金額、店名、日期與品項。詳見第 3 節。",
        "你主動送出的：意見回饋的內容。",
        "系統自動記錄的：為了修正錯誤而記下的當機資訊（錯誤訊息與當下頁面），以及維持登入所需的一個 cookie。",
      ],
      paragraphs: ["我們不收集你的密碼、通訊錄、精確位置，也沒有任何廣告追蹤。"],
    },
    {
      heading: "2. 我們怎麼使用這些資料",
      bullets: [
        "提供分帳功能：記帳、計算餘額與「誰欠誰」、把資料顯示給同群組的成員。",
        "維持你的登入狀態。",
        "修正錯誤、回覆你的意見回饋。",
      ],
      paragraphs: ["我們不會把你的資料賣給別人，也不會拿來投放廣告。"],
    },
    {
      heading: "3. 收據辨識（選用功能）",
      paragraphs: [
        "群組首頁的掃描鈕可以拍下收據，自動填入金額與店名。使用這個功能時，那張照片會傳送給第三方 AI 服務進行辨識。不使用這個功能，就不會有任何照片被送出去辨識。",
      ],
      callout: {
        tag: "目前使用免費方案，請務必理解",
        paragraphs: [
          "現在的辨識服務是 Google Gemini 的免費方案。依 Google 的服務條款，送出的內容會被 Google 用於提供、改善及開發其產品與服務，且 Google 的人員可能會閱讀、標註與處理這些內容。",
          "收據上可能有消費地點、時間、購買品項，甚至信用卡號末四碼。請自行斟酌要不要用掃描功能拍攝敏感的收據。",
          "不想讓照片經過第三方 AI，就不要用掃描鈕：改用記帳表單裡的照片功能挑選或拍攝，照片一樣會附在支出上，但只會存在我們自己的儲存空間，不會送去辨識，金額則需要手動輸入。",
        ],
      },
    },
    {
      heading: "4. 誰看得到你的資料",
      bullets: [
        "同群組的其他成員：你的名字、頭像，以及你記的帳，會被同一個群組裡的人看到——這是共同分帳本來就需要的。",
        "我們委託的服務商（只用於提供服務、不會另作他用）：Google（登入）、Supabase（資料庫與圖片儲存）、Vercel（網站代管）。你的資料存放在位於新加坡的伺服器。",
        "AI 辨識服務：只有在你使用掃描收據時，該張照片會送給 Google Gemini。條件與風險見第 3 節。",
        "法律要求時：當法律或主管機關依法要求，我們可能需要提供必要資料。",
      ],
    },
    {
      heading: "5. 資料會保留多久，刪帳號會發生什麼",
      paragraphs: [
        "你的資料會一直保留，直到你自己刪除為止——你可以刪掉單筆支出、整個群組，或整個帳號。",
      ],
      callout: {
        tag: "刪除帳號時",
        paragraphs: [
          "我們會永久刪除你的帳號與個人資料（電子郵件、名字、頭像、Google 綁定），用同一個 Google 帳號重新登入會是全新帳號。",
          "你自己一個人的群組會連同帳目一起刪除。你在和別人共用的群組裡記的帳，會保留給其他成員（否則會弄壞他們的餘額計算），但你的成員身分會顯示為「已刪除的使用者」。",
        ],
      },
    },
    {
      heading: "6. 你的權利",
      bullets: [
        "查看與更正：隨時在 App 內修改你的名字、頭像與帳目。",
        "匯出：每個群組都可以匯出成 CSV 檔。",
        "刪除：個人資料頁 →「刪除帳號」。",
        `詢問：對你的資料有任何疑問，寄信到 ${LEGAL_CONTACT_EMAIL}。`,
      ],
    },
    {
      heading: "7. Cookie",
      paragraphs: [
        "我們只用一個維持登入的必要 cookie（equo_session），沒有任何廣告或跨站追蹤 cookie。",
      ],
    },
    {
      heading: "8. 兒童",
      paragraphs: ["本服務不面向 13 歲以下的兒童，也不會刻意收集他們的資料。"],
    },
    {
      heading: "9. 政策變更與聯絡",
      paragraphs: [
        `若這份政策有重大變更，我們會在 App 內告知。有任何隱私相關問題，請聯絡 ${LEGAL_CONTACT_EMAIL}。`,
      ],
    },
  ],
};

export const TERMS_OF_SERVICE_ZH: LegalDocument = {
  title: "服務條款",
  updated: LAST_UPDATED,
  intro: "使用 Equo 前請先讀這份條款。開始使用，就表示你同意以下內容。",
  sections: [
    {
      heading: "1. Equo 是什麼",
      paragraphs: ["Equo 是一個幫你和朋友、室友、旅伴記帳、分攤、計算誰欠誰的工具。"],
    },
    {
      heading: "2. 使用資格與你的帳號",
      bullets: [
        "你需要年滿 13 歲（或你所在地可獨立同意使用網路服務的年齡）。",
        "你用 Google 登入建立帳號，並為在你帳號下發生的活動負責。",
      ],
    },
    {
      heading: "3. 可以怎麼用、不可以怎麼用",
      bullets: [
        "可以：個人、非商業地記錄與分攤你和朋友之間的花費。",
        "不可以：用於違法用途、上傳侵權或違法內容、攻擊或干擾服務，或嘗試存取不屬於你的資料。",
      ],
    },
    {
      heading: "4. 你的內容",
      paragraphs: [
        "你記的帳與上傳的圖片仍然屬於你。你授權我們為了「提供這個服務」而儲存、處理，並把這些內容顯示給你和你的同群組成員。",
        "當你使用掃描收據功能時，這份授權也包含把該張照片傳送給第三方 AI 服務進行辨識。該服務目前的條件（包含其可能將內容用於改善自身產品）詳見隱私權政策第 3 節。",
      ],
    },
    {
      heading: "5. 重要：Equo 不經手金錢，也不是財務建議",
      callout: {
        tag: "請務必理解",
        paragraphs: [
          "Equo 只是幫你記錄與計算的工具。它不經手任何實際款項，不轉帳、不代收代付。",
          "畫面上的餘額與「誰欠誰」，只是根據你輸入的資料算出來的參考；實際還錢由成員自己在 App 之外處理。計算結果不構成會計、稅務或法律建議。",
        ],
      },
    },
    {
      heading: "6. 服務照現狀提供",
      paragraphs: [
        "我們會盡力維持服務正常運作，但服務是「照現狀」提供，我們不保證它完全不中斷或永遠沒有錯誤。在法律允許的範圍內，我們不對因使用服務而產生的間接損失負責。",
      ],
    },
    {
      heading: "7. 變更與終止",
      bullets: [
        "我們可能會調整服務或這份條款；有重大變更會在 App 內告知。",
        "你隨時可以刪除帳號停止使用。",
        "若你濫用服務或違反條款，我們可以暫停或終止你的使用權。",
      ],
    },
    {
      heading: "8. 準據法與管轄",
      paragraphs: [
        "這份條款以中華民國（台灣）法律為準據法。因本服務所生的爭議，以台灣的法院為管轄法院。",
      ],
    },
    {
      heading: "9. 聯絡我們",
      paragraphs: [`對這份條款有任何問題，請聯絡 ${LEGAL_CONTACT_EMAIL}。`],
    },
  ],
};
