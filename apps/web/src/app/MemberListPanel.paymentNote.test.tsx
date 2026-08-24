// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Member } from "./appTypes";
import { MemberListPanel } from "./MemberListPanel";
import { UI_TEXT } from "./uiText";

/**
 * Who gets an edit control for 收款資訊, and what the editor does with it.
 * The server enforces the same rule (see handlers/groups.test.ts); this is
 * about not offering a button that can only fail.
 */

const members: Member[] = [
  { id: "me", name: "Alice", userId: "user_alice", role: "owner", paymentNote: "玉山 808 末五碼 12345" },
  { id: "bob", name: "Bob", userId: "user_bob", role: "member", paymentNote: "台新 812 末五碼 54321" },
  { id: "ghost", name: "Ghost", virtual: true },
];

function renderPanel(overrides: Partial<Parameters<typeof MemberListPanel>[0]> = {}) {
  const props = {
    members,
    balances: new Map<string, number>(),
    currency: "TWD",
    renamingMemberId: "",
    renameMemberValue: "",
    confirmingRemoveMemberId: "",
    pendingAction: null,
    currentMemberId: "me",
    editingPaymentNoteMemberId: "",
    paymentNoteValue: "",
    onRenameValueChange: vi.fn(),
    onStartRename: vi.fn(),
    onCancelRename: vi.fn(),
    onSubmitRename: vi.fn(),
    onPaymentNoteValueChange: vi.fn(),
    onStartEditPaymentNote: vi.fn(),
    onCancelEditPaymentNote: vi.fn(),
    onSubmitPaymentNote: vi.fn(),
    onRemove: vi.fn(),
    onInvite: vi.fn(),
    onAddVirtualMember: vi.fn(),
    ...overrides,
  };
  render(<MemberListPanel {...props} />);
  return props;
}

afterEach(cleanup);

describe("收款資訊 in the member list", () => {
  test("everyone's note is visible — that is the point of sharing it", () => {
    renderPanel();

    expect(screen.getByText("玉山 808 末五碼 12345")).toBeTruthy();
    expect(screen.getByText("台新 812 末五碼 54321")).toBeTruthy();
  });

  test("offers an edit control for your own row and for virtual members only", () => {
    renderPanel();

    // Alice (self) and Ghost (virtual) are editable; Bob is another real
    // account, so there is no control to publish details on his behalf.
    expect(screen.getAllByLabelText(UI_TEXT.paymentNote.edit)).toHaveLength(1);
    expect(screen.getAllByLabelText(UI_TEXT.paymentNote.add)).toHaveLength(1);
  });

  test("starting an edit names the row it belongs to", () => {
    const props = renderPanel();

    fireEvent.click(screen.getByLabelText(UI_TEXT.paymentNote.edit));

    expect(props.onStartEditPaymentNote).toHaveBeenCalledWith(expect.objectContaining({ id: "me" }));
  });

  test("the editor submits the row being edited", () => {
    const props = renderPanel({ editingPaymentNoteMemberId: "me", paymentNoteValue: "新的帳號" });

    fireEvent.click(screen.getByLabelText(UI_TEXT.paymentNote.save));

    expect(props.onSubmitPaymentNote).toHaveBeenCalledWith(expect.objectContaining({ id: "me" }));
  });

  test("a member with no note still says so, so it reads as fillable", () => {
    renderPanel();

    expect(screen.getByText(UI_TEXT.paymentNote.empty)).toBeTruthy();
  });

  test("the input is capped at what the column accepts", () => {
    renderPanel({ editingPaymentNoteMemberId: "me", paymentNoteValue: "x" });

    const input = screen.getByLabelText(UI_TEXT.paymentNote.label) as HTMLInputElement;
    expect(input.maxLength).toBe(200);
  });
});
