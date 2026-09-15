// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { grantScanConsent } from "./scanConsent";
import { UI_TEXT } from "./uiText";

const app = UI_TEXT.app;

// jsdom has no BarcodeDetector, so ScanSheet always falls through to the jsQR
// path; this stands in for the decoder. Hoisted, because the lazy import inside
// ScanSheet resolves long after the test body has started running.
vi.mock("jsqr", () => ({ default: () => ({ data: "https://equo-mu.vercel.app/?invite=onog0sd6" }) }));

/**
 * Every surface in this file is behind a lazy import (App.tsx code-splits the
 * sheets, and the jsQR chunk they pull in is the largest in the build), so the
 * findBy* calls below are waiting on a dynamic import, not on a render.
 * testing-library's 1s default holds when this file runs alone but not when the
 * full suite has every worker busy — which surfaced as sheets that "cannot be
 * found" here and pass on a re-run. Nothing is broken in those runs, the chunk
 * simply has not landed yet, so the honest fix is to wait longer. Kept under vitest's 5s
 * per-test budget, so an await that genuinely never resolves still reports
 * what it was looking for instead of blowing the test timeout.
 */
configure({ asyncUtilTimeout: 4_000 });
// The 4s asyncUtilTimeout above only helps if the test is still alive when it
// fires. Vitest's default 5s per-test budget left ~1s of headroom, and under a
// fully loaded suite that is not enough: the test was killed first, replacing
// testing-library's "unable to find X" with a bare timeout that says nothing.
// Raising the budget does not hide a hang — the 4s wait still wins the race and
// still reports what it was looking for. It just makes that the outcome every
// time instead of most of the time.
vi.setConfig({ testTimeout: 15_000 });

/**
 * The two camera entry points and the invite QR, driven through the real <App />.
 *
 * jsdom has no media stack at all, so the stream and the frame grab are the
 * boundary that gets faked here — everything above them (the overlay, the
 * recognition call, the composer hand-off) is the app's own code.
 */

function stubCamera(): { stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn();
  const track = { stop } as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track] } as unknown as MediaStream;

  // Defined onto the real navigator rather than swapped for a clone: jsdom's
  // other navigator getters (onLine, which the app reads on mount) are branded
  // and throw when called on anything that is not the genuine instance.
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });

  // jsdom's HTMLMediaElement throws "not implemented" on play(), and leaves
  // srcObject unimplemented too.
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    writable: true,
    value: null,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  // videoWidth/videoHeight are 0 in jsdom, which the capture path reads as "no
  // frame yet"; report a real size so the shutter produces an image.
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 1200 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 1600 });
  // jsdom leaves isSecureContext undefined, which the error classifier reads as
  // an http:// origin - without this every camera failure looks "insecure" and
  // the permission-denied branch is unreachable.
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    // The QR path reads the frame back out again; without this the decoder
    // throws every tick and simply never resolves a code.
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,SCANNED");

  return { stop };
}

/**
 * Most of these tests are about what the camera does once recognition has been
 * agreed to, so consent is granted by default - and granted HERE rather than in
 * a beforeEach, because several tests re-run stubBrowser (for the desktop
 * layout) mid-test, which clears localStorage again. The consent gate's own
 * tests opt out with { scanConsent: false }.
 */
async function landOnGroup({ scanConsent = true }: { scanConsent?: boolean } = {}) {
  signIn();
  if (scanConsent) grantScanConsent();
  const api = fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    {
      route: "GET /groups/group_1",
      // A second member, not the (default) solo-Alice group: 掃描收據 lives in
      // the 最近記錄 disclosure now, which - like the rest of the home card
      // below the balance line - doesn't render at all for a brand-new,
      // nobody-else-here-yet group (see groupHomeDisclosure.test.tsx's "a
      // brand new group" case). These tests are about what scanning itself
      // does, not about that empty state, so they need a group past it.
      body: groupDetail({
        members: [
          { id: "member_alice", group_id: "group_1", user_id: "user_alice", display_name: "Alice", role: "owner", status: "active" },
          { id: "member_bob", group_id: "group_1", user_id: "user_bob", display_name: "Bob", role: "member", status: "active" },
        ],
        balances: [
          { memberId: "member_alice", balance: { amount_minor: 0, currency: "TWD" } },
          { memberId: "member_bob", balance: { amount_minor: 0, currency: "TWD" } },
        ],
      }),
    },
  ]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
  return api;
}

beforeEach(() => {
  stubBrowser({ mobile: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the group home action row", () => {
  test("新增成員／邀請成員 fold into 加人, and 掃描收據 moves to 最近記錄", async () => {
    await landOnGroup();

    // 掃描收據 is a recording action now, in 最近記錄's title row. Waited for,
    // not just queried: it only exists once the detail fetch has landed.
    const scanButton = await screen.findByRole("button", { name: app.scanReceipt });
    expect(scanButton.closest("#group-records")).toBeTruthy();

    // The old three-slot row is gone - there is no longer a bare
    // 邀請成員 button on the home card.
    expect(screen.queryByRole("button", { name: app.inviteMembers })).toBeNull();

    // 加人, at the end of the member list, opens the same sheet that used to
    // hold both 新增成員 and 邀請成員.
    fireEvent.click(screen.getByRole("button", { name: app.addMember }));
    expect(await screen.findByText(app.addVirtualMember)).toBeTruthy();
  });
});

describe("掃描收據", () => {
  test("opens the camera, and releases it again when the user backs out", async () => {
    const camera = stubCamera();
    await landOnGroup();

    // Waited for, not just queried: it only exists once the detail fetch has
    // landed (see landOnGroup's comment on emptyGroup's loading-flash guard).
    fireEvent.click(await screen.findByRole("button", { name: app.scanReceipt }));

    const dialog = await screen.findByRole("dialog", { name: app.scanReceipt });
    expect(dialog).toBeTruthy();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: app.back }));

    // Leaving the track running keeps the phone's camera indicator lit, which
    // is the single most alarming thing a web app can do.
    await waitFor(() => expect(camera.stop).toHaveBeenCalled());
  });

  test("sends the captured frame for recognition and prefills the composer", async () => {
    // Desktop layout: the phone composer is stepped and opens on a keypad, so
    // the single-page form is where the whole prefill is visible at once.
    stubBrowser();
    stubCamera();
    const api = await landOnGroup();
    api.set("POST /receipts/scan", {
      recognised: true,
      merchant: "全家便利商店",
      amount_minor: 12550,
      currency: "TWD",
      purchased_at: "2026-07-29",
      category: "food",
      items: [],
    });

    // Waited for, not just queried: it only exists once the detail fetch has
    // landed (see landOnGroup's comment on emptyGroup's loading-flash guard).
    fireEvent.click(await screen.findByRole("button", { name: app.scanReceipt }));
    const shutter = await screen.findByRole("button", { name: app.scanReceiptShutter });
    await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(shutter);

    await waitFor(() => expect(api.calls).toContain("POST /receipts/scan"));
    // Filled in after the fact - the sheet was already open and blank.
    await waitFor(() => expect(screen.getByLabelText(app.amount)).toHaveProperty("value", "125.5"));
    expect(screen.getByLabelText(app.title)).toHaveProperty("value", "全家便利商店");
    // The photo rides along on the same expense, recognised or not.
    expect(screen.getByRole("button", { name: `${app.removePhoto} 1` })).toBeTruthy();
  });

  test("opens the composer at once instead of waiting on recognition", async () => {
    stubBrowser();
    stubCamera();
    const api = await landOnGroup();
    // A scan that never resolves: recognition takes ~5s in production, and
    // nobody standing at a till should spend them watching a spinner.
    api.set("POST /receipts/scan", new Promise(() => {}));

    // Waited for, not just queried: it only exists once the detail fetch has
    // landed (see landOnGroup's comment on emptyGroup's loading-flash guard).
    fireEvent.click(await screen.findByRole("button", { name: app.scanReceipt }));
    const shutter = await screen.findByRole("button", { name: app.scanReceiptShutter });
    await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(shutter);

    // Composer up, photo attached, amount blank and typeable - all before the
    // upstream has said anything.
    await waitFor(() => expect(screen.getByRole("button", { name: `${app.removePhoto} 1` })).toBeTruthy());
    expect(screen.getByLabelText(app.amount)).toHaveProperty("value", "");
    expect(screen.getByText(app.scanReading)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: app.scanReceipt })).toBeNull();
  });

  test("a late scan fills the blanks but never overwrites what the user typed", async () => {
    stubBrowser();
    stubCamera();
    const api = await landOnGroup();
    let resolveScan: (value: unknown) => void = () => {};
    api.set("POST /receipts/scan", new Promise((resolve) => { resolveScan = resolve; }));

    // Waited for, not just queried: it only exists once the detail fetch has
    // landed (see landOnGroup's comment on emptyGroup's loading-flash guard).
    fireEvent.click(await screen.findByRole("button", { name: app.scanReceipt }));
    const shutter = await screen.findByRole("button", { name: app.scanReceiptShutter });
    await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(shutter);

    // The impatient user types their own amount during the wait.
    const amount = await screen.findByLabelText(app.amount);
    fireEvent.change(amount, { target: { value: "999" } });

    await act(async () => {
      resolveScan({
        recognised: true,
        merchant: "全家便利商店",
        amount_minor: 12550,
        currency: "TWD",
        purchased_at: "2026-07-29",
        category: "food",
        items: [],
      });
    });

    // Their number stands; the field they left alone gets filled.
    await waitFor(() => expect(screen.getByLabelText(app.title)).toHaveProperty("value", "全家便利商店"));
    expect(screen.getByLabelText(app.amount)).toHaveProperty("value", "999");
  });

  test("still opens the composer with the photo when recognition is unavailable", async () => {
    stubBrowser();
    stubCamera();
    const api = await landOnGroup();
    api.set(
      "POST /receipts/scan",
      { error: { code: "RECEIPT_SCAN_UNAVAILABLE", message: "off", request_id: "req_1" } },
      503,
    );

    // Waited for, not just queried: it only exists once the detail fetch has
    // landed (see landOnGroup's comment on emptyGroup's loading-flash guard).
    fireEvent.click(await screen.findByRole("button", { name: app.scanReceipt }));
    const shutter = await screen.findByRole("button", { name: app.scanReceiptShutter });
    await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(shutter);

    // Losing the photo because the model was unreachable would be far worse
    // than losing the auto-fill, so the composer must still come up.
    await waitFor(() => expect(screen.getByText(app.scanReceiptFailed)).toBeTruthy());
    await waitFor(() => expect(screen.getByRole("button", { name: `${app.removePhoto} 1` })).toBeTruthy());
    // Nothing invented: the amount is left blank for the user to type.
    expect(screen.getByLabelText(app.amount)).toHaveProperty("value", "");
  });

  test("explains itself instead of showing a dead camera when permission is refused", async () => {
    stubCamera();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    await landOnGroup();

    // Waited for, not just queried: it only exists once the detail fetch has
    // landed (see landOnGroup's comment on emptyGroup's loading-flash guard).
    fireEvent.click(await screen.findByRole("button", { name: app.scanReceipt }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", app.scanCameraDenied);
  });
});

describe("收據辨識同意", () => {
  test("asks before the camera opens, and opens nothing if declined", async () => {
    const camera = stubCamera();
    await landOnGroup({ scanConsent: false });

    // Waited for, not just queried: it only exists once the detail fetch has
    // landed (see landOnGroup's comment on emptyGroup's loading-flash guard).
    fireEvent.click(await screen.findByRole("button", { name: app.scanReceipt }));

    // The ask, not the camera: no stream may be requested before consent.
    await screen.findByRole("dialog", { name: app.scanConsentTitle });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(camera.stop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: app.scanConsentDecline }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.scanConsentTitle })).toBeNull());
    expect(screen.queryByRole("dialog", { name: app.scanReceipt })).toBeNull();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  test("accepting opens the camera and is remembered for the next scan", async () => {
    stubCamera();
    await landOnGroup({ scanConsent: false });

    // Waited for, not just queried: it only exists once the detail fetch has
    // landed (see landOnGroup's comment on emptyGroup's loading-flash guard).
    fireEvent.click(await screen.findByRole("button", { name: app.scanReceipt }));
    fireEvent.click(await screen.findByRole("button", { name: app.scanConsentAccept }));

    await screen.findByRole("dialog", { name: app.scanReceipt });
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: app.back }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.scanReceipt })).toBeNull());

    // Second time: straight to the camera, no second ask.
    // Waited for, not just queried: it only exists once the detail fetch has
    // landed (see landOnGroup's comment on emptyGroup's loading-flash guard).
    fireEvent.click(await screen.findByRole("button", { name: app.scanReceipt }));

    await screen.findByRole("dialog", { name: app.scanReceipt });
    expect(screen.queryByRole("dialog", { name: app.scanConsentTitle })).toBeNull();
  });

  test("withdrawing consent in 個人資料 makes the next scan ask again", async () => {
    stubCamera();
    await landOnGroup();

    fireEvent.click(screen.getByLabelText(app.profile));
    fireEvent.click(await screen.findByRole("tab", { name: UI_TEXT.profile.otherTab }));
    const row = await screen.findByText(app.receiptScanSetting);
    fireEvent.click(
      // The 關閉 button belongs to this row; scoping to the row keeps it from
      // matching the push notification row's identical label.
      row.closest(".profile-other-row")!.querySelector("button")!,
    );

    await waitFor(() => expect(screen.getByText(app.scanConsentRevoked)).toBeTruthy());

    fireEvent.click(screen.getAllByRole("button", { name: app.cancel })[0]);
    fireEvent.click(await screen.findByRole("button", { name: app.scanReceipt }));

    await screen.findByRole("dialog", { name: app.scanConsentTitle });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
});

describe("邀請成員", () => {
  test("shows the invite link as a QR code next to the code itself", async () => {
    const api = await landOnGroup();
    api.set("POST /groups/group_1/invites", { invite: { token: "ONOG0SD6" } });

    // 邀請成員 is behind 加人 now - both it and 新增虛擬成員 live in the sheet
    // that opens. The dialog option's accessible name also carries its hint
    // sentence, so this finds it by its own text node rather than by role.
    fireEvent.click(await screen.findByRole("button", { name: app.addMember }));
    fireEvent.click((await screen.findByText(app.inviteMembers)).closest("button")!);

    expect(await screen.findByRole("img", { name: app.inviteQrAlt }).catch(() => null)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("ONOG0SD6")).toBeTruthy());
  });
});

describe("輸入邀請碼", () => {
  test("scanning a group's QR fills the code field and closes the camera", async () => {
    stubCamera();
    await landOnGroup();

    fireEvent.click(screen.getByRole("button", { name: app.groupList }));
    fireEvent.click(await screen.findByRole("button", { name: app.scanOrInputInviteCode }));
    fireEvent.click(await screen.findByRole("button", { name: app.scanInviteQr }));

    await screen.findByRole("dialog", { name: app.scanInviteTitle });

    // The token is normalised to upper case on the way into the field, so a
    // lower-case payload still matches what the server issued.
    await waitFor(() => expect(screen.getByDisplayValue("ONOG0SD6")).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByRole("dialog", { name: app.scanInviteTitle })).toBeNull();
  });
});
