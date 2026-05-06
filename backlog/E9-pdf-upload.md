# Epic E9 — Sales PDF Upload + Extract (P1 Stretch)

> **Priority:** P1 stretch · **Owner:** Dev B · **Days:** 8–10 only if E2–E5 all green · **Depends on:** E2 (RO materialisation service exists) · **Total estimate:** 16 hours

Sales receives a purchase order or job spec from a customer as a PDF. Rather than re-keying all the fields, they upload the PDF and the system parses it, pre-fills the New RO form, and flags any fields it couldn't read with a "needs review" badge. The parser is deterministic regex against the NEE PDF format — not AI/OCR — because all four sample PDFs share a consistent header layout and column structure. This demonstrates the capability convincingly for the demo without depending on Document Intelligence (a Phase 2 addition).

---

## Story E9-S1 — PDF file upload endpoint + storage (S, 2h)

**As sales**
**I want** to upload a PDF file and have the system store it so it can be parsed
**So that** I don't have to manually retype a customer's job spec

### Acceptance criteria
- `POST /api/sales/pdf-upload` accepts `multipart/form-data` with a `file` field (PDF only)
- Validates: MIME type must be `application/pdf`, max size 20MB; returns 400 otherwise
- Saves the file to `{uploadsBase}/pdf-uploads/{Guid}.pdf` on disk
- Inserts into `attachments`: `entity_type='PdfUpload'`, `category='SOURCE_PDF'`, `blob_path` = relative path, `uploaded_by` = current user
- Returns `201` with `{ uploadId: "<attachmentId>", fileName: "original.pdf", sizeBytes: 12345 }`
- Requires `[Authorize]` with SALES or ADMIN role

### Technical context
- Re-use the same uploads base path config from E5-S4 (`Storage:UploadsBasePath`)
- File saved with a new GUID as filename to avoid collisions; original filename stored in `attachments.file_name`
- Max body size: already configured in E5-S4 (`Limits.MaxRequestBodySize = 10_485_760`) — raise to `20_971_520` (20MB) for PDFs
- Create the `pdf-uploads/` sub-folder inside uploads base if it doesn't exist

### Done definition
- `POST` a real PDF → 201, file exists on disk, attachment row in DB
- `POST` a JPEG → 400 "Only PDF files are accepted"
- `POST` a file over 20MB → 413
- Integration test covers happy path and MIME rejection

### Claude Code prompt
```
Add PDF upload endpoint:

1. api/Endpoints/SalesPdfEndpoints.cs (new file):
   var pdf = app.MapGroup("/api/sales").RequireAuthorization().WithTags("SalesPdf");

   POST /pdf-upload
   - IFormFile file parameter
   - Validate: file.ContentType == "application/pdf" else 400
   - Validate: file.Length <= 20_971_520 else 413
   - Resolve uploads base (same IConfiguration["Storage:UploadsBasePath"] pattern as E5)
   - Save to {uploadsBase}/pdf-uploads/{Guid.NewGuid()}.pdf
   - INSERT attachments: entity_type='PdfUpload', category='SOURCE_PDF', blob_path, file_name=file.FileName, uploaded_by=currentUser
   - Return 201 { UploadId, FileName, SizeBytes }
   .DisableAntiforgery()
   .RequireAuthorization(p => p.RequireRole("SALES", "ADMIN"))

2. Update Program.cs to call app.MapSalesPdfEndpoints().

3. Update Kestrel MaxRequestBodySize to 20_971_520 in Program.cs (replace the E5 value if it was set lower).

4. Integration test (SalesPdfEndpointTests.cs):
   - POST valid PDF bytes with Content-Type application/pdf → 201, attachment in DB
   - POST with Content-Type image/jpeg → 400
   - 401 without token

Schema: attachments.
```

---

## Story E9-S2 — PDF parser service for the NEE format (M, 4h)

**As the system**
**I want** to extract structured RO fields from an uploaded NEE-format PDF
**So that** sales can have the form pre-filled rather than re-keying everything

### Acceptance criteria
- `POST /api/sales/pdf-upload/{uploadId}/parse` triggers parsing and returns extracted fields:
  ```json
  {
    "uploadId": "...",
    "fields": {
      "rego": { "value": "1AJ-213", "confidence": "HIGH" },
      "make": { "value": "Isuzu", "confidence": "HIGH" },
      "model": { "value": "NPR 75-190", "confidence": "HIGH" },
      "customerName": { "value": "Direct Freight Express", "confidence": "HIGH" },
      "requiredDate": { "value": "2026-08-01", "confidence": "MEDIUM" },
      "templateCode": { "value": "TP42N", "confidence": "LOW" },
      "priority": { "value": null, "confidence": "NONE" }
    },
    "rawText": "... first 500 chars of extracted text ..."
  }
  ```
- Confidence levels: `HIGH` (exact regex match with capture group), `MEDIUM` (fuzzy keyword match, value needs review), `LOW` (heuristic guess), `NONE` (field not found)
- NuGet package: `iText7` for PDF text extraction (no OCR — text layer only)
- `PdfParserService` with method `ParsedPdfResult Parse(Stream pdfStream)`

### Technical context
- NEE PDF format header (from the 4 sample PDFs) has consistent labels:
  - `Rego:` or `Registration:` followed by the value on the same line
  - `Customer:` or `Client:` for the customer name
  - `Required Date:` or `Required by:` for the date (format: `dd/MM/yyyy` or `dd MMM yyyy`)
  - `Make:` and `Model:` on separate lines or combined as `Make/Model:`
  - Template code appears as a 4–8 char alphanumeric code on the "Job Code" line matching pattern `[A-Z]{2,4}\d{2}[A-Z]?`
- Regex patterns live in `PdfParserService` as private static compiled `Regex` fields
- `HIGH` = label found AND value captured by the named group
- `MEDIUM` = label found but value capture is ambiguous (e.g. date parsed from a free-text string)
- `LOW` = template code inferred by matching against known codes in the DB
- `NONE` = no match found

### Done definition
- Call `POST .../parse` with a valid NEE-format PDF (use one of the 4 sample PDFs as a test fixture)
- `rego`, `make`, `model`, `customerName` return `HIGH` confidence with correct values
- `requiredDate` returns at least `MEDIUM` confidence with a parseable date
- `templateCode` returns at least `LOW` confidence matching a known template code
- Unit test with a real sample PDF fixture: verify field extraction for all HIGH-confidence fields

### Claude Code prompt
```
Implement the PDF parser service:

1. NuGet: itext7 (iText7.Core or just itext7 package)

2. api/Services/PdfParserService.cs:
   public record ParsedField(string? Value, string Confidence); // HIGH, MEDIUM, LOW, NONE
   public record ParsedPdfResult(Dictionary<string, ParsedField> Fields, string RawText);

   public class PdfParserService {
     private static readonly Regex RegoRegex = new(@"(?:Rego|Registration)\s*[:\-]\s*(?<value>[A-Z0-9\-]{3,10})", RegexOptions.IgnoreCase | RegexOptions.Compiled);
     private static readonly Regex CustomerRegex = new(@"(?:Customer|Client)\s*[:\-]\s*(?<value>.+?)(?:\r|\n|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
     private static readonly Regex RequiredDateRegex = new(@"(?:Required Date|Required by|Delivery)\s*[:\-]\s*(?<value>\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+\w{3}\s+\d{4})", RegexOptions.IgnoreCase | RegexOptions.Compiled);
     private static readonly Regex MakeRegex = new(@"Make\s*[:\-\/]\s*(?<value>[A-Za-z]+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
     private static readonly Regex ModelRegex = new(@"Model\s*[:\-\/]\s*(?<value>.+?)(?:\r|\n|$)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
     private static readonly Regex JobCodeRegex = new(@"\b(?<value>[A-Z]{2,4}\d{2}[A-Z]?(?:-[A-Z]{2,4}\d{2}[A-Z]?)?)\b", RegexOptions.Compiled);

     public ParsedPdfResult Parse(Stream pdfStream) {
       // Use iText7 PdfReader + PdfTextExtractor to extract full text
       // For each field: apply regex, classify confidence, return ParsedPdfResult
     }
   }

3. Confidence classification:
   - HIGH: Regex named group captured a value that passes basic validation (non-empty, correct length/format)
   - MEDIUM: Value captured but required post-processing (e.g. date needed format conversion)
   - LOW: Job code matched the pattern but not confirmed against known templates
   - NONE: Regex found no match

4. Register PdfParserService as singleton in Program.cs.

5. API: POST /api/sales/pdf-upload/{uploadId}/parse
   - Load attachment by id, validate entity_type='PdfUpload'
   - Open file stream from blob_path
   - Call pdfParserService.Parse(stream)
   - Return PdfParseResponse { UploadId, Fields (Dictionary), RawText (first 500 chars) }
   [Authorize]

6. Unit test (PdfParserServiceTests.cs):
   - Embed a sample PDF as a test resource (create a minimal text-layer PDF in the test fixture)
   - Assert rego, customerName, make extracted with HIGH confidence
   - Assert templateCode extracted with at least LOW confidence

Schema: attachments (blob_path, entity_type, category).
```

---

## Story E9-S3 — Confidence scoring rules (S, 2h)

**As sales**
**I want** each extracted field to tell me how confident the system is in the value
**So that** I know which fields to double-check before creating the RO

### Acceptance criteria
- The `fields` dictionary from E9-S2 is augmented with validation-based confidence adjustments:
  - `rego`: downgrade to `MEDIUM` if it contains lowercase or special chars (regs are uppercase alphanumeric)
  - `requiredDate`: downgrade to `LOW` if the parsed date is in the past or more than 2 years in the future
  - `templateCode`: upgrade from `LOW` to `MEDIUM` if the code matches an active template in the DB; stays `LOW` if it doesn't match any known template
  - `customerName`: downgrade to `MEDIUM` if no fuzzy match found in the `customers` table (within Levenshtein distance 3); `HIGH` if exact or near-exact match
- A `suggestions` object alongside each field provides a corrected or matched value:
  ```json
  "customerName": {
    "value": "Direct Freight Expresss",
    "confidence": "MEDIUM",
    "suggestion": { "customerId": "...", "customerName": "Direct Freight Express" }
  }
  ```
- No third-party fuzzy-match library — implement a simple Levenshtein distance function in C# (the string lengths involved are short)

### Technical context
- The scoring rules run after the initial regex parse, as a second pass in the parse endpoint (not in `PdfParserService` itself — that layer is pure text extraction)
- A new `PdfScoringService` (or static method on the endpoint) takes the `ParsedPdfResult` and the `NeeDbContext`, runs the DB lookups and adjustments, and returns a scored result
- Levenshtein: implement as a static helper method — the DP table approach is ~20 lines of C#

### Done definition
- Parse a PDF with "Direct Freigt Expres" (typo) as the customer name → `customerName.confidence` = `MEDIUM`, `suggestion` shows the correct customer
- Parse a PDF with a valid template code like "TP42N" → `templateCode.confidence` = `MEDIUM` (upgraded from LOW because it matches a DB template)
- Parse a PDF with a past required date → `requiredDate.confidence` = `LOW`

### Claude Code prompt
```
Add confidence scoring with DB validation:

1. api/Services/PdfScoringService.cs:
   public class PdfScoringService(NeeDbContext db) {
     public async Task<ScoredPdfResult> ScoreAsync(ParsedPdfResult raw, CancellationToken ct) {
       var scored = new Dictionary<string, ScoredField>();
       // rego: validate uppercase alphanumeric pattern
       // requiredDate: parse and validate future date range
       // templateCode: check against active templates in DB, upgrade LOW→MEDIUM if match found
       // customerName: fuzzy match against customers table using Levenshtein
       return new ScoredPdfResult(scored);
     }

     private static int Levenshtein(string a, string b) { /* standard DP implementation */ }
   }

   record ScoredField(string? Value, string Confidence, object? Suggestion = null);
   record ScoredPdfResult(Dictionary<string, ScoredField> Fields);

2. Register PdfScoringService as scoped in Program.cs.

3. Update the /parse endpoint to call scoringService.ScoreAsync(parsedResult, ct) before returning.

4. Update PdfParseResponse to use ScoredField[] (includes optional Suggestion).

5. Unit tests:
   - Customer with Levenshtein distance 2 from a seeded customer → MEDIUM confidence, suggestion populated
   - Known template code → MEDIUM confidence
   - Past required date → LOW confidence
   - Exact customer name match → confidence stays HIGH

Schema: customers, job_code_templates.
```

---

## Story E9-S4 — PDF review pane UI component (M, 4h)

**As sales**
**I want** to see a side-by-side view of the uploaded PDF and the extracted fields
**So that** I can review, correct, and confirm the pre-filled data before creating the RO

### Acceptance criteria
- A new route `/sales/pdf-review/{uploadId}` shows a two-panel layout:
  - Left panel: an `<iframe>` or `<embed>` rendering the uploaded PDF from `/uploads/pdf-uploads/{filename}`
  - Right panel: the New RO form pre-filled with the extracted values from the parse result
- Each field that was extracted has a confidence badge next to its label:
  - `HIGH` → green tick ✓ (no badge, just the value)
  - `MEDIUM` → amber ⚠ badge "Review"
  - `LOW` → red badge "Needs review" and the field is highlighted with amber border
  - `NONE` → empty field, red border, label says "Not found"
- Suggestions (from E9-S3) show as a click-to-accept hint below the field: `"Did you mean: Direct Freight Express? [Accept]"`
- The form is the same `NewRoComponent` reactive form from E2-S4, pre-populated via `setValue()` — no duplication of the form definition
- A "Confirm & Create RO" button at the bottom submits the form and navigates to `/sales/ros/{id}?created=1` (same as E2 flow)
- Uploading the PDF and triggering the parse both happen automatically when the route is navigated to (no manual "Parse" button)

### Technical context
- Navigation to `/sales/pdf-review/{uploadId}` happens after a successful `POST /api/sales/pdf-upload` response
- The review component calls `POST /api/sales/pdf-upload/{uploadId}/parse` on init
- The `<iframe>` src: `/uploads/pdf-uploads/{fileName}` — served by the existing static file middleware
- Pre-populating the reactive form: `this.form.patchValue({ rego: fields.rego.value, ... })`
- Confidence badge is a simple CSS class toggled on the `<label>` element

### Done definition
- Upload a PDF → browser navigates to `/sales/pdf-review/{uploadId}` automatically
- PDF renders in the left panel iframe
- Form on the right is pre-filled with extracted values
- Fields with MEDIUM confidence show the amber ⚠ badge
- Accepting a suggestion populates the customer dropdown
- "Confirm & Create RO" creates the RO and navigates to the detail page

### Claude Code prompt
```
Create the PDF review page:

1. Route: /sales/pdf-review/:uploadId  (add to app.routes.ts, protected by authGuard + roleGuard SALES)
   Component: PdfReviewComponent (web/src/app/sales/pdf-review.component.ts)

2. PdfReviewComponent:
   - On init: call POST /api/sales/pdf-upload/{uploadId}/parse (loading state while parsing)
   - Store scored = signal<ScoredPdfResult | null>(null)
   - Extract the PDF URL: call GET /api/sales/pdf-upload/{uploadId} to get the blob path
     (add GET /api/sales/pdf-upload/{id} endpoint returning { uploadId, blobPath, fileName })
   - Once scored: patchValue() on the NewRo form with HIGH + MEDIUM values

3. Template layout:
   <div class="pdf-review-layout">
     <div class="pdf-panel">
       <iframe [src]="pdfUrl()" class="pdf-frame"></iframe>
     </div>
     <div class="form-panel">
       <!-- Re-use NewRoComponent OR inline the form fields here -->
       <!-- Each field gets a confidence badge wrapper -->
       <div class="field-with-confidence">
         <label>Rego <span class="conf-badge" [class]="confClass('rego')">{{ confLabel('rego') }}</span></label>
         <input formControlName="rego" [class.needs-review]="isLowConf('rego')" />
         @if (hasSuggestion('rego')) {
           <span class="suggestion">Did you mean {{ suggestion('rego') }}? <a (click)="accept('rego')">Accept</a></span>
         }
       </div>
       ... (repeat for all fields)
       <button class="btn btn-complete" (click)="submit()">Confirm & Create RO</button>
     </div>
   </div>

4. Styles:
   .pdf-review-layout (display grid, grid-template-columns 1fr 1fr, gap 0, height calc(100vh - 60px))
   .pdf-panel (border-right 0.5px solid var(--rule), overflow hidden)
   .pdf-frame (width 100%, height 100%, border none)
   .form-panel (overflow-y auto, padding 20px 24px)
   .field-with-confidence (margin-bottom 16px)
   .conf-badge (font-family var(--mono), font-size 10px, padding 2px 6px, border-radius 3px, margin-left 6px)
   .conf-medium (background #fef9c3, color var(--warn))
   .conf-low (background #fee2e2, color var(--bad))
   .needs-review (border-color var(--warn) !important)
   .suggestion (font-size 12px, color var(--ink-3), margin-top 4px, display block)
   .suggestion a (color var(--accent), cursor pointer, text-decoration underline)

5. Update E9-S1 upload response handler in the upload trigger (add an upload button on /sales/new-ro or a dedicated upload page):
   After successful upload: this.router.navigate(['/sales/pdf-review', result.uploadId])
```

---

## Story E9-S5 — Confirm flow integrating with materialisation (S, 4h)

**As sales**
**I want** the "Confirm & Create RO" button to create the RO exactly as if I had filled the form manually
**So that** the PDF upload path produces the same result as the manual entry path

### Acceptance criteria
- "Confirm & Create RO" in the PDF review form calls the same `POST /api/repair-orders` endpoint as E2's manual form
- The review form's reactive form is the same Angular `FormGroup` instance used in E2-S4 — no duplicate form logic
- If the form has any invalid fields (NONE confidence fields left empty, or validation errors) the button stays disabled and shows inline errors — same behaviour as the manual form
- On success: navigate to `/sales/ros/{id}?created=1` and show the success toast (same as E2-S6)
- The `attachments` row for the source PDF is linked to the newly created RO: update `entity_id = roId` and `entity_type = 'RepairOrder'` after the RO is created
- `GET /api/repair-orders/{id}` (the E2 endpoint) is extended to return a `sourcePdfUrl` field if an attachment of `category='SOURCE_PDF'` exists for the RO

### Technical context
- `POST /api/repair-orders` already handles the full materialisation — the Angular form just needs to be valid and submitted
- The attachment linking: after the `POST /api/repair-orders` succeeds, call a new `PATCH /api/sales/pdf-upload/{uploadId}/link` endpoint with `{ roId }` that updates the attachment row
- Add `PATCH /api/sales/pdf-upload/{uploadId}/link` endpoint in `SalesPdfEndpoints.cs`

### Done definition
- Full end-to-end: upload PDF → review form pre-filled → fix any NONE-confidence fields → click "Confirm & Create RO" → land on RO detail with success toast → the detail page shows a "Source PDF" link
- `GET /api/repair-orders/{id}` returns `"sourcePdfUrl": "/uploads/pdf-uploads/..."` for the RO
- If the upload attachment is already linked to a different RO, the PATCH returns 409

### Claude Code prompt
```
Wire the PDF review form to the existing RO creation flow:

1. PdfReviewComponent — submit():
   - Validate form (same as NewRoComponent)
   - If invalid: mark all controls as touched, show inline errors
   - If valid: POST /api/repair-orders (same payload as E2 form)
   - On success: PATCH /api/sales/pdf-upload/{uploadId}/link with { roId }
   - Navigate to /sales/ros/{roId}?created=1

2. New endpoint PATCH /api/sales/pdf-upload/{uploadId}/link
   Body: { RoId: Guid }
   - Load attachment, validate entity_type='PdfUpload', category='SOURCE_PDF'
   - If entity_id already set and != RoId: return 409 Conflict
   - UPDATE attachment: entity_type='RepairOrder', entity_id=RoId
   - Return 200
   [Authorize]

3. Update GET /api/repair-orders/{id} (RepairOrderEndpoints.cs):
   - Left-join attachments WHERE entity_type='RepairOrder' AND entity_id=roId AND category='SOURCE_PDF'
   - Include SourcePdfUrl: "/uploads/" + attachment.BlobPath (or null if no attachment)
   - Add to RoDetailResponse: SourcePdfUrl (string?)

4. Update RoDetailComponent (Angular):
   - If sourcePdfUrl is set, show a "Source PDF" link in the header area:
     <a [href]="ro.sourcePdfUrl" target="_blank" class="pdf-link">View source PDF ↗</a>
   .pdf-link (font-family var(--mono), font-size 11px, color var(--accent))

5. Integration test:
   - Upload PDF, parse, create RO via confirm → verify attachment.entity_type='RepairOrder', entity_id=roId
   - GET /api/repair-orders/{id} returns sourcePdfUrl
   - PATCH link twice with different roId → 409

Schema: attachments (entity_type, entity_id, category, blob_path).
```
