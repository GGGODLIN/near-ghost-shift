export type OneClickProvenanceMode =
  | "LIVE_1CLICK_QUOTE"
  | "FALLBACK_QUOTE_PREVIEW";

export interface OneClickQuoteRequest {
  jobId: string;
  winningEpoch: number;
  winningWorker: string;
  amountInUnits: string;
  originAsset?: string;
  destinationAsset?: string;
  recipientAddress?: string;
  refundToAddress?: string;
}

export interface OneClickQuotePreview {
  jobId: string;
  winningEpoch: number;
  winningWorker: string;
  settlementMode: "QUOTE_PREVIEW";
  provenanceMode: OneClickProvenanceMode;
  dry: true;
  swapType: "EXACT_INPUT";
  originAsset: string;
  destinationAsset: string;
  amountIn: string;
  estimatedAmountOut: string;
  estimatedTimeSeconds: number;
   fallbackNote: string | null;
}

export type FetchLike = (
  url: string,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const ONECLICK_QUOTE_URL = "https://1click.chaindefuser.com/v0/quote";
const DEFAULT_ORIGIN_ASSET = "nep141:wrap.near";
const DEFAULT_DESTINATION_ASSET =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

export async function fetchOneClickSettlementQuote(
  req: Readonly<OneClickQuoteRequest>,
  fetcher: FetchLike = globalThis.fetch
): Promise<OneClickQuotePreview> {
  const originAsset = req.originAsset ?? DEFAULT_ORIGIN_ASSET;
  const destinationAsset = req.destinationAsset ?? DEFAULT_DESTINATION_ASSET;
  const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const requestBody = {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset,
    amount: req.amountInUnits,
    refundTo: req.refundToAddress ?? "intents.near",
    refundType: "ORIGIN_CHAIN",
    recipient:
      (
        req.recipientAddress ?? "0x7f4e9b20cd14a82f3e51b9c0118da63290eb1742"
      ).toLowerCase(),
    recipientType: "DESTINATION_CHAIN",
    deadline,
  };

  try {
    const response = await fetcher(ONECLICK_QUOTE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        quote?: {
          amountIn?: string;
          amountOut?: string;
          timeEstimate?: number;
        };
      };
      const quote = payload?.quote;
      if (quote && typeof quote.amountOut === "string") {
        return {
          jobId: req.jobId,
          winningEpoch: req.winningEpoch,
          winningWorker: req.winningWorker,
          settlementMode: "QUOTE_PREVIEW",
          provenanceMode: "LIVE_1CLICK_QUOTE",
          dry: true,
          swapType: "EXACT_INPUT",
          originAsset,
          destinationAsset,
          amountIn: quote.amountIn ?? req.amountInUnits,
          estimatedAmountOut: quote.amountOut,
          estimatedTimeSeconds: quote.timeEstimate ?? 15,
          fallbackNote: null,
        };
      }
    }
  } catch {
    // Redact any upstream exception message so credentials or tokens never leak into logs/fallback notes
  }

  return {
    jobId: req.jobId,
    winningEpoch: req.winningEpoch,
    winningWorker: req.winningWorker,
    settlementMode: "QUOTE_PREVIEW",
    provenanceMode: "FALLBACK_QUOTE_PREVIEW",
    dry: true,
    swapType: "EXACT_INPUT",
    originAsset,
    destinationAsset,
    amountIn: req.amountInUnits,
    estimatedAmountOut: "4850000",
    estimatedTimeSeconds: 15,
    fallbackNote:
      "Offline deterministic 1Click quote preview snapshot (upstream unreachable or rate-limited)",
  };
}
