import { describe, expect, test, vi } from "vitest";
import { renderGoogleSignInButton, type GoogleGlobal } from "./googleIdentity";

function fakeGoogle(): { google: GoogleGlobal; initialize: ReturnType<typeof vi.fn>; renderButton: ReturnType<typeof vi.fn> } {
  const initialize = vi.fn();
  const renderButton = vi.fn();
  return {
    google: {
      accounts: {
        id: {
          initialize,
          renderButton,
          prompt: vi.fn(),
        },
      },
    },
    initialize,
    renderButton,
  };
}

describe("renderGoogleSignInButton", () => {
  test("throws when Google Identity Services is not loaded", () => {
    expect(() => renderGoogleSignInButton("client-id", {} as HTMLElement, () => {}, undefined)).toThrow(
      "Google Identity Services is not loaded.",
    );
  });

  test("initializes with the given client id and forwards the credential", () => {
    const { google, initialize } = fakeGoogle();
    const onCredential = vi.fn();
    const container = {} as HTMLElement;

    renderGoogleSignInButton("my-client-id", container, onCredential, google);

    expect(initialize).toHaveBeenCalledTimes(1);
    const config = initialize.mock.calls[0][0];
    expect(config.client_id).toBe("my-client-id");

    config.callback({ credential: "id-token-value" });
    expect(onCredential).toHaveBeenCalledWith("id-token-value");
  });

  test("renders the button into the provided container with expected styling", () => {
    const { google, renderButton } = fakeGoogle();
    const container = {} as HTMLElement;

    renderGoogleSignInButton("client-id", container, () => {}, google);

    expect(renderButton).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ theme: "filled_black", width: 260 }),
    );
  });
});
