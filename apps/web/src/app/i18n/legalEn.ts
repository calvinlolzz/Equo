import type { LegalDocument } from "./legalZhHant";
import { LEGAL_CONTACT_EMAIL } from "./legalZhHant";

/**
 * English privacy policy and terms — a CONVENIENCE TRANSLATION.
 *
 * ⚠️ The 繁體中文 documents in legalZhHant.ts are the authoritative ones. These
 * were translated to keep the substance readable for people who cannot read the
 * originals; a privacy notice nobody can read is not much of a notice. They are
 * NOT a separately-drafted legal instrument, and where the two disagree the
 * Chinese governs — which is what the banner at the top of each says, in both
 * languages, rather than only in the small print of one.
 *
 * That means these have to move together. Editing the Chinese without editing
 * this file leaves an English reader with a promise the product no longer
 * makes, which is worse than no translation at all. The same warning that lives
 * on legalZhHant.ts about naming the AI provider applies here twice over.
 */

const LAST_UPDATED = "Last updated: 3 August 2026";

/** Shown at the top of both English documents. */
export const TRANSLATION_NOTICE =
  "English translation provided for convenience. The Traditional Chinese version is the authoritative one; if the two differ, the Chinese governs.";

export const PRIVACY_POLICY_EN: LegalDocument = {
  title: "Privacy policy",
  updated: LAST_UPDATED,
  intro:
    "This explains what data Equo (“we”) collects about you, what we use it for, who we share it with, and how you can see, export, or delete it.",
  sections: [
    {
      heading: "1. What we collect",
      bullets: [
        "When you sign in with Google: your email address, display name, and Google profile picture. Equo only signs you in with Google — we never see or store your Google password.",
        "What you create in the app: groups, expenses (item, amount, category, note, date), the member names you add (including placeholder members with no account), settlement records, and the images you upload (receipts, group covers, custom avatars).",
        "If you choose to scan a receipt: that photo, and the amount, shop name, date, and items read from it. See section 3.",
        "What you send us: the contents of your feedback.",
        "Recorded automatically: crash information kept so we can fix bugs (the error message and the page it happened on), and the one cookie that keeps you signed in.",
      ],
      paragraphs: [
        "We do not collect your passwords, your contacts, or your precise location, and there is no advertising tracking of any kind.",
      ],
    },
    {
      heading: "2. How we use it",
      bullets: [
        "To run the app: recording expenses, working out balances and who owes whom, and showing that to the other people in your group.",
        "To keep you signed in.",
        "To fix bugs and reply to your feedback.",
      ],
      paragraphs: ["We do not sell your data, and we do not use it for advertising."],
    },
    {
      heading: "3. Receipt recognition (optional)",
      paragraphs: [
        "The scan button on the group home screen photographs a receipt and fills in the amount and shop name automatically. When you use it, that photo is sent to a third-party AI service to be read. If you do not use it, no photo is ever sent anywhere for recognition.",
      ],
      callout: {
        tag: "Currently on a free tier — please read this",
        paragraphs: [
          "The recognition service today is Google Gemini on its free tier. Under Google's terms, content you submit is used by Google to provide, improve, and develop its products and services, and Google's staff may read, annotate, and process it.",
          "A receipt can show where you were, when, what you bought, and sometimes the last four digits of a card. Please use your own judgement about scanning sensitive receipts.",
          "If you would rather no photo went to a third-party AI, do not use the scan button: attach the photo with the camera or gallery control in the expense form instead. It is still attached to the expense, but it stays in our own storage and is never sent for recognition — you just type the amount yourself.",
        ],
      },
    },
    {
      heading: "4. Who can see your data",
      bullets: [
        "Other members of your groups: your name, your picture, and the expenses you record are visible to everyone in the same group. That is what sharing a ledger means.",
        "The providers we use (only to run the service, never for anything else): Google (sign-in), Supabase (database and image storage), Vercel (hosting). Your data is stored on servers in Singapore.",
        "The AI recognition service: only when you scan a receipt, and only that photo. The conditions and risks are in section 3.",
        "When the law requires it: we may have to provide data if lawfully required by a court or authority.",
      ],
    },
    {
      heading: "5. How long we keep it, and what deleting your account does",
      paragraphs: [
        "Your data stays until you delete it. You can delete a single expense, a whole group, or your entire account.",
      ],
      callout: {
        tag: "When you delete your account",
        paragraphs: [
          "We permanently delete your account and your personal details (email, name, picture, Google connection). Signing in again with the same Google account creates a brand-new account.",
          "Groups where you are the only member are deleted along with their entries. Expenses you recorded in groups shared with other people stay, because removing them would break everyone else's balances — but your membership shows as “Deleted user”.",
        ],
      },
    },
    {
      heading: "6. Your rights",
      bullets: [
        "See and correct: change your name, picture, and entries in the app at any time.",
        "Export: every group can be exported as a CSV file.",
        "Delete: Profile → “Delete account”.",
        `Ask: for any question about your data, email ${LEGAL_CONTACT_EMAIL}.`,
      ],
    },
    {
      heading: "7. Cookies",
      paragraphs: [
        "We use one strictly necessary cookie to keep you signed in (equo_session). There are no advertising or cross-site tracking cookies.",
      ],
    },
    {
      heading: "8. Children",
      paragraphs: [
        "This service is not aimed at children under 13, and we do not knowingly collect their data.",
      ],
    },
    {
      heading: "9. Changes and contact",
      paragraphs: [
        `If this policy changes materially we will say so in the app. For any privacy question, contact ${LEGAL_CONTACT_EMAIL}.`,
      ],
    },
  ],
};

export const TERMS_OF_SERVICE_EN: LegalDocument = {
  title: "Terms of service",
  updated: LAST_UPDATED,
  intro: "Please read these terms before using Equo. By using it, you agree to what follows.",
  sections: [
    {
      heading: "1. What Equo is",
      paragraphs: [
        "Equo is a tool for recording what you and your friends, flatmates, or travel companions spend, splitting it, and working out who owes whom.",
      ],
    },
    {
      heading: "2. Eligibility and your account",
      bullets: [
        "You must be at least 13, or the age at which you can agree to online services on your own where you live.",
        "You create an account by signing in with Google, and you are responsible for what happens under it.",
      ],
    },
    {
      heading: "3. What you may and may not do",
      bullets: [
        "You may: record and split what you spend with friends, personally and non-commercially.",
        "You may not: use it unlawfully, upload infringing or illegal content, attack or disrupt the service, or try to reach data that is not yours.",
      ],
    },
    {
      heading: "4. Your content",
      paragraphs: [
        "The entries you record and the images you upload remain yours. You grant us permission to store and process them, and to show them to you and to the other members of your groups, for the purpose of running this service.",
        "When you use receipt scanning, that permission also covers sending the photo to a third-party AI service to be read. The current conditions — including that the provider may use content to improve its own products — are in section 3 of the privacy policy.",
      ],
    },
    {
      heading: "5. Important: Equo does not handle money, and is not financial advice",
      callout: {
        tag: "Please read this",
        paragraphs: [
          "Equo only records and calculates. It never handles actual money: it does not transfer, collect, or hold funds.",
          "The balances and the who-owes-whom figures are worked out from what you entered, and are for reference. Actually paying each other happens between members outside the app. None of it is accounting, tax, or legal advice.",
        ],
      },
    },
    {
      heading: "6. Provided as is",
      paragraphs: [
        "We do our best to keep the service running, but it is provided “as is”, and we do not guarantee that it will be uninterrupted or free of errors. To the extent the law allows, we are not liable for indirect losses arising from your use of it.",
      ],
    },
    {
      heading: "7. Changes and termination",
      bullets: [
        "We may adjust the service or these terms; material changes will be announced in the app.",
        "You can stop using it at any time by deleting your account.",
        "If you abuse the service or breach these terms, we may suspend or end your access.",
      ],
    },
    {
      heading: "8. Governing law and jurisdiction",
      paragraphs: [
        "These terms are governed by the laws of the Republic of China (Taiwan). Disputes arising from this service fall to the courts of Taiwan.",
      ],
    },
    {
      heading: "9. Contact us",
      paragraphs: [`For any question about these terms, contact ${LEGAL_CONTACT_EMAIL}.`],
    },
  ],
};
