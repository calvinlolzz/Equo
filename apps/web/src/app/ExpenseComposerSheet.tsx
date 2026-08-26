import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, Delete, Plus, X } from "lucide-react";
import type { Expense, Member } from "./appTypes";
import { createApiClient, type ExchangeRatesResponse } from "./apiClient";
import { COMPOSER_MODES, getComposerSubmitState, type ComposerMode } from "./expenseComposer";
import { convertToGroupAmountMinor, readLastCurrency, writeLastCurrency } from "./expenseCurrency";
import { canSubmitExpenseDraft, canSubmitTransferDraft } from "./expenseDraft";
import { formatExchangeRate, loadCrossRate } from "./exchangeRates";
import { isComposerDirty, type ComposerSnapshot } from "./expenseComposerDirty";
import {
  buildExpenseDuplicatePrefill,
  buildExpenseEditPrefill,
  type ComposerSplitMode,
} from "./expenseEditPrefill";
import { downscaleImageFileToDataUrl } from "./expenseImage";
import { MAX_EXPENSE_IMAGES } from "../contracts/validation";
import { buildReceiptComposerPrefill, type ReceiptPrefill } from "./receiptPrefill";
import { formatAmount, formatAmountInputDisplay, stripAmountInput } from "./formatAmount";
import {
  buildEqualShareAmountsMinor,
  buildPercentShareAmounts,
  getCustomSplitRemainderMinor,
  getPaymentsRemainderMinor,
  getPercentSplitRemainder,
} from "./expenseShareSplit";
import { MemberAvatar } from "./MemberAvatar";
import { useSwipeToDismiss } from "./useSwipeToDismiss";
import { mergeRefs, useDialogChrome } from "./useDialogChrome";
import { categoryLabel as lookupCategoryLabel, categoryOptions } from "./catalog";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

/** Custom numeric keypad layout for the mobile amount step (matches the demo's
 *  step 1). "." replaces the demo's "00" so decimal splits stay reachable. */
const KEYPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"] as const;

type StepKey = "amount" | "details" | "payer" | "split" | "transferPair" | "transferNote";

/** The composer becomes a stepped bottom-sheet at the phone breakpoint (the
 *  same 620px cutoff the sheet layout uses); wider viewports keep the single
 *  scrolling form. */
function useIsPhone(): boolean {
  const query = "(max-width: 620px)";
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function stepKeysForMode(mode: ComposerMode): StepKey[] {
  if (mode === "transfer") return ["amount", "transferPair", "transferNote"];
  return ["amount", "details", "payer", "split"];
}

function toLocalDateTimeInputValue(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function amountMinorToInputString(amountMinor: number) {
  return ((amountMinor / 100).toFixed(2)).replace(/\.00$/, "");
}

/** Trim float noise for the percent remainder display (e.g. 33.330000000000005 -> 33.33). */
function formatPercent(value: number) {
  return `${Number(value.toFixed(2))}%`;
}

/**
 * Equal percents that sum to EXACTLY 100 at two decimals (basis points +
 * floor/remainder, mirroring buildEqualShareAmountsMinor's pattern), used
 * to seed the 比例 inputs when switching into percent mode.
 */
function buildEqualPercentStrings(memberIds: string[]): Record<string, string> {
  if (memberIds.length === 0) return {};
  const baseBasisPoints = Math.floor(10000 / memberIds.length);
  const remainder = 10000 - baseBasisPoints * memberIds.length;
  const result: Record<string, string> = {};
  memberIds.forEach((memberId, index) => {
    const basisPoints = baseBasisPoints + (index < remainder ? 1 : 0);
    result[memberId] = (basisPoints / 100).toString();
  });
  return result;
}

/**
 * Composer-facing draft. Field semantics vary by kind (see cloudAdapters):
 * - kind "expense" (default): payerId/payments = who paid, shareMemberIds =
 *   who owes, shareAmountsMinor/sharePercents = the split.
 * - kind "income": payerId = the single collector who holds the money,
 *   shareMemberIds = the beneficiaries who own it, shareAmountsMinor/
 *   sharePercents = how it is divided among the beneficiaries.
 * - kind "transfer": payerId = the member handing money over (轉出),
 *   transferToMemberId = the recipient (轉入); shareMemberIds = [recipient].
 */
export type ExpenseDraft = {
  title: string;
  amountMinor: number;
  createdAt: string;
  payerId: string;
  shareMemberIds: string[];
  category: string;
  kind?: "expense" | "income" | "transfer";
  note?: string;
  /** Newly picked photos, still local - the submit flow uploads them. */
  imageDataUrls?: string[];
  /** Receipts already in the bucket, carried through an edit unchanged. */
  imageUrls?: string[];
  shareAmountsMinor?: Record<string, number>;
  shareType?: "fixed" | "percent";
  sharePercents?: Record<string, number>;
  payments?: Array<{ payerId: string; amountMinor: number }>;
  transferToMemberId?: string;
  sourceCurrency?: string;
  sourceAmountMinor?: number;
  exchangeRate?: number;
};

type PayerRow = { key: number; payerId: string; amount: string };

/** The composer's own reach for the daily rates; overridable so tests never hit the network. */
function defaultFetchExchangeRates(base: string): Promise<ExchangeRatesResponse> {
  return createApiClient().getExchangeRates(base);
}

export function ExpenseComposerSheet({
  members,
  groupId = "",
  groupCurrency,
  currencyOptions,
  initialExpense,
  duplicating = false,
  receiptPrefill,
  scanPending = false,
  onClose,
  onDirtyChange,
  onSubmit,
  onImageError,
  fetchExchangeRates = defaultFetchExchangeRates,
}: {
  members: Member[];
  /** Scopes the "last currency used here" memory. Empty disables it (tests, previews). */
  groupId?: string;
  groupCurrency: string;
  currencyOptions: Array<{ code: string; label: string }>;
  initialExpense?: Expense;
  /**
   * Open initialExpense as the starting point for a NEW entry rather than an
   * edit of that one: same split, payers and note, today's date, no receipt
   * photo. The submit path is unchanged - the owner decides create vs. replace
   * by whether it is holding an editing expense.
   */
  duplicating?: boolean;
  /**
   * Open as a NEW entry seeded from a scanned receipt: the photo is attached
   * and whatever the model could read is filled in. Mutually exclusive with
   * initialExpense — a scan always starts a new expense, never edits one.
   */
  receiptPrefill?: ReceiptPrefill;
  /**
   * A scan is still in flight for the photo above. Purely a hint: the sheet is
   * fully usable meanwhile, and anything typed now survives the result.
   */
  scanPending?: boolean;
  /**
   * Asks to close. May decline and put the discard confirm up instead — see
   * onDirtyChange — so this sheet never animates itself away on the way out.
   */
  onClose: () => void;
  /**
   * Reports whether closing would throw work away, so the owner can put a
   * confirm in front of every close path it controls (including the Back
   * button, which never passes through this component). Always reports clean
   * on unmount, so a discarded draft can't leave the flag stuck on.
   */
  onDirtyChange?: (dirty: boolean) => void;
  onSubmit: (draft: ExpenseDraft) => void | Promise<void>;
  onImageError?: () => void;
  fetchExchangeRates?: (base: string) => Promise<ExchangeRatesResponse>;
}) {
  const editPrefill = useMemo(
    () => {
      if (initialExpense) {
        return duplicating
          ? buildExpenseDuplicatePrefill(initialExpense, groupCurrency, new Date().toISOString())
          : buildExpenseEditPrefill(initialExpense, groupCurrency);
      }
      if (receiptPrefill) {
        return buildReceiptComposerPrefill(receiptPrefill, {
          groupCurrency,
          currencyCodes: currencyOptions.map((option) => option.code),
          memberIds: members.map((member) => member.id),
          nowIso: new Date().toISOString(),
        });
      }
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // Only a real edit replaces an existing expense. A duplicate is seeded from
  // one but saves as new, so it takes the create labels and the auto rate.
  const isEditing = Boolean(initialExpense) && !duplicating;
  const [composerMode, setComposerMode] = useState<ComposerMode>(editPrefill?.mode ?? "expense");
  const [composerCategory, setComposerCategory] = useState<string>(editPrefill?.category ?? "general");
  const [composerDateTime, setComposerDateTime] = useState<string>(() =>
    toLocalDateTimeInputValue(editPrefill?.dateTimeIso ?? new Date().toISOString()),
  );
  // Seeded, not assigned later: the dirty baseline is this first render's
  // state, so a remembered currency must be in place before it is captured or
  // closing an untouched sheet would raise the discard confirm.
  const [composerCurrency, setComposerCurrency] = useState<string>(() => {
    if (editPrefill) return editPrefill.currency;
    const remembered = readLastCurrency(groupId);
    return currencyOptions.some((option) => option.code === remembered) ? remembered : groupCurrency;
  });
  const [composerExchangeRate, setComposerExchangeRate] = useState<string>(editPrefill?.exchangeRate ?? "1");
  /** Publication date of an auto-filled rate; empty once the user types their own. */
  const [autoRateDate, setAutoRateDate] = useState<string>("");
  const manualRateRef = useRef(false);
  const [composerTitle, setComposerTitle] = useState<string>(editPrefill?.title ?? "");
  const [composerAmount, setComposerAmount] = useState(editPrefill?.amount ?? "");
  const [composerPayerId, setComposerPayerId] = useState(editPrefill?.payerId ?? members[0]?.id ?? "");
  const [composerTransferToId, setComposerTransferToId] = useState<string>(() => {
    if (editPrefill?.transferToMemberId) return editPrefill.transferToMemberId;
    const fromId = editPrefill?.payerId ?? members[0]?.id ?? "";
    return members.find((member) => member.id !== fromId)?.id ?? "";
  });
  const [composerShareIds, setComposerShareIds] = useState<string[]>(
    editPrefill?.shareMemberIds.length ? editPrefill.shareMemberIds : members.map((member) => member.id),
  );
  const [composerPayerExpanded, setComposerPayerExpanded] = useState(false);
  const [composerTransferToExpanded, setComposerTransferToExpanded] = useState(false);
  const [composerSplitMode, setComposerSplitMode] = useState<ComposerSplitMode>(editPrefill?.splitMode ?? "equal");
  const [composerShareAmounts, setComposerShareAmounts] = useState<Record<string, string>>(editPrefill?.shareAmounts ?? {});
  const [composerSharePercents, setComposerSharePercents] = useState<Record<string, string>>(
    editPrefill?.sharePercents ?? {},
  );
  const [composerPayerRows, setComposerPayerRows] = useState<PayerRow[]>(() =>
    (editPrefill?.payments ?? []).map((payment, index) => ({ key: index, payerId: payment.payerId, amount: payment.amount })),
  );
  const payerRowKeyRef = useRef(editPrefill?.payments.length ?? 0);
  // Two lists, not one: a freshly picked photo has to be uploaded before the
  // entry can be written, while an existing one is already in the bucket and
  // must be carried through untouched. Merging them would either re-upload
  // files that are already stored or try to save a data: URL as a receipt.
  const [composerImageDataUrls, setComposerImageDataUrls] = useState<string[]>(
    receiptPrefill?.imageDataUrl ? [receiptPrefill.imageDataUrl] : [],
  );
  const [composerImageUrls, setComposerImageUrls] = useState<string[]>(editPrefill?.imageUrls ?? []);
  const composerImageCount = composerImageUrls.length + composerImageDataUrls.length;
  const [composerNote, setComposerNote] = useState(editPrefill?.note ?? "");
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  // Synchronous double-submit guard: composerSubmitting is React state, so
  // two rapid clicks on the submit button can both read it as false before
  // the first click's setState commits. This ref is set/checked in the same
  // tick the click handler runs, closing that race.
  const composerSubmittingRef = useRef(false);

  // "Has this sheet been touched?", against the values it opened with. The ref
  // keeps its first-render argument forever, so the baseline is exactly the
  // seeded state above — no second copy of the seeding rules to drift out of
  // step with them.
  const snapshot: ComposerSnapshot = {
    mode: composerMode,
    category: composerCategory,
    dateTime: composerDateTime,
    currency: composerCurrency,
    exchangeRate: composerExchangeRate,
    title: composerTitle,
    amount: composerAmount,
    payerId: composerPayerId,
    transferToId: composerTransferToId,
    shareIds: composerShareIds,
    splitMode: composerSplitMode,
    shareAmounts: composerShareAmounts,
    sharePercents: composerSharePercents,
    payerRows: composerPayerRows,
    imageDataUrls: composerImageDataUrls,
    imageUrls: composerImageUrls,
    note: composerNote,
  };
  // Mutable on purpose: an auto-filled exchange rate is not the user's work,
  // so applying one moves the baseline with it (see the auto-rate effect
  // below). Everything else keeps the open-time values forever.
  const initialSnapshot = useRef(snapshot);
  // A submit in flight is on its way to being saved, so it is not unsaved work
  // — without this the success path would trip the discard confirm on its way
  // out.
  const dirty = !composerSubmitting && isComposerDirty(initialSnapshot.current, snapshot);

  /**
   * A scan that lands after the sheet is already open.
   *
   * The composer opens the instant the shutter fires and the recognised fields
   * arrive several seconds later, so this fills in what it can without ever
   * overwriting the user: a field is only touched while it still holds the
   * value the sheet opened with. Somebody who got impatient and typed the
   * amount themselves keeps their number.
   *
   * Each filled field moves the dirty baseline with it, the same way an
   * auto-filled exchange rate does — neither is the user's work, and without
   * this, closing an untouched scanned draft would raise the discard confirm.
   */
  const scanApplied = useRef(false);

  useEffect(() => {
    const scan = receiptPrefill?.scan;
    if (!scan?.recognised || scanApplied.current) return;
    scanApplied.current = true;

    const filled = buildReceiptComposerPrefill(
      { imageDataUrl: receiptPrefill?.imageDataUrl ?? "", scan },
      {
        groupCurrency,
        currencyCodes: currencyOptions.map((option) => option.code),
        memberIds: members.map((member) => member.id),
        nowIso: new Date().toISOString(),
      },
    );

    const base = initialSnapshot.current;
    const moved: Partial<ComposerSnapshot> = {};

    if (filled.amount && composerAmount === base.amount) {
      setComposerAmount(filled.amount);
      moved.amount = filled.amount;
    }
    if (filled.title && composerTitle === base.title) {
      setComposerTitle(filled.title);
      moved.title = filled.title;
    }
    if (filled.category && composerCategory === base.category) {
      setComposerCategory(filled.category);
      moved.category = filled.category;
    }
    if (composerDateTime === base.dateTime) {
      const dateTime = toLocalDateTimeInputValue(filled.dateTimeIso);
      setComposerDateTime(dateTime);
      moved.dateTime = dateTime;
    }
    if (filled.note && composerNote === base.note) {
      setComposerNote(filled.note);
      moved.note = filled.note;
    }
    if (filled.currency !== composerCurrency && composerCurrency === base.currency) {
      setComposerCurrency(filled.currency);
      moved.currency = filled.currency;
      // Mirrors the picker's own handler: a rate that belonged to the old
      // currency means nothing for the new one, so the auto fill takes over.
      manualRateRef.current = false;
      setAutoRateDate("");
    }

    initialSnapshot.current = { ...base, ...moved };
    // Runs once, when the scan resolves. The field values are read from the
    // render that carried it, which is exactly "current at that moment".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptPrefill?.scan]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  // Mobile drag-to-dismiss for the bottom sheet.
  const { closing: composerClosing, requestClose, dragProps } = useSwipeToDismiss(onClose, {
    // With unsaved work, onClose raises the discard confirm rather than
    // closing. Sliding out first would put an empty screen behind that dialog
    // and then snap the sheet back when the user chooses 繼續編輯.
    closeInstantly: () => dirty,
  });
  const chromeRef = useDialogChrome(requestClose);
  const sheetRef = useMemo(
    () => mergeRefs<HTMLElement>(dragProps.ref, chromeRef),
    [dragProps.ref, chromeRef],
  );

  // Stepped flow on phones: one field group per step (amount -> details ->
  // payer -> split), mirroring the app demo. Wider layouts keep the single
  // scrolling form below. stepIndex is clamped to the current mode's step
  // count so switching modes never lands on a nonexistent step.
  const isPhone = useIsPhone();
  const stepKeys = stepKeysForMode(composerMode);
  const [stepIndex, setStepIndex] = useState(0);
  const activeStep = Math.min(stepIndex, stepKeys.length - 1);
  const isLastStep = activeStep === stepKeys.length - 1;

  function selectComposerMode(mode: ComposerMode) {
    setComposerMode(mode);
    setStepIndex(0);
  }

  function pressKeypad(key: (typeof KEYPAD_KEYS)[number]) {
    setComposerAmount((current) =>
      key === "del" ? stripAmountInput(current.slice(0, -1)) : stripAmountInput(current + key),
    );
  }

  function stepTitle(key: StepKey): string {
    switch (key) {
      case "amount":
        return text.stepAmountTitle;
      case "details":
        return text.stepDetailsTitle;
      case "payer":
        return composerMode === "income" ? text.stepPayerIncomeTitle : text.stepPayerTitle;
      case "split":
        return text.stepSplitTitle;
      case "transferPair":
        return text.stepTransferPairTitle;
      case "transferNote":
        return text.stepTransferNoteTitle;
    }
  }

  const composerNeedsExchangeRate = composerCurrency !== groupCurrency;

  /**
   * Pre-fill 匯率 from the daily reference rates whenever a foreign currency is
   * picked. Nobody standing at a till wants to go look this up, and the number
   * that used to sit there was a hardcoded 1 - silently wrong for every
   * foreign-currency expense someone forgot to correct.
   *
   * Never touches an edit: that rate is the historical one the split was
   * computed from. Never overrides a rate the user typed, and applying one
   * moves the dirty baseline, because a value the sheet filled in by itself is
   * not work worth putting a discard confirm in front of.
   */
  useEffect(() => {
    if (isEditing || !composerNeedsExchangeRate || manualRateRef.current) return;

    let cancelled = false;
    loadCrossRate({
      base: groupCurrency,
      from: composerCurrency,
      to: groupCurrency,
      fetchRates: fetchExchangeRates,
    })
      .then((result) => {
        if (cancelled || !result || manualRateRef.current) return;
        const formatted = formatExchangeRate(result.rate);
        if (!formatted) return;
        setComposerExchangeRate(formatted);
        initialSnapshot.current = { ...initialSnapshot.current, exchangeRate: formatted };
        setAutoRateDate(result.date);
      })
      .catch(() => {
        // Every failure mode already resolves to null inside loadCrossRate;
        // this is belt-and-braces so a rejected promise can never surface as
        // an unhandled rejection while someone is mid-expense.
      });

    return () => {
      cancelled = true;
    };
  }, [composerCurrency, composerNeedsExchangeRate, fetchExchangeRates, groupCurrency, isEditing]);

  const composerTotalAmountMinor = composerNeedsExchangeRate
    ? convertToGroupAmountMinor({ amount: composerAmount, exchangeRate: composerExchangeRate })
    : Math.round((Number(composerAmount) || 0) * 100);
  const composerEqualShareAmountsMinor = useMemo(
    () => buildEqualShareAmountsMinor(composerShareIds, composerTotalAmountMinor),
    [composerShareIds, composerTotalAmountMinor],
  );
  const composerCustomShareAmountsMinor = useMemo(() => {
    const result: Record<string, number> = {};
    composerShareIds.forEach((id) => {
      result[id] = Math.round((Number(composerShareAmounts[id]) || 0) * 100);
    });
    return result;
  }, [composerShareIds, composerShareAmounts]);
  const composerSharePercentValues = useMemo(() => {
    const result: Record<string, number> = {};
    composerShareIds.forEach((id) => {
      result[id] = Number(composerSharePercents[id]) || 0;
    });
    return result;
  }, [composerShareIds, composerSharePercents]);
  const composerPercentPreviewAmountsMinor = useMemo(
    () => buildPercentShareAmounts(composerShareIds, composerSharePercentValues, composerTotalAmountMinor),
    [composerShareIds, composerSharePercentValues, composerTotalAmountMinor],
  );

  const isMultiPayer = composerPayerRows.length > 1;
  const composerPaymentAmountsMinor = useMemo(() => {
    const result: Record<string, number> = {};
    composerPayerRows.forEach((row) => {
      result[String(row.key)] = Math.round((Number(row.amount) || 0) * 100);
    });
    return result;
  }, [composerPayerRows]);
  const composerPaymentsRemainderMinor = getPaymentsRemainderMinor({
    totalAmountMinor: composerTotalAmountMinor,
    paymentAmountsMinor: composerPaymentAmountsMinor,
  });
  const composerRemainderMinor = getCustomSplitRemainderMinor({
    totalAmountMinor: composerTotalAmountMinor,
    shareAmountsMinor: composerCustomShareAmountsMinor,
  });
  const composerPercentRemainder = getPercentSplitRemainder(composerShareIds, composerSharePercentValues);

  const canSubmit =
    composerMode === "transfer"
      ? canSubmitTransferDraft({
          amount: composerAmount,
          fromMemberId: composerPayerId,
          toMemberId: composerTransferToId,
        })
      : canSubmitExpenseDraft({
          amount: composerAmount,
          selectedShareMemberCount: composerShareIds.length,
          totalAmountMinor: composerTotalAmountMinor,
          shareAmountsMinor: composerCustomShareAmountsMinor,
          splitMode: composerSplitMode,
          shareMemberIds: composerShareIds,
          sharePercents: composerSharePercentValues,
          paymentAmountsMinor: composerMode === "expense" && isMultiPayer ? composerPaymentAmountsMinor : undefined,
        });
  const composerSubmitState = getComposerSubmitState({
    mode: composerMode,
    canSubmit,
    isEditing,
  });
  const composerPayer = members.find((member) => member.id === composerPayerId) ?? members[0];
  const composerTransferTo = members.find((member) => member.id === composerTransferToId) ?? null;

  function toggleComposerShareMember(memberId: string) {
    setComposerShareIds((current) => {
      if (current.includes(memberId)) {
        if (current.length <= 1) return current;
        return current.filter((id) => id !== memberId);
      }
      return [...current, memberId];
    });
  }

  function seedShareAmountsEvenly() {
    const equalShares = buildEqualShareAmountsMinor(composerShareIds, composerTotalAmountMinor);
    const nextShareAmounts: Record<string, string> = {};
    composerShareIds.forEach((id) => {
      nextShareAmounts[id] = amountMinorToInputString(equalShares[id] ?? 0);
    });
    setComposerShareAmounts(nextShareAmounts);
  }

  function seedSharePercentsEvenly() {
    setComposerSharePercents(buildEqualPercentStrings(composerShareIds));
  }

  function selectSplitMode(mode: ComposerSplitMode) {
    if (mode === composerSplitMode) return;
    if (mode === "amount") seedShareAmountsEvenly();
    if (mode === "percent") seedSharePercentsEvenly();
    setComposerSplitMode(mode);
  }

  function nextPayerRowKey() {
    payerRowKeyRef.current += 1;
    return payerRowKeyRef.current;
  }

  function addPayerRow() {
    if (composerPayerRows.length === 0) {
      const firstId = composerPayerId || members[0]?.id || "";
      const secondId = members.find((member) => member.id !== firstId)?.id ?? firstId;
      setComposerPayerRows([
        { key: nextPayerRowKey(), payerId: firstId, amount: composerAmount },
        { key: nextPayerRowKey(), payerId: secondId, amount: "" },
      ]);
      setComposerPayerExpanded(false);
      return;
    }
    const used = new Set(composerPayerRows.map((row) => row.payerId));
    const nextId = members.find((member) => !used.has(member.id))?.id ?? members[0]?.id ?? "";
    setComposerPayerRows([...composerPayerRows, { key: nextPayerRowKey(), payerId: nextId, amount: "" }]);
  }

  function removePayerRow(key: number) {
    const next = composerPayerRows.filter((row) => row.key !== key);
    if (next.length <= 1) {
      // Collapse back to the zero-effort single payer that auto-tracks the
      // total amount.
      if (next[0]) setComposerPayerId(next[0].payerId);
      setComposerPayerRows([]);
      return;
    }
    setComposerPayerRows(next);
  }

  function updatePayerRow(key: number, patch: Partial<Pick<PayerRow, "payerId" | "amount">>) {
    setComposerPayerRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function handleComposerImagePick(file: File | null) {
    if (!file) return;
    // Checked here as well as on the server so the cap is felt as "the button
    // is gone", not as a rejected save after the work of picking.
    if (composerImageCount >= MAX_EXPENSE_IMAGES) return;
    try {
      const dataUrl = await downscaleImageFileToDataUrl(file);
      setComposerImageDataUrls((current) => [...current, dataUrl]);
    } catch {
      onImageError?.();
    }
  }

  /**
   * Remove one receipt. The two lists are addressed as if they were one - the
   * uploaded ones first, then the pending ones - because that is the order the
   * user sees, and asking the UI which list a thumbnail came from would put the
   * split between "stored" and "not yet stored" on screen, where it means
   * nothing to anybody.
   */
  function removeComposerImage(index: number) {
    if (index < composerImageUrls.length) {
      setComposerImageUrls((current) => current.filter((_, at) => at !== index));
      return;
    }
    const pendingIndex = index - composerImageUrls.length;
    setComposerImageDataUrls((current) => current.filter((_, at) => at !== pendingIndex));
  }

  function buildDraft(): ExpenseDraft | null {
    if (members.length === 0 || !canSubmit) return null;
    const createdAt = composerDateTime ? new Date(composerDateTime).toISOString() : new Date().toISOString();

    let draft: ExpenseDraft;
    if (composerMode === "transfer") {
      draft = {
        title: composerTitle.trim() || text.transferDefaultTitle,
        amountMinor: composerTotalAmountMinor,
        createdAt,
        payerId: composerPayerId,
        shareMemberIds: [composerTransferToId],
        category: "general",
        kind: "transfer",
        transferToMemberId: composerTransferToId,
        note: composerNote.trim() || undefined,
        shareAmountsMinor: { [composerTransferToId]: composerTotalAmountMinor },
      };
    } else {
      const categoryLabel = lookupCategoryLabel(composerCategory);
      draft = {
        title: composerTitle.trim() || categoryLabel,
        amountMinor: composerTotalAmountMinor,
        createdAt,
        payerId: composerPayerId || members[0].id,
        shareMemberIds: composerShareIds,
        category: composerCategory,
        kind: composerMode,
        note: composerNote.trim() || undefined,
        // Both always present, even when empty. An empty list is a statement -
        // "this entry has no receipts" - and the server only falls back to the
        // legacy single field when the list is ABSENT, so omitting them here
        // would make removing the last photo silently fail to save.
        imageDataUrls: composerImageDataUrls,
        imageUrls: composerImageUrls,
      };
      if (composerSplitMode === "amount") {
        draft.shareAmountsMinor = composerCustomShareAmountsMinor;
      } else if (composerSplitMode === "percent") {
        draft.shareType = "percent";
        draft.sharePercents = composerSharePercentValues;
      }
      if (composerMode === "expense" && isMultiPayer) {
        draft.payments = composerPayerRows.map((row) => ({
          payerId: row.payerId,
          amountMinor: Math.round((Number(row.amount) || 0) * 100),
        }));
      }
    }

    if (composerNeedsExchangeRate) {
      draft.sourceCurrency = composerCurrency;
      draft.sourceAmountMinor = Math.round((Number(composerAmount) || 0) * 100);
      draft.exchangeRate = Number(composerExchangeRate) || 1;
    }
    return draft;
  }

  async function submitComposer() {
    if (composerSubmittingRef.current) return;
    const draft = buildDraft();
    if (!draft) return;
    composerSubmittingRef.current = true;
    setComposerSubmitting(true);
    try {
      // Written before the await, because the owner unmounts this sheet on
      // success. Creates only: fixing the currency on a months-old expense
      // says nothing about what the next new one should default to.
      if (!isEditing) writeLastCurrency(groupId, composerCurrency);
      await onSubmit(draft);
    } finally {
      composerSubmittingRef.current = false;
      setComposerSubmitting(false);
    }
  }

  function renderMemberChipGrid(activeId: string, onPick: (memberId: string) => void) {
    return (
      <div className="payer-chip-grid">
        {members.map((member) => (
          <button
            className={member.id === activeId ? "payer-chip active" : "payer-chip"}
            type="button"
            key={member.id}
            onClick={() => onPick(member.id)}
          >
            <MemberAvatar className="member-avatar" name={member.name} avatarUrl={member.avatarUrl} />
            <strong>{member.name}</strong>
          </button>
        ))}
      </div>
    );
  }

  function renderSinglePayerPicker(label: string) {
    return (
      <>
        <button className="composer-payer-summary" type="button" onClick={() => setComposerPayerExpanded((current) => !current)}>
          <span className="composer-section-head-label">{label}</span>
          <span className="composer-payer-summary-value">
            <MemberAvatar className="member-avatar" name={composerPayer?.name} avatarUrl={composerPayer?.avatarUrl} />
            <strong>{composerPayer?.name ?? ""}</strong>
            <ChevronRight aria-hidden="true" size={16} className={composerPayerExpanded ? "chevron rotated" : "chevron"} />
          </span>
        </button>
        {composerPayerExpanded
          ? renderMemberChipGrid(composerPayerId, (memberId) => {
              setComposerPayerId(memberId);
              setComposerPayerExpanded(false);
            })
          : null}
      </>
    );
  }

  function renderPayerSection() {
    if (composerMode === "income") {
      return <div className="composer-card-section">{renderSinglePayerPicker(text.incomeCollector)}</div>;
    }

    if (!isMultiPayer) {
      return (
        <div className="composer-card-section">
          {renderSinglePayerPicker(text.payer)}
          <div className="composer-split-footer">
            <span />
            <button className="composer-mini-action" type="button" onClick={addPayerRow}>
              {text.addPayer}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="composer-card-section">
        <div className="composer-section-head">
          <span>{text.payer}</span>
          <button className="text-action" type="button" onClick={addPayerRow}>
            {text.addPayer}
          </button>
        </div>
        <div className="share-member-list">
          {composerPayerRows.map((row) => {
            const rowMember = members.find((member) => member.id === row.payerId);
            return (
              <div className="share-member-row composer-payer-row" key={row.key}>
                <span className="composer-payer-row-member">
                  <MemberAvatar className="member-avatar" name={rowMember?.name} avatarUrl={rowMember?.avatarUrl} />
                  <select
                    className="composer-payer-row-select"
                    value={row.payerId}
                    onChange={(event) => updatePayerRow(row.key, { payerId: event.target.value })}
                    aria-label={text.payer}
                  >
                    {members.map((member) => (
                      <option value={member.id} key={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </span>
                <input
                  className="share-member-amount-input"
                  value={row.amount}
                  onChange={(event) => updatePayerRow(row.key, { amount: event.target.value })}
                  inputMode="decimal"
                  aria-label={`${rowMember?.name ?? ""} ${text.amount}`}
                />
                <button
                  className="composer-payer-row-remove"
                  type="button"
                  aria-label={text.removePayer}
                  onClick={() => removePayerRow(row.key)}
                >
                  <X aria-hidden="true" size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="composer-split-footer">
          <span>
            {text.remainingAmount} {formatAmount(composerPaymentsRemainderMinor, groupCurrency)}
          </span>
        </div>
      </div>
    );
  }

  function renderShareSection() {
    return (
      <div className="composer-card-section">
        <div className="composer-section-head">
          <span>{composerMode === "income" ? text.incomeBeneficiaries : text.whoPays}</span>
          <div className="split-mode-toggle" role="group" aria-label={text.allocationSettings}>
            <button
              className={composerSplitMode === "equal" ? "split-mode-option active" : "split-mode-option"}
              type="button"
              aria-pressed={composerSplitMode === "equal"}
              onClick={() => selectSplitMode("equal")}
            >
              {text.splitEvenly}
            </button>
            <button
              className={composerSplitMode === "amount" ? "split-mode-option active" : "split-mode-option"}
              type="button"
              aria-pressed={composerSplitMode === "amount"}
              onClick={() => selectSplitMode("amount")}
            >
              {text.splitByAmount}
            </button>
            <button
              className={composerSplitMode === "percent" ? "split-mode-option active" : "split-mode-option"}
              type="button"
              aria-pressed={composerSplitMode === "percent"}
              onClick={() => selectSplitMode("percent")}
            >
              {text.splitByPercent}
            </button>
          </div>
        </div>
        <div className="share-member-list">
          {members.map((member) => {
            const included = composerShareIds.includes(member.id);
            const displayAmountMinor = included ? composerEqualShareAmountsMinor[member.id] ?? 0 : 0;
            return (
              <div className={included ? "share-member-row" : "share-member-row dimmed"} key={member.id}>
                <button className="share-member-toggle" type="button" onClick={() => toggleComposerShareMember(member.id)}>
                  <MemberAvatar className="member-avatar" name={member.name} avatarUrl={member.avatarUrl} />
                  <strong>{member.name}</strong>
                </button>
                {included && composerSplitMode === "amount" ? (
                  <input
                    className="share-member-amount-input"
                    value={composerShareAmounts[member.id] ?? ""}
                    onChange={(event) =>
                      setComposerShareAmounts((current) => ({ ...current, [member.id]: event.target.value }))
                    }
                    inputMode="decimal"
                    aria-label={`${member.name} ${text.amount}`}
                  />
                ) : included && composerSplitMode === "percent" ? (
                  <span className="share-percent-cell">
                    <small>{formatAmount(composerPercentPreviewAmountsMinor[member.id] ?? 0, groupCurrency)}</small>
                    <input
                      className="share-member-amount-input share-percent-input"
                      value={composerSharePercents[member.id] ?? ""}
                      onChange={(event) =>
                        setComposerSharePercents((current) => ({ ...current, [member.id]: event.target.value }))
                      }
                      inputMode="decimal"
                      aria-label={`${member.name} %`}
                    />
                    <small>%</small>
                  </span>
                ) : (
                  <span className="share-member-amount">{formatAmount(displayAmountMinor, groupCurrency)}</span>
                )}
              </div>
            );
          })}
        </div>
        {composerSplitMode === "amount" ? (
          <div className="composer-split-footer">
            <span>
              {text.remainingAmount} {formatAmount(composerRemainderMinor, groupCurrency)}
            </span>
            <button className="composer-mini-action" type="button" onClick={seedShareAmountsEvenly}>
              {text.splitEvenly}
            </button>
          </div>
        ) : null}
        {composerSplitMode === "percent" ? (
          <div className="composer-split-footer">
            <span>
              {text.remainingAmount} {formatPercent(composerPercentRemainder)}
            </span>
            <button className="composer-mini-action" type="button" onClick={seedSharePercentsEvenly}>
              {text.splitEvenly}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderTransferSection() {
    return (
      <>
        <div className="composer-card-section">
          <button
            className="composer-payer-summary"
            type="button"
            onClick={() => setComposerPayerExpanded((current) => !current)}
          >
            <span className="composer-section-head-label">{text.transferOut}</span>
            <span className="composer-payer-summary-value">
              <MemberAvatar className="member-avatar" name={composerPayer?.name} avatarUrl={composerPayer?.avatarUrl} />
              <strong>{composerPayer?.name ?? ""}</strong>
              <ChevronRight aria-hidden="true" size={16} className={composerPayerExpanded ? "chevron rotated" : "chevron"} />
            </span>
          </button>
          {composerPayerExpanded
            ? renderMemberChipGrid(composerPayerId, (memberId) => {
                setComposerPayerId(memberId);
                setComposerPayerExpanded(false);
              })
            : null}
        </div>
        <div className="composer-card-section">
          <button
            className="composer-payer-summary"
            type="button"
            onClick={() => setComposerTransferToExpanded((current) => !current)}
          >
            <span className="composer-section-head-label">{text.transferIn}</span>
            <span className="composer-payer-summary-value">
              <MemberAvatar className="member-avatar" name={composerTransferTo?.name} avatarUrl={composerTransferTo?.avatarUrl} />
              <strong>{composerTransferTo?.name ?? ""}</strong>
              <ChevronRight
                aria-hidden="true"
                size={16}
                className={composerTransferToExpanded ? "chevron rotated" : "chevron"}
              />
            </span>
          </button>
          {composerTransferToExpanded
            ? renderMemberChipGrid(composerTransferToId, (memberId) => {
                setComposerTransferToId(memberId);
                setComposerTransferToExpanded(false);
              })
            : null}
        </div>
      </>
    );
  }

  // The amount step gates "下一步"; every later field either has a default or is
  // optional, so those steps advance freely and the final CTA uses canSubmit.
  const canAdvanceStep = stepKeys[activeStep] === "amount" ? composerTotalAmountMinor > 0 : true;

  // Field groups shared by the desktop single-form layout and the phone steps.
  const renderModeRow = () => (
    <div className="composer-type-row segmented-control" role="tablist" aria-label={text.addExpense}>
      <span
        className="segmented-pill"
        style={{ transform: `translateX(${COMPOSER_MODES.findIndex((mode) => mode.id === composerMode) * 100}%)` }}
        aria-hidden="true"
      />
      {COMPOSER_MODES.map((mode) => (
        <button
          key={mode.id}
          className={mode.id === composerMode ? "composer-type active" : "composer-type"}
          type="button"
          role="tab"
          aria-selected={mode.id === composerMode}
          onClick={() => selectComposerMode(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );

  const renderMetaGrid = () => (
    <div className="composer-meta-grid">
      {composerMode !== "transfer" ? (
        <label>
          <span>{text.category}</span>
          <select value={composerCategory} onChange={(event) => setComposerCategory(event.target.value)} aria-label={text.category}>
            {categoryOptions().map((option) => (
              <option value={option.key} key={option.key}>
                {option.label}
              </option>
            ))}
            {/* A category that has since been disabled in the console stays
                selectable while editing an expense already filed under it,
                rather than being silently rewritten on the next save. */}
            {!categoryOptions().some((option) => option.key === composerCategory) ? (
              <option value={composerCategory}>{lookupCategoryLabel(composerCategory)}</option>
            ) : null}
          </select>
        </label>
      ) : null}
      <label>
        <span>{text.date}</span>
        <input
          type="datetime-local"
          value={composerDateTime}
          onChange={(event) => setComposerDateTime(event.target.value)}
          aria-label={text.date}
        />
      </label>
    </div>
  );

  const renderAmountCard = () => (
    <div className="composer-amount-card">
      <select
        className="composer-currency-select"
        value={composerCurrency}
        onChange={(event) => {
          setComposerCurrency(event.target.value);
          // A rate typed for the old currency means nothing for the new one,
          // so the auto fill takes over again from here.
          manualRateRef.current = false;
          setAutoRateDate("");
        }}
        aria-label={text.currency}
      >
        {currencyOptions.map((currency) => (
          <option value={currency.code} key={currency.code}>
            {currency.code}
          </option>
        ))}
      </select>
      <input
        value={formatAmountInputDisplay(composerAmount)}
        onChange={(event) => setComposerAmount(stripAmountInput(event.target.value))}
        inputMode="decimal"
        placeholder="0"
        aria-label={text.amount}
      />
      {scanPending ? <p className="composer-scan-pending">{text.scanReading}</p> : null}
    </div>
  );

  const renderExchangeRow = () =>
    composerNeedsExchangeRate ? (
      <div className="composer-exchange-row">
        <span>
          1 {composerCurrency} → {groupCurrency}
          {autoRateDate ? <small className="composer-exchange-source">{`${text.exchangeRateAuto} ${autoRateDate.slice(5)}`}</small> : null}
        </span>
        <input
          value={composerExchangeRate}
          onChange={(event) => {
            manualRateRef.current = true;
            setAutoRateDate("");
            setComposerExchangeRate(event.target.value);
          }}
          inputMode="decimal"
          aria-label={text.exchangeRateLabel}
        />
      </div>
    ) : null;

  const renderTitleField = () => (
    <label>
      <input
        value={composerTitle}
        onChange={(event) => setComposerTitle(event.target.value)}
        placeholder={composerMode === "transfer" ? text.transferDefaultTitle : text.titlePlaceholder}
        aria-label={text.title}
      />
    </label>
  );

  const renderPhotoNoteSection = () => (
    <div className="composer-card-section composer-photo-note-row">
      <div className="composer-photo-picker">
        <span className="composer-section-head-label">{text.photo}</span>
        {[...composerImageUrls, ...composerImageDataUrls].map((src, index) => (
          <div className="composer-photo-preview" key={`${src.slice(0, 48)}-${index}`}>
            <img src={src} alt="" />
            <button
              className="composer-photo-remove"
              type="button"
              aria-label={`${text.removePhoto} ${index + 1}`}
              onClick={() => removeComposerImage(index)}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        ))}
        {composerImageCount < MAX_EXPENSE_IMAGES ? (
          <label className="composer-photo-add">
            <Plus aria-hidden="true" size={22} />
            <input
              type="file"
              accept="image/*"
              aria-label={text.photo}
              onChange={(event) => {
                void handleComposerImagePick(event.target.files?.[0] ?? null);
                // Cleared so picking the SAME file again still fires a change
                // event - otherwise the second of two identical photos never
                // arrives, which looks like the button quietly breaking.
                event.target.value = "";
              }}
            />
          </label>
        ) : null}
      </div>
      <label className="composer-note-field">
        <span>{text.note}</span>
        <input
          value={composerNote}
          onChange={(event) => setComposerNote(event.target.value)}
          placeholder={text.notePlaceholder}
          aria-label={text.note}
        />
      </label>
    </div>
  );

  const renderNoteSection = () => (
    <div className="composer-card-section">
      <label className="composer-note-field">
        <span>{text.note}</span>
        <input
          value={composerNote}
          onChange={(event) => setComposerNote(event.target.value)}
          placeholder={text.notePlaceholder}
          aria-label={text.note}
        />
      </label>
    </div>
  );

  // Phone step 1: a big running total plus a custom numeric keypad, so amount
  // entry never depends on the OS keyboard covering the sheet.
  const renderAmountStep = () => (
    <div className="composer-amount-step">
      <div className="composer-amount-display">
        <select
          className="composer-currency-select"
          value={composerCurrency}
          onChange={(event) => setComposerCurrency(event.target.value)}
          aria-label={text.currency}
        >
          {currencyOptions.map((currency) => (
            <option value={currency.code} key={currency.code}>
              {currency.code}
            </option>
          ))}
        </select>
        <strong>{formatAmountInputDisplay(composerAmount) || "0"}</strong>
      </div>
      {scanPending ? <p className="composer-scan-pending">{text.scanReading}</p> : null}
      {renderExchangeRow()}
      <div className="composer-keypad" role="group" aria-label={text.amount}>
        {KEYPAD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="composer-keypad-key"
            aria-label={key === "del" ? "刪除" : key}
            onClick={() => pressKeypad(key)}
          >
            {key === "del" ? <Delete aria-hidden="true" size={22} /> : key}
          </button>
        ))}
      </div>
    </div>
  );

  const renderStepBody = (key: StepKey) => {
    switch (key) {
      case "amount":
        return renderAmountStep();
      case "details":
        return (
          <>
            {renderTitleField()}
            {renderMetaGrid()}
            {renderPhotoNoteSection()}
          </>
        );
      case "payer":
        return renderPayerSection();
      case "split":
        return renderShareSection();
      case "transferPair":
        return renderTransferSection();
      case "transferNote":
        return (
          <>
            {renderMetaGrid()}
            {renderNoteSection()}
          </>
        );
    }
  };

  return (
    <div
      className={composerClosing ? "composer-backdrop closing" : "composer-backdrop"}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        className={composerClosing ? "expense-composer expense-sheet glass-panel closing" : "expense-composer expense-sheet glass-panel"}
        role="dialog"
        aria-modal="true"
        aria-label={text.addExpense}
        {...dragProps}
        ref={sheetRef}
      >
        <div className="sheet-drag-handle" aria-hidden="true" />
        <div className="composer-header">
          <h2>{initialExpense ? text.editExpense : text.addExpense}</h2>
        </div>

        {isPhone ? (
          <>
            <div className="composer-progress" aria-hidden="true">
              {stepKeys.map((key, index) => (
                <span key={key} className={index <= activeStep ? "composer-progress-seg on" : "composer-progress-seg"} />
              ))}
            </div>
            <div className="composer-step-body">
              <div className="composer-step-heading">
                <span className="composer-step-count">
                  {text.stepWord} {activeStep + 1}/{stepKeys.length}
                </span>
                <h3 className="composer-step-title">{stepTitle(stepKeys[activeStep])}</h3>
              </div>
              {stepKeys[activeStep] === "amount" ? renderModeRow() : null}
              {renderStepBody(stepKeys[activeStep])}
            </div>
            <div className="composer-step-nav">
              {activeStep > 0 ? (
                <button className="composer-step-back" type="button" onClick={() => setStepIndex(activeStep - 1)}>
                  {text.stepBack}
                </button>
              ) : (
                <span />
              )}
              {isLastStep ? (
                <button
                  className="composer-submit-full composer-step-save"
                  type="button"
                  disabled={composerSubmitState.disabled || composerSubmitting}
                  onClick={submitComposer}
                >
                  {composerSubmitting ? text.savingChanges : composerSubmitState.label}
                </button>
              ) : (
                <button className="composer-step-next" type="button" disabled={!canAdvanceStep} onClick={() => setStepIndex(activeStep + 1)}>
                  {text.stepNext}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {renderModeRow()}
            {renderMetaGrid()}
            {renderAmountCard()}
            {renderExchangeRow()}
            {renderTitleField()}
            {composerMode === "transfer" ? renderTransferSection() : renderPayerSection()}
            {composerMode !== "transfer" ? renderShareSection() : null}
            {composerMode !== "transfer" ? renderPhotoNoteSection() : renderNoteSection()}
            <p className="composer-hint">{composerSubmitState.hint}</p>
            <button
              className="composer-submit-full"
              type="button"
              disabled={composerSubmitState.disabled || composerSubmitting}
              onClick={submitComposer}
            >
              {composerSubmitting ? text.savingChanges : composerSubmitState.label}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
