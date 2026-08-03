// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { UI_TEXT } from "./uiText";

const app = UI_TEXT.app;

// jsdom has no BarcodeDetector, so ScanSheet always falls through to the jsQR
// path; this stands in for the decoder. Hoisted, because the lazy import inside
// ScanSheet resolves long after the test body has started running.
vi.mock("jsqr", () => ({ default: () => ({ data: "https://equo-mu.vercel.app/?invite=onog0sd6" }) }));

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

async function landOnGroup() {
  signIn();
  const api = fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    { route: "GET /groups/group_1", body: groupDetail() },
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
  test("offers 新增成員 alongside icon-only invite and scan buttons", async () => {
    await landOnGroup();

    expect(screen.getByRole("button", { name: app.addMember })).toBeTruthy();
    expect(screen.getByRole("button", { name: app.inviteMembers })).toBeTruthy();
    expect(screen.getByRole("button", { name: app.scanReceipt })).toBeTruthy();
  });
});

describe("掃描收據", () => {
  test("opens the camera, and releases it again when the user backs out", async () => {
    const camera = stubCamera();
    await landOnGroup();

    fireEvent.click(screen.getByRole("button", { name: app.scanReceipt }));

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

    fireEvent.click(screen.getByRole("button", { name: app.scanReceipt }));
    const shutter = await screen.findByRole("button", { name: app.scanReceiptShutter });
    await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(shutter);

    await waitFor(() => expect(api.calls).toContain("POST /receipts/scan"));
    // Filled in after the fact - the sheet was already open and blank.
    await waitFor(() => expect(screen.getByLabelText(app.amount)).toHaveProperty("value", "125.5"));
    expect(screen.getByLabelText(app.title)).toHaveProperty("value", "全家便利商店");
    // The photo rides along on the same expense, recognised or not.
    expect(screen.getByRole("button", { name: app.removePhoto })).toBeTruthy();
  });

  test("opens the composer at once instead of waiting on recognition", async () => {
    stubBrowser();
    stubCamera();
    const api = await landOnGroup();
    // A scan that never resolves: recognition takes ~5s in production, and
    // nobody standing at a till should spend them watching a spinner.
    api.set("POST /receipts/scan", new Promise(() => {}));

    fireEvent.click(screen.getByRole("button", { name: app.scanReceipt }));
    const shutter = await screen.findByRole("button", { name: app.scanReceiptShutter });
    await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(shutter);

    // Composer up, photo attached, amount blank and typeable - all before the
    // upstream has said anything.
    await waitFor(() => expect(screen.getByRole("button", { name: app.removePhoto })).toBeTruthy());
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

    fireEvent.click(screen.getByRole("button", { name: app.scanReceipt }));
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

    fireEvent.click(screen.getByRole("button", { name: app.scanReceipt }));
    const shutter = await screen.findByRole("button", { name: app.scanReceiptShutter });
    await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(shutter);

    // Losing the photo because the model was unreachable would be far worse
    // than losing the auto-fill, so the composer must still come up.
    await waitFor(() => expect(screen.getByText(app.scanReceiptFailed)).toBeTruthy());
    await waitFor(() => expect(screen.getByRole("button", { name: app.removePhoto })).toBeTruthy());
    // Nothing invented: the amount is left blank for the user to type.
    expect(screen.getByLabelText(app.amount)).toHaveProperty("value", "");
  });

  test("explains itself instead of showing a dead camera when permission is refused", async () => {
    stubCamera();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    await landOnGroup();

    fireEvent.click(screen.getByRole("button", { name: app.scanReceipt }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", app.scanCameraDenied);
  });
});

describe("邀請成員", () => {
  test("shows the invite link as a QR code next to the code itself", async () => {
    const api = await landOnGroup();
    api.set("POST /groups/group_1/invites", { invite: { token: "ONOG0SD6" } });

    fireEvent.click(screen.getByRole("button", { name: app.inviteMembers }));

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
