import { afterEach, describe, expect, test, vi } from "vitest";
import {
  RECEIPT_SCAN_DEFAULT_MODEL,
  availableReceiptScanModels,
  ReceiptScanUnavailableError,
  createReceiptScanner,
  estimateScanCostMicros,
  findReceiptScanModel,
  normaliseReceiptResult,
  readLastScanUsage,
} from "./receiptScanner.js";

describe("normaliseReceiptResult", () => {
  const good = {
    recognised: true,
    merchant: "全家便利商店",
    total_amount: 125.5,
    currency: "TWD",
    purchased_at: "2026-07-29",
    category: "food",
    items: [{ name: "美式咖啡", amount: 65 }],
  };

  test("converts a decimal total to the hundredths every amount in the app uses", () => {
    expect(normaliseReceiptResult(good, "TWD")).toMatchObject({
      recognised: true,
      merchant: "全家便利商店",
      amount_minor: 12550,
      currency: "TWD",
      purchased_at: "2026-07-29",
      category: "food",
      items: [{ name: "美式咖啡", amount_minor: 6500 }],
    });
  });

  test("uses hundredths for JPY too, matching what a hand-typed yen expense stores", () => {
    // The composer round-trips every currency through /100, so a yen receipt
    // must not be scaled differently or 1200 JPY lands as 12 JPY.
    expect(normaliseReceiptResult({ ...good, total_amount: 1200, currency: "JPY" }, "TWD").amount_minor).toBe(120000);
  });

  test("reports nothing when the model said it did not recognise a receipt", () => {
    expect(normaliseReceiptResult({ ...good, recognised: false }, "TWD")).toEqual({
      recognised: false,
      merchant: null,
      amount_minor: null,
      currency: null,
      purchased_at: null,
      category: null,
      items: [],
    });
  });

  test("treats a claimed recognition with no readable total as a failed scan", () => {
    expect(normaliseReceiptResult({ ...good, total_amount: null }, "TWD").recognised).toBe(false);
    expect(normaliseReceiptResult({ ...good, total_amount: 0 }, "TWD").recognised).toBe(false);
    expect(normaliseReceiptResult({ ...good, total_amount: -50 }, "TWD").recognised).toBe(false);
  });

  test("drops a category that is not one of the composer's chips", () => {
    expect(normaliseReceiptResult({ ...good, category: "groceries" }, "TWD").category).toBeNull();
  });

  test("drops a date that is not a real calendar day", () => {
    expect(normaliseReceiptResult({ ...good, purchased_at: "2026-02-31" }, "TWD").purchased_at).toBeNull();
    expect(normaliseReceiptResult({ ...good, purchased_at: "29/07/2026" }, "TWD").purchased_at).toBeNull();
  });

  test("falls back to the group currency when the receipt printed none", () => {
    expect(normaliseReceiptResult({ ...good, currency: null }, "JPY").currency).toBe("JPY");
  });

  test("survives a response whose fields are the wrong types entirely", () => {
    const result = normaliseReceiptResult(
      { recognised: true, total_amount: "125.5", merchant: 42, items: "nope", category: [], purchased_at: {} },
      "TWD",
    );

    expect(result.recognised).toBe(false);
  });

  test("keeps only line items that have a name, and tolerates missing amounts", () => {
    const result = normaliseReceiptResult(
      { ...good, items: [{ name: "咖啡", amount: 65 }, { name: "   ", amount: 10 }, { amount: 20 }, null] },
      "TWD",
    );

    expect(result.items).toEqual([{ name: "咖啡", amount_minor: 6500 }]);
  });
});

describe("createReceiptScanner", () => {
  test("returns undefined when no provider has a key, so the route can report the feature off", () => {
    expect(createReceiptScanner({})).toBeUndefined();
    expect(createReceiptScanner({ anthropic: "", google: "" })).toBeUndefined();
  });

  test("returns a scanner when either provider alone is configured", () => {
    expect(typeof createReceiptScanner({ anthropic: "sk-ant-test" })).toBe("function");
    expect(typeof createReceiptScanner({ google: "gemini-test" })).toBe("function");
  });
});

describe("availableReceiptScanModels", () => {
  test("offers only the models whose provider has a key here", () => {
    const anthropicOnly = availableReceiptScanModels({ anthropic: "sk-ant-test" });
    expect(anthropicOnly.every((entry) => entry.provider === "anthropic")).toBe(true);
    expect(anthropicOnly.length).toBeGreaterThan(0);

    const googleOnly = availableReceiptScanModels({ google: "gemini-test" });
    expect(googleOnly.map((entry) => entry.id)).toEqual(["gemini-3.6-flash"]);
  });

  test("offers nothing when neither key is set", () => {
    expect(availableReceiptScanModels({})).toEqual([]);
  });

  test("the default model is one of the catalog's own entries", () => {
    // A default outside the catalog would be rejected by the same allowlist
    // that is supposed to protect the scan path.
    expect(findReceiptScanModel(RECEIPT_SCAN_DEFAULT_MODEL)).toBeDefined();
  });
});

describe("the Gemini call", () => {
  const dataUrl = "data:image/jpeg;base64,QUJD";
  const modelOutput = {
    recognised: true,
    merchant: "全家便利商店",
    total_amount: 125.5,
    currency: "TWD",
    purchased_at: "2026-07-29",
    category: "food",
    items: [],
  };

  function stubFetch(body: unknown, ok = true, status = 200) {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => ({ ok, status, json: async () => body }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function sentBody(fetchMock: ReturnType<typeof stubFetch>) {
    return JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("sends the image and the instructions to the interactions endpoint", async () => {
    const fetchMock = stubFetch({
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(modelOutput) }] }],
    });
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    const result = await scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1beta/interactions");
    // The key travels in a header, never in the query string, where it would
    // end up in every proxy and access log along the way.
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("gemini-test");
    expect(url).not.toContain("gemini-test");

    const body = sentBody(fetchMock);
    expect(body.model).toBe("gemini-3.6-flash");
    // Bare base64, not the whole data URL - the prefix is not image bytes.
    expect(body.input.find((part: { type: string }) => part.type === "image")).toMatchObject({
      data: "QUJD",
      mime_type: "image/jpeg",
    });
    expect(body.response_format.mime_type).toBe("application/json");
    expect(result).toMatchObject({ recognised: true, amount_minor: 12550 });
  });

  test("puts the standing instructions before the image they apply to", async () => {
    const fetchMock = stubFetch({
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(modelOutput) }] }],
    });
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    await scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" });

    const types = sentBody(fetchMock).input.map((part: { type: string }) => part.type);
    expect(types[0]).toBe("text");
    expect(types.indexOf("image")).toBeGreaterThan(0);
  });

  test("uses a schema Gemini accepts, not Claude's anyOf dialect", async () => {
    const fetchMock = stubFetch({
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(modelOutput) }] }],
    });
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    await scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" });

    const schema = sentBody(fetchMock).response_format.schema;
    // Gemini's structured-output subset has no anyOf; nullability is a type array.
    expect(JSON.stringify(schema)).not.toContain("anyOf");
    expect(schema.properties.merchant.type).toEqual(["string", "null"]);
  });

  test("asks for the least thinking the model allows", async () => {
    const fetchMock = stubFetch({
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(modelOutput) }] }],
    });
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    await scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" });

    // Gemini 3 thinks at "medium" unless told otherwise, and reading a receipt
    // is perception rather than reasoning - that default is latency the user
    // spends watching a spinner for nothing.
    expect(sentBody(fetchMock).generation_config).toEqual({ thinking_level: "minimal" });
  });

  test("finds the model_output step rather than trusting its position", async () => {
    // The steps array is a timeline that can carry thoughts and tool calls
    // first; indexing [0] would read a thought as the answer.
    const fetchMock = stubFetch({
      steps: [
        { type: "model_thought", content: [{ type: "text", text: "thinking about the receipt" }] },
        { type: "model_output", content: [{ type: "text", text: JSON.stringify(modelOutput) }] },
      ],
    });
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    const result = await scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" });

    expect(result.recognised).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("retries once when the upstream never answers", async () => {
    // Two in three production scans ended as a full timeout with no response,
    // while the ones that answered took ~4.4s - a stall is what a second
    // attempt on a fresh connection is for.
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(modelOutput) }] }],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    const result = await scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.recognised).toBe(true);
  });

  test("gives up after the second unanswered attempt rather than hammering", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    await expect(scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" })).rejects.toBeInstanceOf(
      ReceiptScanUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("does not retry a status, because a status is a real answer", async () => {
    // Repeating a 429 spends the same rejection twice and adds load to
    // something already throttling us.
    const fetchMock = stubFetch({ error: { message: "quota exceeded" } }, false, 429);
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    await expect(scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" })).rejects.toBeInstanceOf(
      ReceiptScanUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("reports the free tier's quota rejection as unavailable, not as a crash", async () => {
    stubFetch({ error: { message: "quota exceeded" } }, false, 429);
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    await expect(scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" })).rejects.toBeInstanceOf(
      ReceiptScanUnavailableError,
    );
  });

  test("refuses to run a Google model when only the Anthropic key is set", async () => {
    const fetchMock = stubFetch({ steps: [] });
    const scan = createReceiptScanner({ anthropic: "sk-ant-test" })!;

    await expect(scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" })).rejects.toBeInstanceOf(
      ReceiptScanUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("carries the usage the upstream reported, so the scan can be costed", async () => {
    stubFetch({
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(modelOutput) }] }],
      usage: {
        total_input_tokens: 1500,
        total_output_tokens: 40,
        total_thought_tokens: 12,
        input_tokens_by_modality: [
          { modality: "text", tokens: 210 },
          { modality: "image", tokens: 1290 },
        ],
      },
    });
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    await scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" });

    expect(readLastScanUsage()).toEqual({
      inputTokens: 1500,
      outputTokens: 40,
      thoughtTokens: 12,
      // The image entry specifically, not the first modality in the list.
      imageTokens: 1290,
      attempts: 1,
    });
  });

  test("a failed scan reports its own emptiness instead of the last success's tokens", async () => {
    // Without the reset in createReceiptScanner this failure would be recorded
    // with 1500 input tokens and a real cost - billing a call that never ran.
    stubFetch({
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(modelOutput) }] }],
      usage: { total_input_tokens: 1500, total_output_tokens: 40 },
    });
    const scan = createReceiptScanner({ google: "gemini-test" })!;
    await scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" });
    expect(readLastScanUsage().inputTokens).toBe(1500);

    stubFetch({ error: { message: "quota exceeded" } }, false, 429);
    await expect(scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" })).rejects.toBeInstanceOf(
      ReceiptScanUnavailableError,
    );

    expect(readLastScanUsage()).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      // The attempt still happened and is still worth recording.
      attempts: 1,
    });
  });

  test("counts the retry, so a scan that needed two attempts does not look like one", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    vi.stubGlobal("fetch", fetchMock);
    const scan = createReceiptScanner({ google: "gemini-test" })!;

    await expect(scan({ dataUrl, currency: "TWD", model: "gemini-3.6-flash" })).rejects.toBeInstanceOf(
      ReceiptScanUnavailableError,
    );

    expect(readLastScanUsage().attempts).toBe(2);
  });
});

describe("estimateScanCostMicros", () => {
  const usage = { inputTokens: 1800, outputTokens: 210, thoughtTokens: null, imageTokens: null, attempts: 1 };

  test("prices a scan from the model's own published rates", () => {
    // Haiku 4.5 is $1/MTok in and $5/MTok out: 1800 + 210 x 5 = 2850 millionths.
    expect(estimateScanCostMicros("claude-haiku-4-5", usage)).toBe(2850);
  });

  test("a more expensive model costs more for the identical call", () => {
    // Opus 5 at $5/$25 is five times Haiku's rate on both sides.
    expect(estimateScanCostMicros("claude-opus-5", usage)).toBe(2850 * 5);
  });

  test("bills reasoning tokens at the output rate, where they are billed at all", () => {
    expect(estimateScanCostMicros("claude-haiku-4-5", { ...usage, thoughtTokens: 100 })).toBe(2850 + 100 * 5);
  });

  test("the free tier really is free, however many tokens it reports", () => {
    expect(estimateScanCostMicros("gemini-3.6-flash", { ...usage, thoughtTokens: 900 })).toBe(0);
  });

  test("reports null rather than 0 when the provider gave no token counts", () => {
    // "We did not measure this" is not "this was free" - a zero here would
    // quietly under-report the month.
    expect(estimateScanCostMicros("claude-haiku-4-5", { ...usage, inputTokens: null })).toBeNull();
    expect(estimateScanCostMicros("claude-haiku-4-5", { ...usage, outputTokens: null })).toBeNull();
  });

  test("reports null for a model this build has no price for", () => {
    expect(estimateScanCostMicros("claude-retired-9", usage)).toBeNull();
  });
});

