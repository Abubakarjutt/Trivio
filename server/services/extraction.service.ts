import { readFile } from "@/lib/storage";

export interface ExtractionLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface ExtractionResult {
  supplierName: string | null;
  supplierEmail: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // ISO date string "YYYY-MM-DD"
  dueDate: string | null; // ISO date string "YYYY-MM-DD"
  lineItems: ExtractionLineItem[];
  subtotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string | null;
  notes: string | null;
  confidence: Record<string, number>; // field name → 0-1 confidence score
}

const MOCK_RESULT: ExtractionResult = {
  supplierName: "Acme Supplies Ltd",
  supplierEmail: "billing@acme-supplies.example.com",
  invoiceNumber: "INV-2026-0042",
  invoiceDate: "2026-04-15",
  dueDate: "2026-05-15",
  lineItems: [
    { description: "Web hosting (annual)", quantity: 1, unitPrice: 299.0, amount: 299.0 },
    { description: "Domain registration", quantity: 2, unitPrice: 12.5, amount: 25.0 },
  ],
  subtotal: 324.0,
  taxAmount: 64.8,
  totalAmount: 388.8,
  currency: "USD",
  notes: "Payment due within 30 days. Bank transfer preferred.",
  confidence: {
    supplierName: 0.97,
    supplierEmail: 0.85,
    invoiceNumber: 0.99,
    invoiceDate: 0.98,
    dueDate: 0.92,
    lineItems: 0.9,
    subtotal: 0.98,
    taxAmount: 0.95,
    totalAmount: 0.99,
    currency: 0.99,
    notes: 0.75,
  },
};

const SYSTEM_PROMPT = `You are a document analysis AI that extracts structured data from invoices, bills, and receipts.
Extract the following fields and return ONLY valid JSON — no markdown, no commentary.

Required JSON shape:
{
  "supplierName": string | null,
  "supplierEmail": string | null,
  "invoiceNumber": string | null,
  "invoiceDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "lineItems": [
    { "description": string, "quantity": number, "unitPrice": number, "amount": number }
  ],
  "subtotal": number | null,
  "taxAmount": number | null,
  "totalAmount": number | null,
  "currency": "ISO 4217 code e.g. USD" | null,
  "notes": string | null,
  "confidence": {
    "supplierName": 0-1,
    "supplierEmail": 0-1,
    "invoiceNumber": 0-1,
    "invoiceDate": 0-1,
    "dueDate": 0-1,
    "lineItems": 0-1,
    "subtotal": 0-1,
    "taxAmount": 0-1,
    "totalAmount": 0-1,
    "currency": 0-1,
    "notes": 0-1
  }
}

Rules:
- All monetary values must be plain numbers (no currency symbols).
- Dates must be "YYYY-MM-DD" format.
- confidence values represent how sure you are (1.0 = certain, 0.0 = guessing).
- If a field is not present in the document use null.
- lineItems must be an array (empty array if no line items found).
- Do NOT include tax, VAT, GST, HST, sales tax, subtotals, discounts, or total lines in lineItems. Those belong exclusively in taxAmount, subtotal, and totalAmount. lineItems must contain only product or service lines.`;

const IMAGE_MIME_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Ollama configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";

export async function extractDocument(
  filePath: string,
  mimeType: string,
): Promise<ExtractionResult> {
  // Check if Ollama is reachable; fall back to mock if not
  try {
    const health = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error("Ollama not reachable");
  } catch {
    console.warn("[extraction.service] Ollama not reachable — returning mock extraction result.");
    return MOCK_RESULT;
  }

  const fileBuffer = await readFile(filePath);
  const base64Data = fileBuffer.toString("base64");
  const isPdf = mimeType === "application/pdf";

  // Ollama's chat API supports images via the "images" field (base64-encoded).
  // For PDFs, we cannot send raw image data — convert the prompt to describe
  // that we're analysing an uploaded document. Gemma4 supports vision for images.
  const userPrompt = "Extract all invoice/bill data from this document and return the structured JSON.";

  // Build Ollama chat request using the /api/chat endpoint
  // Gemma4 supports multimodal (images) via the images array
  const messages: Array<{ role: string; content: string; images?: string[] }> = [];

  if (!isPdf && IMAGE_MIME_TYPES.has(mimeType)) {
    // Vision request — attach image as base64
    messages.push({
      role: "user",
      content: `${SYSTEM_PROMPT}\n\n${userPrompt}`,
      images: [base64Data],
    });
  } else {
    // For PDFs or unsupported types, we can't send as image to Ollama.
    // Send the base64 as context (model will do its best with text-based extraction).
    messages.push({
      role: "user",
      content: `${SYSTEM_PROMPT}\n\nThe document is a PDF file encoded in base64. Attempt to extract any recognizable invoice data from it. If you cannot read the content, return all fields as null with confidence 0.\n\nBase64 content (first 5000 chars): ${base64Data.slice(0, 5000)}\n\n${userPrompt}`,
    });
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 4096,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { message?: { content?: string } };
  const content = data.message?.content;

  if (!content) {
    throw new Error("Ollama returned no content in response");
  }

  // Strip any markdown code fences the model may emit
  const raw = content.replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

  // Try to extract JSON from the response (model might include extra text)
  let jsonStr = raw;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse extraction JSON from Ollama: ${raw.slice(0, 300)}`);
  }

  // Validate and normalise the parsed result
  const result = parsed as Partial<ExtractionResult>;
  return {
    supplierName: result.supplierName ?? null,
    supplierEmail: result.supplierEmail ?? null,
    invoiceNumber: result.invoiceNumber ?? null,
    invoiceDate: result.invoiceDate ?? null,
    dueDate: result.dueDate ?? null,
    lineItems: Array.isArray(result.lineItems) ? result.lineItems : [],
    subtotal: result.subtotal ?? null,
    taxAmount: result.taxAmount ?? null,
    totalAmount: result.totalAmount ?? null,
    currency: result.currency ?? null,
    notes: result.notes ?? null,
    confidence: result.confidence ?? {},
  };
}
