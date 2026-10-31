import type { LineAction, LineFlexMessage, LineMessage, LineUriAction } from "./lineFlex.js";

/**
 * A test-only checker for LINE reply messages (the same convention as
 * db/fakePostgrest.ts: it lives beside the code it checks, and only tests
 * import it). LINE answers a message it does not like with a 400 whose body
 * the bot deliberately never reads, so production can't say WHY. Every limit
 * and rule the cards rely on is written down here once and every test that
 * builds a message runs it through.
 *
 * It is stricter than LINE on purpose. Besides the documented limits it
 * refuses anything the cards deliberately avoid - carousels, spans, fillers,
 * gradients, absolute positioning, bubble sizes that fall back on old
 * clients - and anything that could write on the user's behalf from inside a
 * card (only uri actions are allowed there; the one place a message action is
 * allowed, 復原, is a quick reply). It also refuses reliance on defaults: LINE
 * clients disagree about padding, spacing and colour, so a box with no
 * `spacing`, a text with no `color`, or a block with no background fails.
 *
 * Limits: https://developers.line.biz/en/reference/messaging-api/#message-objects
 * and https://developers.line.biz/en/docs/messaging-api/flex-message-elements/
 * (UTF-16 code units for text and altText; action labels are counted by
 * grapheme, which UTF-16 length only ever over-counts - so it is the safe test).
 */

type Rec = Record<string, unknown>;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const PX = /^\d{1,3}px$/;
const PERCENT = /^([1-9]\d?|100)%$/;
const SCHEME = /^(https?|line|tel):/i;
const ASPECT_RATIO = /^(\d{1,6}):(\d{1,6})$/;
/** A high surrogate with no low one after it, or a low one with no high one before it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const SPACING = new Set(["none", "xs", "sm", "md", "lg", "xl", "xxl"]);
const TEXT_SIZES = new Set(["xxs", "xs", "sm", "md", "lg", "xl", "xxl", "3xl", "4xl", "5xl"]);
const IMAGE_SIZES = new Set([...TEXT_SIZES, "full"]);
const BUBBLE_SIZES = new Set(["nano", "micro", "kilo", "mega", "giga"]);
const FORBIDDEN_BUBBLE_SIZES = new Set(["deca", "hecto"]);
const FORBIDDEN_COMPONENTS = new Set(["filler", "span", "icon", "video"]);
const FORBIDDEN_PROPS = new Set([
  "background",
  "position",
  "offsetTop",
  "offsetBottom",
  "offsetStart",
  "offsetEnd",
  "adjustMode",
  "scaling",
  "lineSpacing",
  "animated",
]);

const KEYS = {
  textMessage: ["type", "text", "quickReply"],
  flexMessage: ["type", "altText", "contents", "quickReply"],
  templateMessage: ["type", "altText", "template", "quickReply"],
  template: ["type", "text", "actions"],
  bubble: ["type", "hero", "body", "footer", "styles", "size"],
  styles: ["hero", "body", "footer"],
  blockStyle: ["backgroundColor", "separator", "separatorColor"],
  box: [
    "type",
    "layout",
    "contents",
    "flex",
    "spacing",
    "margin",
    "paddingAll",
    "paddingTop",
    "paddingBottom",
    "paddingStart",
    "paddingEnd",
    "backgroundColor",
    "cornerRadius",
    "width",
    "height",
    "justifyContent",
    "alignItems",
  ],
  text: ["type", "text", "color", "size", "weight", "align", "wrap", "maxLines", "flex", "margin"],
  button: ["type", "action", "style", "color", "height", "margin", "flex"],
  separator: ["type", "color", "margin"],
  image: ["type", "url", "size", "aspectRatio", "aspectMode", "backgroundColor"],
  uriAction: ["type", "label", "uri"],
  messageAction: ["type", "label", "text"],
  quickReply: ["items"],
  quickReplyItem: ["type", "action"],
} as const;

const MAX_BUBBLE_BYTES = 30_000;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Problems {
  readonly list: string[] = [];

  add(path: string, problem: string): void {
    this.list.push(`${path}: ${problem}`);
  }
}

function checkKeys(node: Rec, allowed: readonly string[], path: string, out: Problems): void {
  for (const key of Object.keys(node)) {
    // An undefined value is not sent (JSON.stringify drops it), so it is not a property.
    if (node[key] === undefined) continue;
    if (FORBIDDEN_PROPS.has(key)) out.add(`${path}.${key}`, "is a forbidden property (unsupported or unreliable on some LINE clients)");
    else if (!allowed.includes(key)) out.add(`${path}.${key}`, "is not a known property");
  }
}

function checkColor(value: unknown, path: string, out: Problems): void {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    out.add(path, `must be a #RRGGBB colour, got ${JSON.stringify(value)}`);
  }
}

/** A required colour: missing is its own problem, because "no colour" means LINE's client-dependent default. */
function requireColor(node: Rec, key: string, path: string, out: Problems): void {
  if (node[key] === undefined) out.add(`${path}.${key}`, "is required: do not rely on LINE's default colour");
  else checkColor(node[key], `${path}.${key}`, out);
}

function checkInteger(value: unknown, min: number, path: string, out: Problems): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    out.add(path, `must be an integer >= ${min}, got ${JSON.stringify(value)}`);
  }
}

function checkOneOf(value: unknown, allowed: ReadonlySet<string>, path: string, out: Problems): void {
  if (typeof value !== "string" || !allowed.has(value)) {
    out.add(path, `must be one of ${[...allowed].join("|")}, got ${JSON.stringify(value)}`);
  }
}

/** Margin, spacing, padding* and cornerRadius: a keyword or whole pixels. */
function checkLength(value: unknown, path: string, out: Problems): void {
  if (typeof value === "string" && (SPACING.has(value) || PX.test(value))) return;
  out.add(path, `must be a spacing keyword or a whole-pixel length like "12px", got ${JSON.stringify(value)}`);
}

function checkString(value: unknown, min: number, max: number, path: string, out: Problems): void {
  if (typeof value !== "string") {
    out.add(path, `must be a string, got ${JSON.stringify(value)}`);
  } else if (value.length < min || value.length > max) {
    out.add(path, `must be ${min}-${max} UTF-16 units long, is ${value.length}`);
  }
}

function checkOptional(node: Rec, key: string, path: string, out: Problems, check: (value: unknown, path: string) => void): void {
  if (node[key] !== undefined) check(node[key], `${path}.${key}`);
}

type ActionKind = "uri" | "message";

function validateAction(node: unknown, path: string, out: Problems, allowed: readonly ActionKind[], where: string): void {
  if (!isRecord(node)) {
    out.add(path, "must be an action object");
    return;
  }

  if (node.type === "uri") {
    checkKeys(node, KEYS.uriAction, path, out);
    checkString(node.label, 1, 20, `${path}.label`, out);
    checkString(node.uri, 1, 1000, `${path}.uri`, out);
    if (typeof node.uri === "string" && !SCHEME.test(node.uri)) out.add(`${path}.uri`, "must start with http:, https:, line: or tel:");
  } else if (node.type === "message") {
    if (!allowed.includes("message")) {
      out.add(`${path}.type`, `a message action is not allowed in ${where}: tapping it would send text as the user`);
      return;
    }
    checkKeys(node, KEYS.messageAction, path, out);
    checkString(node.label, 1, 20, `${path}.label`, out);
    checkString(node.text, 1, 300, `${path}.text`, out);
  } else {
    out.add(`${path}.type`, `unsupported action type ${JSON.stringify(node.type)} (only uri${allowed.includes("message") ? " and message" : ""})`);
  }
}

function validateQuickReply(node: unknown, path: string, out: Problems): void {
  if (node === undefined) return;
  if (!isRecord(node)) {
    out.add(path, "must be an object");
    return;
  }

  checkKeys(node, KEYS.quickReply, path, out);
  const items = node.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 13) {
    out.add(`${path}.items`, "must be an array of 1-13 items");
    return;
  }

  items.forEach((item, index) => {
    const itemPath = `${path}.items[${index}]`;
    if (!isRecord(item)) {
      out.add(itemPath, "must be an object");
      return;
    }
    checkKeys(item, KEYS.quickReplyItem, itemPath, out);
    if (item.type !== "action") out.add(`${itemPath}.type`, 'must be "action"');
    validateAction(item.action, `${itemPath}.action`, out, ["uri", "message"], "a quick reply");
  });
}

function validateText(node: Rec, path: string, out: Problems): void {
  checkKeys(node, KEYS.text, path, out);
  if (node.contents !== undefined) out.add(`${path}.contents`, "spans are forbidden: a text node carries a plain string");
  if (typeof node.text !== "string" || node.text.trim() === "") {
    out.add(`${path}.text`, `must be a non-blank string, got ${JSON.stringify(node.text)}`);
  }
  requireColor(node, "color", path, out);
  checkOptional(node, "size", path, out, (v, p) => checkOneOf(v, TEXT_SIZES, p, out));
  checkOptional(node, "weight", path, out, (v, p) => checkOneOf(v, new Set(["regular", "bold"]), p, out));
  checkOptional(node, "align", path, out, (v, p) => checkOneOf(v, new Set(["start", "end", "center"]), p, out));
  checkOptional(node, "wrap", path, out, (v, p) => {
    if (typeof v !== "boolean") out.add(p, "must be a boolean");
  });
  checkOptional(node, "maxLines", path, out, (v, p) => checkInteger(v, 1, p, out));
  checkOptional(node, "flex", path, out, (v, p) => checkInteger(v, 0, p, out));
  checkOptional(node, "margin", path, out, (v, p) => checkLength(v, p, out));
}

function validateButton(node: Rec, path: string, out: Problems): void {
  checkKeys(node, KEYS.button, path, out);
  // Inside a card an action may only open a URL: this is what keeps 復原 (and any other write) out of reach of a stray tap.
  validateAction(node.action, `${path}.action`, out, ["uri"], "a card");
  checkOptional(node, "style", path, out, (v, p) => checkOneOf(v, new Set(["primary", "secondary", "link"]), p, out));
  checkOptional(node, "color", path, out, (v, p) => checkColor(v, p, out));
  checkOptional(node, "height", path, out, (v, p) => checkOneOf(v, new Set(["sm", "md"]), p, out));
  checkOptional(node, "margin", path, out, (v, p) => checkLength(v, p, out));
  checkOptional(node, "flex", path, out, (v, p) => checkInteger(v, 0, p, out));
}

function validateSeparator(node: Rec, path: string, out: Problems): void {
  checkKeys(node, KEYS.separator, path, out);
  requireColor(node, "color", path, out);
  checkOptional(node, "margin", path, out, (v, p) => checkLength(v, p, out));
}

function validateImage(node: unknown, path: string, out: Problems): void {
  if (!isRecord(node) || node.type !== "image") {
    out.add(path, 'must be an image ({"type":"image"})');
    return;
  }

  checkKeys(node, KEYS.image, path, out);
  checkString(node.url, 1, 2000, `${path}.url`, out);
  if (typeof node.url === "string") {
    let url: URL | null = null;
    try {
      url = new URL(node.url);
    } catch {
      out.add(`${path}.url`, "is not a URL");
    }
    if (url && url.protocol !== "https:") out.add(`${path}.url`, "must be https");
    if (url && !/\.(jpe?g|png)$/i.test(url.pathname)) out.add(`${path}.url`, "must point at a .jpg, .jpeg or .png file");
  }

  checkOptional(node, "size", path, out, (v, p) => checkOneOf(v, IMAGE_SIZES, p, out));
  checkOptional(node, "aspectMode", path, out, (v, p) => checkOneOf(v, new Set(["fit", "cover"]), p, out));
  checkOptional(node, "backgroundColor", path, out, (v, p) => checkColor(v, p, out));
  checkOptional(node, "aspectRatio", path, out, (v, p) => {
    const match = typeof v === "string" ? ASPECT_RATIO.exec(v) : null;
    if (!match) out.add(p, `must look like "2:1", got ${JSON.stringify(v)}`);
    else if (Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[2]) > 3 * Number(match[1])) {
      out.add(p, `width and height must be at least 1 and height at most 3x width, got ${JSON.stringify(v)}`);
    }
  });
}

type BoxOptions = { block?: boolean };

function validateBox(node: unknown, path: string, out: Problems, options: BoxOptions = {}): void {
  if (!isRecord(node) || node.type !== "box") {
    out.add(path, 'must be a box ({"type":"box"})');
    return;
  }

  checkKeys(node, KEYS.box, path, out);
  checkOneOf(node.layout, new Set(["horizontal", "vertical"]), `${path}.layout`, out);

  if (node.spacing === undefined) out.add(`${path}.spacing`, "is required: do not rely on LINE's default spacing");
  else checkLength(node.spacing, `${path}.spacing`, out);

  if (options.block && node.paddingAll === undefined) {
    out.add(`${path}.paddingAll`, "is required on a body or footer: do not rely on LINE's default padding");
  }
  for (const key of ["margin", "paddingAll", "paddingTop", "paddingBottom", "paddingStart", "paddingEnd", "cornerRadius"]) {
    checkOptional(node, key, path, out, (v, p) => checkLength(v, p, out));
  }
  checkOptional(node, "width", path, out, (v, p) => {
    if (typeof v !== "string" || !(PX.test(v) || PERCENT.test(v))) out.add(p, `must be whole pixels or a whole percent from 1% to 100%, got ${JSON.stringify(v)}`);
  });
  checkOptional(node, "height", path, out, (v, p) => {
    if (typeof v !== "string" || !PX.test(v)) out.add(p, `must be whole pixels like "6px", got ${JSON.stringify(v)}`);
  });
  checkOptional(node, "flex", path, out, (v, p) => checkInteger(v, 0, p, out));
  checkOptional(node, "backgroundColor", path, out, (v, p) => checkColor(v, p, out));
  checkOptional(node, "alignItems", path, out, (v, p) => checkOneOf(v, new Set(["center", "flex-start", "flex-end"]), p, out));
  checkOptional(node, "justifyContent", path, out, (v, p) =>
    checkOneOf(v, new Set(["center", "flex-start", "flex-end", "space-between", "space-around", "space-evenly"]), p, out),
  );

  if (!Array.isArray(node.contents)) {
    out.add(`${path}.contents`, "must be an array");
    return;
  }
  if (node.contents.length === 0 && node.height === undefined && node.flex === undefined) {
    out.add(`${path}.contents`, "is empty and the box has neither a height nor a flex, so it would collapse to nothing");
  }
  node.contents.forEach((child, index) => validateComponent(child, `${path}.contents[${index}]`, out));
}

function validateComponent(node: unknown, path: string, out: Problems): void {
  if (!isRecord(node)) {
    out.add(path, "must be an object");
    return;
  }

  switch (node.type) {
    case "box":
      return validateBox(node, path, out);
    case "text":
      return validateText(node, path, out);
    case "button":
      return validateButton(node, path, out);
    case "separator":
      return validateSeparator(node, path, out);
    case "image":
      return validateImage(node, path, out);
    default:
      if (typeof node.type === "string" && FORBIDDEN_COMPONENTS.has(node.type)) {
        out.add(`${path}.type`, `"${node.type}" is forbidden (deprecated, or unreliable on some LINE clients)`);
      } else {
        out.add(`${path}.type`, `is not a known component type: ${JSON.stringify(node.type)}`);
      }
  }
}

function validateStyles(bubble: Rec, path: string, out: Problems): void {
  const styles = bubble.styles;
  if (!isRecord(styles)) {
    out.add(`${path}.styles`, "is required: every block needs its own backgroundColor, LINE's default differs between clients");
    return;
  }

  checkKeys(styles, KEYS.styles, `${path}.styles`, out);
  for (const block of ["hero", "body", "footer"] as const) {
    const stylePath = `${path}.styles.${block}`;
    const style = styles[block];
    const present = bubble[block] !== undefined;

    if (!present) {
      if (style !== undefined) out.add(stylePath, "styles a block that is not there");
    } else if (!isRecord(style)) {
      out.add(stylePath, "is missing: the block has no backgroundColor");
    } else {
      checkKeys(style, KEYS.blockStyle, stylePath, out);
      requireColor(style, "backgroundColor", stylePath, out);
      checkOptional(style, "separator", stylePath, out, (v, p) => {
        if (typeof v !== "boolean") out.add(p, "must be a boolean");
      });
      checkOptional(style, "separatorColor", stylePath, out, (v, p) => checkColor(v, p, out));
    }
  }
}

function validateBubble(node: unknown, path: string, out: Problems): void {
  if (!isRecord(node)) {
    out.add(path, "must be a bubble object");
    return;
  }

  if (node.type === "carousel") {
    out.add(`${path}.type`, "is a carousel; only a single bubble is allowed (a carousel hides content behind horizontal scrolling)");
    return;
  }
  if (node.type !== "bubble") out.add(`${path}.type`, 'must be "bubble"');

  checkKeys(node, KEYS.bubble, path, out);
  if (node.size !== undefined) {
    if (typeof node.size === "string" && FORBIDDEN_BUBBLE_SIZES.has(node.size)) {
      out.add(`${path}.size`, `"${node.size}" is forbidden: older clients fall back to kilo`);
    } else {
      checkOneOf(node.size, BUBBLE_SIZES, `${path}.size`, out);
    }
  }

  if (node.hero !== undefined) validateImage(node.hero, `${path}.hero`, out);
  validateBox(node.body, `${path}.body`, out, { block: true });
  if (node.footer !== undefined) validateBox(node.footer, `${path}.footer`, out, { block: true });
  validateStyles(node, path, out);

  const bytes = new TextEncoder().encode(JSON.stringify(node)).length;
  if (bytes > MAX_BUBBLE_BYTES) out.add(path, `is ${bytes} bytes of JSON; LINE accepts at most ${MAX_BUBBLE_BYTES} for a bubble`);
}

function validateTemplate(node: unknown, path: string, out: Problems): void {
  if (!isRecord(node)) {
    out.add(path, "must be an object");
    return;
  }

  checkKeys(node, KEYS.template, path, out);
  if (node.type !== "buttons") out.add(`${path}.type`, 'only a "buttons" template is allowed');
  checkString(node.text, 1, 160, `${path}.text`, out);

  const actions = node.actions;
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > 4) {
    out.add(`${path}.actions`, "must be an array of 1-4 actions");
    return;
  }
  actions.forEach((action, index) => validateAction(action, `${path}.actions[${index}]`, out, ["uri"], "a template"));
}

/** Every string anywhere in the message, keys included: a lone surrogate makes JSON.stringify emit an escape LINE may refuse. */
function checkSurrogates(node: unknown, path: string, out: Problems): void {
  if (typeof node === "string") {
    if (LONE_SURROGATE.test(node)) out.add(path, "contains a lone surrogate (half of an emoji)");
  } else if (Array.isArray(node)) {
    node.forEach((item, index) => checkSurrogates(item, `${path}[${index}]`, out));
  } else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (LONE_SURROGATE.test(key)) out.add(path, `has a key with a lone surrogate: ${JSON.stringify(key)}`);
      checkSurrogates(value, `${path}.${key}`, out);
    }
  }
}

function validateMessage(node: unknown, path: string, out: Problems): void {
  if (!isRecord(node)) {
    out.add(path, "must be a message object");
    return;
  }

  switch (node.type) {
    case "text":
      checkKeys(node, KEYS.textMessage, path, out);
      checkString(node.text, 1, 5000, `${path}.text`, out);
      break;
    case "flex":
      checkKeys(node, KEYS.flexMessage, path, out);
      checkString(node.altText, 1, 400, `${path}.altText`, out);
      validateBubble(node.contents, `${path}.contents`, out);
      break;
    case "template":
      checkKeys(node, KEYS.templateMessage, path, out);
      checkString(node.altText, 1, 400, `${path}.altText`, out);
      validateTemplate(node.template, `${path}.template`, out);
      break;
    default:
      out.add(`${path}.type`, `must be "text", "flex" or "template", got ${JSON.stringify(node.type)}`);
  }

  validateQuickReply(node.quickReply, `${path}.quickReply`, out);
  checkSurrogates(node, path, out);
}

/** Everything wrong with one message, as readable lines. Empty means it is fine. */
export function lineMessageProblems(message: unknown): string[] {
  const out = new Problems();
  validateMessage(message, "message", out);
  return out.list;
}

/** Everything wrong with a whole reply (what one replyToken may carry: 1-5 messages). */
export function lineReplyProblems(messages: unknown): string[] {
  const out = new Problems();
  if (!Array.isArray(messages)) {
    out.add("messages", "must be an array");
    return out.list;
  }
  if (messages.length < 1 || messages.length > 5) out.add("messages", `must hold 1-5 messages, holds ${messages.length}`);
  messages.forEach((message, index) => validateMessage(message, `messages[${index}]`, out));
  return out.list;
}

function failure(what: string, problems: string[]): Error {
  return new Error(`${what} is not valid for LINE:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
}

export function assertValidLineMessage(message: unknown): asserts message is LineMessage {
  const problems = lineMessageProblems(message);
  if (problems.length > 0) throw failure("The message", problems);
}

export function assertValidFlexMessage(message: unknown): asserts message is LineFlexMessage {
  assertValidLineMessage(message);
  if (message.type !== "flex") throw new Error(`Expected a flex message, got a ${message.type} message`);
}

export function assertValidLineReply(messages: unknown): asserts messages is LineMessage[] {
  const problems = lineReplyProblems(messages);
  if (problems.length > 0) throw failure("The reply", problems);
}

/** What a person reading the notification sees: a text message's text, or a card's altText. */
export function plainTextOf(message: LineMessage): string {
  return message.type === "text" ? message.text : message.altText;
}

function collectActions(node: unknown, found: LineAction[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectActions(item, found);
  } else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if ((key === "action" || key === "defaultAction") && isRecord(value)) found.push(value as LineAction);
      else if (key === "actions" && Array.isArray(value)) found.push(...(value.filter(isRecord) as LineAction[]));
      else collectActions(value, found);
    }
  }
}

/**
 * Every action inside a card or template, depth-first. The quick reply is left
 * out on purpose: it is the one place a message action (復原) is legitimate,
 * and a test asking "does any card button write?" must not trip over it.
 */
export function actionsOf(message: LineMessage): LineAction[] {
  if (message.type === "text") return [];
  const found: LineAction[] = [];
  collectActions(message.type === "flex" ? message.contents : message.template, found);
  return found;
}

export function uriActionsOf(message: LineMessage): LineUriAction[] {
  return actionsOf(message).filter((action): action is LineUriAction => action.type === "uri");
}
