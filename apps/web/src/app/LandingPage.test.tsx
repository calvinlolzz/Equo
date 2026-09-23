// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LandingPage } from "./LandingPage";
import { LegalPage } from "./LegalPage";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "./legalContent";
import { readAppFile } from "./cssDeclarations";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.landing;

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("LandingPage", () => {
  test("keeps signing in as the first thing on the page", () => {
    const onGoogleLogin = vi.fn();
    render(<LandingPage onGoogleLogin={onGoogleLogin} />);

    const button = screen.getByRole("button", { name: new RegExp(UI_TEXT.login.googleLogin) });
    fireEvent.click(button);

    expect(onGoogleLogin).toHaveBeenCalledTimes(1);
  });

  test("surfaces the sign-in error next to the button that failed", () => {
    render(<LandingPage onGoogleLogin={() => {}} errorMessage="登入失敗：boom" />);
    expect(screen.getByText("登入失敗：boom")).toBeTruthy();
  });

  test("answers the questions a signed-out visitor has, in the page itself", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    // The whole point of the page: the answers are IN the markup, not behind a
    // click, so a crawler and a first-time reader see the same thing.
    expect(screen.getByText(text.faq1A)).toBeTruthy();
    expect(screen.getByText(text.faq5A)).toBeTruthy();
    expect(screen.getByText(text.value2Body)).toBeTruthy();
  });

  test("links the legal documents at their public URLs", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    // Not a dialog the visitor has to be signed in to open — the href is the
    // thing an OAuth review or an app directory is given.
    expect(screen.getByRole("link", { name: UI_TEXT.profile.privacyPolicy }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: UI_TEXT.profile.termsOfService }).getAttribute("href")).toBe("/terms");
  });
});

describe("LegalPage", () => {
  test("renders the policy itself, not a link to it", () => {
    render(<LegalPage page="privacy" />);

    expect(screen.getByRole("heading", { level: 1, name: PRIVACY_POLICY.title })).toBeTruthy();
    expect(screen.getByText(PRIVACY_POLICY.sections[0].heading)).toBeTruthy();
    expect(document.title).toContain(PRIVACY_POLICY.title);
  });

  test("the terms page serves the terms, and points at the other document", () => {
    render(<LegalPage page="terms" />);

    expect(screen.getByRole("heading", { level: 1, name: TERMS_OF_SERVICE.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: UI_TEXT.profile.privacyPolicy }).getAttribute("href")).toBe("/privacy");
  });
});

describe("arriving from an invite link", () => {
  const preview = { group: { name: "東京旅行", member_count: 4 } };

  test("says which group the link points at, before anyone signs in", async () => {
    window.history.replaceState(null, "", "/?invite=EQO-ABC123");
    const fetchInvitePreview = vi.fn().mockResolvedValue(preview);

    render(<LandingPage onGoogleLogin={() => {}} fetchInvitePreview={fetchInvitePreview} />);

    expect(await screen.findByText("東京旅行")).toBeTruthy();
    expect(screen.getByText(text.inviteTitle)).toBeTruthy();
    expect(fetchInvitePreview).toHaveBeenCalledWith("EQO-ABC123");
    // Still a sign-in page: the card does not replace the wall, it explains it.
    expect(screen.getByRole("button", { name: new RegExp(UI_TEXT.login.googleLogin) })).toBeTruthy();
  });

  test("finds the token in the stash after the OAuth round-trip drops the query", async () => {
    // Supabase sends people back to the bare origin, so by then the URL has
    // nothing — only useInviteFlow's stash survives.
    window.sessionStorage.setItem("equo.clean.pending_invite", "EQO-STASHED");
    const fetchInvitePreview = vi.fn().mockResolvedValue(preview);

    render(<LandingPage onGoogleLogin={() => {}} fetchInvitePreview={fetchInvitePreview} />);

    await waitFor(() => expect(fetchInvitePreview).toHaveBeenCalledWith("EQO-STASHED"));
  });

  test("a dead link is silent — the ordinary page, no error", async () => {
    window.history.replaceState(null, "", "/?invite=EQO-DEAD");
    const fetchInvitePreview = vi.fn().mockRejectedValue(new Error("INVITE_EXPIRED"));

    render(<LandingPage onGoogleLogin={() => {}} fetchInvitePreview={fetchInvitePreview} />);

    await waitFor(() => expect(fetchInvitePreview).toHaveBeenCalled());
    expect(screen.queryByText(text.inviteTitle)).toBeNull();
    expect(screen.getByText(text.faq1A)).toBeTruthy();
  });

  test("an ordinary visit asks nothing", () => {
    const fetchInvitePreview = vi.fn();

    render(<LandingPage onGoogleLogin={() => {}} fetchInvitePreview={fetchInvitePreview} />);

    // No token, no request: the landing page stays a page that needs no server.
    expect(fetchInvitePreview).not.toHaveBeenCalled();
    expect(screen.queryByText(text.inviteTitle)).toBeNull();
  });

  test("the invite leads the hero on a phone, so the link is confirmed before the argument", async () => {
    window.history.replaceState(null, "", "/?invite=EQO-ABC123");
    render(
      <LandingPage
        onGoogleLogin={() => {}}
        fetchInvitePreview={vi.fn().mockResolvedValue(preview)}
      />,
    );

    const invite = await screen.findByText(text.inviteTitle);
    const copy = document.querySelector(".landing-hero-copy");
    expect(copy).toBeTruthy();

    // DOCUMENT_POSITION_FOLLOWING (4) on the copy column means the invite
    // card precedes it in the DOM — which is what makes it lead the hero at
    // every width now that the layout is a single stacked column everywhere,
    // decided by source order rather than any explicit placement.
    // eslint-disable-next-line no-bitwise
    const position = invite.closest(".landing-invite")!.compareDocumentPosition(copy!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/**
 * What a stranger can see before being asked for their Google account.
 *
 * The argument itself — the fabricated group chat, the product shot, the
 * three claims it backs up — sits below the hero now (see "the first screen
 * is four things" below for what the hero keeps).
 */
describe("the hero dramatises the argument", () => {
  test("a group can't agree who owes whom, and Equo settles it", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    expect(screen.getByText(text.chatLine1)).toBeTruthy();
    expect(screen.getByText(text.chatLine2)).toBeTruthy();
    expect(screen.getByText(text.chatLine3)).toBeTruthy();
    expect(screen.getByText(text.chatLine4)).toBeTruthy();
    expect(screen.getByText(text.chatSettleNote)).toBeTruthy();
    expect(screen.getByText(text.demoSettleAmount1)).toBeTruthy();
    expect(screen.getByText(text.demoSettleAmount2)).toBeTruthy();
  });

  test("and says, in the markup, that the conversation is made up", () => {
    // Mutation-verified: removing the <figcaption> (or its wrapping <figure>)
    // turns this red, which is the point — the label is not decoration.
    render(<LandingPage onGoogleLogin={() => {}} />);

    const label = screen.getByText(text.demoChatLabel);
    expect(label.tagName).toBe("FIGCAPTION");
    expect(label.getAttribute("aria-hidden")).toBeNull();
    expect(label.closest("figure.landing-chat")).toBeTruthy();
  });

  test("an invite replaces the conversation, not the page", async () => {
    window.history.replaceState(null, "", "/?invite=EQO-ABC123");
    render(
      <LandingPage
        onGoogleLogin={() => {}}
        fetchInvitePreview={vi.fn().mockResolvedValue({ group: { name: "東京旅行", member_count: 4 } })}
      />,
    );

    expect(await screen.findByText("東京旅行")).toBeTruthy();
    expect(screen.queryByText(text.demoChatLabel)).toBeNull();
    expect(screen.queryByText(text.chatLine1)).toBeNull();
    // Everything else the page argues stays intact.
    expect(screen.getByRole("button", { name: new RegExp(UI_TEXT.login.googleLogin) })).toBeTruthy();
    expect(screen.getByText(text.faq1A)).toBeTruthy();
  });
});

describe("the first screen is four things and a way out of it", () => {
  test("the conversation is below the fold, not in the hero", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    const figure = screen.getByText(text.demoChatLabel).closest("figure.landing-chat");
    expect(figure?.closest(".landing-below")).toBeTruthy();
    expect(figure?.closest(".landing-hero")).toBeNull();
  });

  test("the only cue out of it is a real anchor at a real id", () => {
    // Not a button with scrollIntoView: this href is also what
    // publicPageSeo.test.ts reads out of the page's own source.
    render(<LandingPage onGoogleLogin={() => {}} />);

    expect(screen.getByRole("link", { name: text.scrollCue }).getAttribute("href")).toBe("#landing-value");
    expect(document.querySelector("#landing-value")).toBeTruthy();
  });

  test("the topbar is the wordmark and nothing else", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);
    expect(document.querySelector(".landing-topbar-nav")).toBeNull();
  });
});

describe("the group-shares demo (stage 2)", () => {
  test("#landing-ledger exists, sits below the fold, and is not in the hero", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    const section = document.querySelector("#landing-ledger");
    expect(section).toBeTruthy();
    expect(section?.closest(".landing-below")).toBeTruthy();
    expect(section?.closest(".landing-hero")).toBeNull();
  });

  test("the demo's caption is a real figcaption inside figure.landing-ledger", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    const label = screen.getByText(text.demoLedgerLabel);
    expect(label.tagName).toBe("FIGCAPTION");
    expect(label.closest("figure.landing-ledger")).toBeTruthy();
  });

  // [MV: change demoLedgerOwn]
  test("the demo's own + share amounts sum to the displayed total", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    const parseNt = (value: string) => Number(value.replace(/[^\d.]/g, ""));
    expect(parseNt(text.demoLedgerOwn) + parseNt(text.demoLedgerShare)).toBe(parseNt(text.demoLedgerTotal));
  });

  test("the two-button page is unaffected - no button anywhere in the new section", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    const section = document.querySelector("#landing-ledger");
    expect(section?.querySelector("button")).toBeNull();
  });
});

describe("the feature list shows three and keeps three", () => {
  test("the rest are one click away — and still in the markup", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    const rest = document.querySelector<HTMLDetailsElement>(".landing-more-rest");
    expect(rest).toBeTruthy();
    expect(rest?.open).toBe(false);
    expect(screen.getByText(UI_TEXT.app.viewAll)).toBeTruthy();
    // Mutation guard: first three outside the disclosure, last three inside.
    expect(screen.getByText(text.more1).closest(".landing-more-rest")).toBeNull();
    expect(screen.getByText(text.more6).closest(".landing-more-rest")).toBeTruthy();
  });
});

describe("the closing band offers the same sign-in a second time", () => {
  test("with a distinct label, so the page never asks the same question by the same name twice", () => {
    const onGoogleLogin = vi.fn();
    render(<LandingPage onGoogleLogin={onGoogleLogin} />);

    // Regression guard: a second button with the SAME accessible name as the
    // hero's would make every getByText/getByRole(name: googleLogin) call
    // site elsewhere in the suite throw on finding two matches. Named rather
    // than counted: a third button appearing (the "還有這些" disclosure, say,
    // built as a <button> instead of <details>/<summary>) is a regression,
    // and so is either of these two losing its own label.
    expect(screen.getByText(UI_TEXT.login.googleLogin)).toBeTruthy();
    const closing = screen.getByRole("button", { name: new RegExp(text.closingCta) });
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      UI_TEXT.login.googleLogin,
      text.closingCta,
    ]);

    fireEvent.click(closing);
    expect(onGoogleLogin).toHaveBeenCalledTimes(1);
  });

  test("but not while a sign-in is already in flight", () => {
    // The hero swaps to a loading row when `loading` is true, so there is no
    // hero button to double-click by then — but this one stayed a plain,
    // clickable button until this test existed, and a click on it re-fires
    // sign-in on top of the one already running.
    render(<LandingPage onGoogleLogin={() => {}} loading />);

    const closing = screen.getByRole("button", { name: new RegExp(text.closingCta) });
    expect((closing as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("no copy is invented in the component itself", () => {
  test("every user-facing string comes from the dictionary, not a literal", () => {
    // Strips comments (which do quote Chinese in their explanations) and then
    // looks for any remaining CJK codepoint — the signature of a string that
    // was typed directly into the JSX instead of read from `text.*`.
    const source = readAppFile("LandingPage.tsx");
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    // Unified ideographs plus the punctuation a literal would actually use \u2014
    // CJK punctuation (\u3002\u3001\u300c\u300d), fullwidth forms (\uff0c\uff1a\uff01), and the katakana
    // middle dot (\u30fb) \u2014 so a string with no ideograph in it, only punctuation
    // around an interpolation, cannot slip past as "not CJK".
    expect(stripped).not.toMatch(/[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/);
  });
});

describe("the real product, beside the claims it backs up", () => {
  const shot = () => document.querySelector<HTMLImageElement>(".landing-shot img");

  test("the value section shows the app itself, not just a description of it", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    const image = shot();
    expect(image).toBeTruthy();
    expect(image?.getAttribute("src")).toContain("/screenshots/");
  });

  test("it is described, because it carries the argument the section is making", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);
    expect(shot()?.getAttribute("alt")).toBe(text.heroShotAlt);
  });

  test("and it is lazy — the headline is the largest thing queued on load now", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);
    const image = shot();

    expect(image?.getAttribute("loading")).toBe("lazy");
    // Intrinsic size on the tag, so the layout does not jump when it lands.
    expect(image?.getAttribute("width")).toBeTruthy();
    expect(image?.getAttribute("height")).toBeTruthy();
  });
});

describe("the FAQ", () => {
  const items = () => [...document.querySelectorAll<HTMLDetailsElement>(".landing-faq-item")];

  test("opens nothing on arrival — the first screen owes nobody an answer yet", () => {
    // Phase four: the whole page below the hero follows the same progressive-
    // disclosure rule the app itself does. Exactly one question forced open
    // (it used to be faq1) is the behaviour this replaced.
    render(<LandingPage onGoogleLogin={() => {}} />);

    expect(items().length).toBeGreaterThan(1);
    expect(items().every((item) => !item.open)).toBe(true);
  });

  test("but every answer is still in the markup, behind no click", () => {
    // Collapsed is not absent: <details> hides its body from the layout, not
    // from the document, which is what a crawler and a no-JS reader get.
    render(<LandingPage onGoogleLogin={() => {}} />);

    expect(screen.getByText(text.faq1A)).toBeTruthy();
    expect(screen.getByText(text.faq5A)).toBeTruthy();
  });
});

describe("the page's own metadata", () => {
  const html = readAppFile("..", "..", "index.html");

  test("says the page exists in English too", () => {
    // One document is served to everybody, so the card itself is the 繁體中文
    // one; this is the part that can be told without locale negotiation.
    expect(html).toContain('property="og:locale" content="zh_TW"');
    expect(html).toContain('property="og:locale:alternate" content="en_US"');
  });
});
