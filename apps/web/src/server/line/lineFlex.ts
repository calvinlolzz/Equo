/**
 * A small typed kit for building LINE Flex Messages. It knows nothing about
 * Equo: palette, copy and card layouts live in lineCardTheme.ts and
 * lineCards.ts, and this file only makes sure whatever they build is a shape
 * LINE accepts.
 *
 * The types are a deliberate SUBSET of LINE's own (the messaging-api models of
 * @line/bot-sdk, which is not a dependency): only the properties and keyword
 * values the cards use, each at least as narrow as the SDK's. Every value here
 * is therefore assignable to the SDK type - adopting the SDK later is a no-op
 * at the type level - while a typo or an unsupported feature is a compile
 * error today. They are `type` aliases, not interfaces (an interface is not
 * assignable to Record<string, unknown>), and arrays are mutable (a readonly
 * array is not assignable to the SDK's Array<>).
 *
 * LINE's defaults for padding, spacing and colour differ between clients, so
 * no card may lean on them: every box built here states its `spacing`, every
 * text and separator states its `color`, and bubble() states a background for
 * every block it has. lineFlexValidator.ts (test-only) checks LINE's limits.
 *
 * https://developers.line.biz/en/reference/messaging-api/#flex-message
 */

/** One keyword set serves margin, spacing, padding* and cornerRadius. */
export type FlexSpacing = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
export type FlexTextSize = "xxs" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl" | "3xl" | "4xl" | "5xl";
export type FlexImageSize = FlexTextSize | "full";
export type FlexPx = `${number}px`;
export type FlexPercent = `${number}%`;
/** A spacing keyword or an exact pixel length. */
export type FlexLength = FlexSpacing | FlexPx;
export type FlexAspectRatio = `${number}:${number}`;

export type LineUriAction = { type: "uri"; label: string; uri: string };

/**
 * Quick replies only. A message action in the body of a card would send text
 * as the user from a single tap - which is how an accidental 復原 would
 * delete an entry - so the card types do not allow one.
 */
export type LineMessageAction = { type: "message"; label: string; text: string };

/**
 * Sends `data` to the webhook as a postback event (and, with `displayText`,
 * shows that text in the chat as if the user had typed it). Not a message: it
 * reaches the bot only as an event whose data linePostback.ts parses. A card
 * may hold one only for the delete ASK; see lineFlexValidator.ts.
 */
export type LinePostbackAction = { type: "postback"; label: string; data: string; displayText?: string };

export type LineAction = LineUriAction | LineMessageAction | LinePostbackAction;

export type LineQuickReply = { items: Array<{ type: "action"; action: LineAction }> };

export type FlexBlockStyle = { backgroundColor: string; separator?: boolean; separatorColor?: string };

export type FlexImage = {
  type: "image";
  url: string;
  size?: FlexImageSize;
  aspectRatio?: FlexAspectRatio;
  aspectMode?: "fit" | "cover";
  backgroundColor?: string;
};

export type FlexSeparator = { type: "separator"; color: string; margin?: FlexLength };

export type FlexButton = {
  type: "button";
  action: LineUriAction | LinePostbackAction;
  style?: "primary" | "secondary" | "link";
  color?: string;
  height?: "sm" | "md";
  margin?: FlexLength;
  flex?: number;
};

export type FlexText = {
  type: "text";
  text: string;
  color: string;
  size?: FlexTextSize;
  weight?: "regular" | "bold";
  align?: "start" | "end" | "center";
  wrap?: boolean;
  maxLines?: number;
  flex?: number;
  margin?: FlexLength;
};

export type FlexBox = {
  type: "box";
  layout: "horizontal" | "vertical";
  contents: FlexComponent[];
  flex?: number;
  spacing?: FlexLength;
  margin?: FlexLength;
  paddingAll?: FlexLength;
  paddingTop?: FlexLength;
  paddingBottom?: FlexLength;
  paddingStart?: FlexLength;
  paddingEnd?: FlexLength;
  backgroundColor?: string;
  cornerRadius?: FlexLength;
  width?: FlexPx | FlexPercent;
  height?: FlexPx;
  justifyContent?: "center" | "flex-start" | "flex-end" | "space-between" | "space-around" | "space-evenly";
  alignItems?: "center" | "flex-start" | "flex-end";
};

export type FlexComponent = FlexBox | FlexText | FlexButton | FlexSeparator | FlexImage;

/** A single bubble - never a carousel, and never a `size` or `direction`: the defaults are the widest-supported ones. */
export type FlexBubble = {
  type: "bubble";
  hero?: FlexImage;
  body: FlexBox;
  footer?: FlexBox;
  styles: { hero?: FlexBlockStyle; body: FlexBlockStyle; footer?: FlexBlockStyle };
};

export type LineTextMessage = { type: "text"; text: string; quickReply?: LineQuickReply };

/** A buttons template with uri actions only - what the link fallback needs, and nothing that could write. */
export type LineTemplateMessage = {
  type: "template";
  altText: string;
  template: { type: "buttons"; text: string; actions: LineUriAction[] };
  quickReply?: LineQuickReply;
};

export type LineFlexMessage = { type: "flex"; altText: string; contents: FlexBubble; quickReply?: LineQuickReply };

/**
 * Everything the client can send as a reply. Deliberately a union of the three
 * real shapes rather than Record<string, unknown>: that looser type let a
 * wrapper object (lineMessages.ts's LineCard) type-check as a message and
 * reach the API.
 */
export type LineMessage = LineTextMessage | LineTemplateMessage | LineFlexMessage;

/** What stands in for text that is empty - the same dash formatAmount shows for a missing figure. */
const BLANK = "—";

/** LINE counts text and altText in UTF-16 code units, so an emoji costs two. */
const ALT_TEXT_MAX = 400;

/** Labels are counted in grapheme clusters, which never outnumber UTF-16 units - capping the units caps both. */
const LABEL_MAX = 20;

/** A postback action's displayText is capped at 300 by LINE. */
const DISPLAY_TEXT_MAX = 300;

function isBlank(value: string): boolean {
  return value.trim() === "";
}

/**
 * At most `max` UTF-16 units, ending in "…" when anything was cut. It only ever
 * cuts between code points: slicing by index could leave half of a surrogate
 * pair, which JSON.stringify would then send as a lone surrogate escape.
 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;

  let kept = "";
  for (const char of value) {
    // The ellipsis takes one unit of the budget.
    if (kept.length + char.length > max - 1) break;
    kept += char;
  }
  return `${kept}…`;
}

/** The notification and chat-list preview of a card. A blank one is invisible, so it becomes a dash. */
export function lineAltText(value: string): string {
  return truncate(isBlank(value) ? BLANK : value, ALT_TEXT_MAX);
}

/** An action label; LINE rejects an empty one and one over 20. */
export function clampLabel(value: string): string {
  return truncate(isBlank(value) ? BLANK : value, LABEL_MAX);
}

/** Drops undefined-valued keys, so the object in memory is exactly what JSON.stringify sends and what the validator reads. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function px(value: number): FlexPx {
  return `${value}px`;
}

export type FlexTextStyle = Omit<FlexText, "type" | "text">;

/** A text node. Empty or whitespace-only text renders as nothing (or is refused by LINE), so it becomes a dash. */
export function text(value: string, style: FlexTextStyle): FlexText {
  return compact<FlexText>({ type: "text", text: isBlank(value) ? BLANK : value, ...style });
}

export type FlexBoxProps = Omit<FlexBox, "type" | "layout" | "contents">;

function box(layout: FlexBox["layout"], contents: FlexComponent[], props: FlexBoxProps): FlexBox {
  // `= "none"` covers an explicit undefined too, so a box never inherits LINE's client-dependent default.
  const { spacing = "none", ...rest } = props;
  return compact<FlexBox>({ type: "box", layout, contents, spacing, ...rest });
}

export function vbox(contents: FlexComponent[], props: FlexBoxProps = {}): FlexBox {
  return box("vertical", contents, props);
}

export function hbox(contents: FlexComponent[], props: FlexBoxProps = {}): FlexBox {
  return box("horizontal", contents, props);
}

export function separator(color: string, margin?: FlexLength): FlexSeparator {
  return compact<FlexSeparator>({ type: "separator", color, margin });
}

/**
 * A button that opens a URL. `color` is the fill for the primary style (LINE
 * always draws its label white, so the caller picks a fill that holds contrast
 * with white) and the label colour for the link style.
 */
export function uriButton(
  label: string,
  uri: string,
  options: { color: string; style?: FlexButton["style"]; height?: FlexButton["height"]; flex?: number },
): FlexButton {
  return compact<FlexButton>({
    type: "button",
    style: options.style ?? "primary",
    color: options.color,
    height: options.height ?? "sm",
    flex: options.flex,
    action: { type: "uri", label: clampLabel(label), uri },
  });
}

/**
 * A button that sends a postback. Same colour rules as uriButton. `data` goes
 * out exactly as given (cutting it would turn it into a different postback;
 * the validator refuses one over 300), `displayText` is what the chat shows
 * when it is tapped and is left off when blank - LINE refuses an empty one.
 */
export function postbackButton(
  label: string,
  data: string,
  options: {
    color: string;
    style?: FlexButton["style"];
    height?: FlexButton["height"];
    flex?: number;
    displayText?: string;
  },
): FlexButton {
  const displayText = options.displayText === undefined || isBlank(options.displayText) ? undefined : truncate(options.displayText, DISPLAY_TEXT_MAX);

  return compact<FlexButton>({
    type: "button",
    style: options.style ?? "primary",
    color: options.color,
    height: options.height ?? "sm",
    flex: options.flex,
    action: compact<LinePostbackAction>({ type: "postback", label: clampLabel(label), data, displayText }),
  });
}

export function heroImage(url: string, aspectRatio: FlexAspectRatio, background: string): FlexImage {
  return { type: "image", url, size: "full", aspectRatio, aspectMode: "cover", backgroundColor: background };
}

/** A whole percent from 0 to 100; anything that is not a number counts as 0. */
function wholePercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.floor(value)));
}

/**
 * A rounded bar: a track box, with a fill box inside it when there is anything
 * to fill. Built from boxes with `contents: []` because LINE deprecated the
 * filler component, which is what bars used to be made of.
 *
 * `percent` is floored and clamped to 0-100. At 0 the track is left empty
 * rather than given a 0% fill: `width: "0%"` is not a length LINE accepts.
 * Callers that want a sliver for a tiny non-zero value get one from
 * barPercent() before they get here - this function never rounds up.
 *
 * `height` is pixels, as a number or as "6px"; the corners are half of it so
 * the ends are round, and it is kept a whole number of at least 1px because
 * LINE takes whole-pixel lengths here.
 */
export function progressBar(
  percent: number,
  options: { fill: string; track: string; height: number | FlexPx; margin?: FlexLength },
): FlexBox {
  const filled = wholePercent(percent);
  const requested = typeof options.height === "number" ? options.height : Number.parseFloat(options.height);
  const barHeight = Math.max(1, Math.round(requested));
  const height = px(barHeight);
  const cornerRadius = px(Math.floor(barHeight / 2));

  const fill: FlexComponent[] =
    filled === 0
      ? []
      : [vbox([], { width: `${filled}%`, height, cornerRadius, backgroundColor: options.fill })];

  return vbox(fill, { height, cornerRadius, backgroundColor: options.track, margin: options.margin });
}

/**
 * Wraps the parts in a bubble and writes `styles` for every block it has - LINE's
 * default block background differs between clients, so a block without one is
 * a block that is white in some of them. `footerSeparator` is the colour of
 * the line LINE draws between body and footer; leave it out for no line.
 */
export function bubble(parts: {
  hero?: FlexImage;
  body: FlexBox;
  footer?: FlexBox;
  background: string;
  footerSeparator?: string;
}): FlexBubble {
  const block = (): FlexBlockStyle => ({ backgroundColor: parts.background });

  return compact<FlexBubble>({
    type: "bubble",
    hero: parts.hero,
    body: parts.body,
    footer: parts.footer,
    styles: compact({
      hero: parts.hero ? block() : undefined,
      body: block(),
      footer: parts.footer
        ? { ...block(), ...(parts.footerSeparator ? { separator: true, separatorColor: parts.footerSeparator } : {}) }
        : undefined,
    }),
  });
}

/** A flex message; `altText` is clamped to LINE's limit here so no caller has to remember to. */
export function flexMessage(altText: string, contents: FlexBubble, quickReply?: LineQuickReply): LineFlexMessage {
  return compact<LineFlexMessage>({ type: "flex", altText: lineAltText(altText), contents, quickReply });
}
