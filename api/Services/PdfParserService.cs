using System.Text;
using System.Text.RegularExpressions;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas.Parser;
using iText.Kernel.Pdf.Canvas.Parser.Listener;

namespace Nee.Api.Services;

public record ParsedField(string? Value, string Confidence);
public record ParsedPdfResult(Dictionary<string, ParsedField> Fields, string RawText);

// The PDF renderer (LocationTextExtractionStrategy) places all form-row labels on ONE line,
// then the corresponding values on the NEXT line(s):
//   "Rego Number: Vehicle ID Number: Paint: Tax Exempt Number:"
//   "STK32233 LZZ8EXXC7SC707465 WHITE"
//
// Every regex therefore uses LABEL[^\r\n]*\r?\n\s* to skip the rest of the label line
// before capturing the value token(s) on the next line.

public class PdfParserService
{
    // ── Rego ────────────────────────────────────────────────────────────────
    // Row: "Rego Number: Vehicle ID Number: Paint: …"
    // Values: "STK32233 LZZ8EXXC7SC707465 WHITE"  ← rego is first token
    private static readonly Regex RegoRegex = new(
        @"Rego\s+Number\s*:[^\r\n]*\r?\n\s*(?<value>[A-Z][A-Z0-9\-]{1,9})",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── VIN ─────────────────────────────────────────────────────────────────
    // Self-identifying: exactly 17 chars from VIN charset (no I, O, Q)
    private static readonly Regex VinRegex = new(
        @"\b(?<value>[A-HJ-NPR-Z0-9]{17})\b",
        RegexOptions.Compiled);

    // ── Paint ───────────────────────────────────────────────────────────────
    // Same value line as rego/VIN — 3rd token after the 17-char VIN
    private static readonly Regex PaintRegex = new(
        @"Paint\s*:[^\r\n]*\r?\n\s*\S+\s+[A-HJ-NPR-Z0-9]{17}\s+(?<value>[A-Z][A-Z\s]{0,30}?)(?:\s{2,}|\r|\n|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Customer name (Bill To) ─────────────────────────────────────────────
    // Row: "Customer No.: Bill To Name & Address: Build Date: Odometer: Repair Order #"
    // Next line (1st value line): "NORTH EAST ISUZU"  ← company name only
    private static readonly Regex CustomerRegex = new(
        @"Bill\s+To\s+Name[^\r\n]*\r?\n\s*(?<value>[^\r\n]+)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Customer No ─────────────────────────────────────────────────────────
    // 2nd value line: "649 58053"  or  "649 04/06/2025 58734"  ← cust no is first
    private static readonly Regex CustomerNoRegex = new(
        @"Customer\s+No\.[^\r\n]*\r?\n[^\r\n]+\r?\n\s*(?<value>\d{1,6})\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Source RO number ────────────────────────────────────────────────────
    // Same 2nd value line — RO# is the LAST number: "649 58053" or "649 04/06/2025 58734"
    private static readonly Regex SourceRoNumberRegex = new(
        @"Repair\s+Order\s*#[^\r\n]*\r?\n[^\r\n]+\r?\n\s*\d+\s+(?:\d{2}\/\d{2}\/\d{4}\s+)?(?<value>\d{4,8})\s*(?:\r|\n|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Source RO date ───────────────────────────────────────────────────────
    // Row: "Customer ABN: Model: Make: Repair Order Date:"
    // Values: "... SITRAK 20/04/2026"  ← date is last token
    private static readonly Regex SourceRoDateRegex = new(
        @"Repair\s+Order\s+Date\s*:[^\r\n]*\r?\n[^\r\n]*(?<value>\d{2}\/\d{2}\/\d{4})\s*(?:\r|\n|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Build date ───────────────────────────────────────────────────────────
    // Same 2nd value line as customer no: "649 04/06/2025 58734" — date in middle (when present)
    private static readonly Regex BuildDateRegex = new(
        @"Build\s+Date\s*:[^\r\n]*\r?\n[^\r\n]+\r?\n\s*\d+\s+(?<value>\d{2}\/\d{2}\/\d{4})\s+\d{4,8}",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Customer ABN ─────────────────────────────────────────────────────────
    // Self-identifying: 11 contiguous digits after the ABN label anywhere in text
    private static readonly Regex CustomerAbnRegex = new(
        @"Customer\s+ABN\s*:[^\r\n]*\r?\n[^\r\n]*?(?<value>\d{11})",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Make ─────────────────────────────────────────────────────────────────
    // Row: "Customer ABN: Model: Make: Repair Order Date:"
    // Values: "BURTON SA 5110 SITRAK G7S 540HP ... SITRAK 20/04/2026"
    // Make appears as the LAST word before the date (duplicated by the PDF renderer)
    // We find "Make:" on the label line and grab the word immediately before the trailing date
    private static readonly Regex MakeRegex = new(
        @"Make\s*:[^\r\n]*\r?\n[^\r\n]*?(?<value>[A-Z][A-Z\s]*?)\s+\d{2}\/\d{2}\/\d{4}\s*(?:\r|\n|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Simpler fallback: "Make: ISUZU" style (same-line, for older/different PDF renderers)
    private static readonly Regex MakeFallbackRegex = new(
        @"\bMake\s*[:\-]\s*(?<value>[A-Z][A-Z\s&]{1,30}?)(?=\s{2,}|\t|\r|\n|Model\s*[:\-]|Paint\s*[:\-]|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Model ────────────────────────────────────────────────────────────────
    // Row: "Customer ABN: Model: Make: Repair Order Date:"
    // Value row: "[ABN] [CITY STATE POSTCODE] [MODEL WORDS] [MAKE] [DD/MM/YYYY]"
    // Primary: skip address block (ends at 4-digit AU postcode), capture before make+date.
    // The make word (all-letters or alphanumeric) repeats immediately before the date.
    private static readonly Regex ModelRegex = new(
        @"Make\s*:[^\r\n]*\r?\n[^\r\n]*\d{4}\s+(?<value>[^\r\n]{3,50}?)\s+[A-Z][A-Z0-9]*\s+\d{2}\/\d{2}\/\d{4}",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Fallback: same-line "Model: value" — colon excluded from value to prevent
    // matching the label row itself (which reads "Model: Make: Repair Order Date:")
    private static readonly Regex ModelFallbackRegex = new(
        @"\bModel\s*[:\-]\s*(?<value>[^\r\n:\t]{3,60}?)(?=\s{2,}|\t|\r|\n|Make\s*[:\-]|Paint\s*[:\-]|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Owner name ───────────────────────────────────────────────────────────
    // Row: "Owner Name & Address:" appears; next line starts with owner name (up to comma)
    private static readonly Regex OwnerNameRegex = new(
        @"Owner\s+Name[^\r\n]+\r?\n\s*(?<value>[^,\r\n]+)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── C/Order No ───────────────────────────────────────────────────────────
    // Row: "C/Order No: Engine Number: Delivery Date: Ext Warr Exp Date:"
    // Values: "419512 - 430285 BURTON SOUTH AUSTRALIA 5110 28/02/2026"
    // Pattern: digits optionally joined by " - " (no letters — engine no has letters)
    private static readonly Regex CustomerOrderNoRegex = new(
        @"C\s*/\s*Order\s+No[^\r\n]*\r?\n\s*(?<value>\d+(?:\s*-\s*\d+)*)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Engine number ────────────────────────────────────────────────────────
    // Same value line as C/Order No — after the C/Order and address residue, engine no
    // appears as an alphanumeric token before the delivery date
    // Fallback: look for engine no as a standalone token "427085" or "4HK1 1CL044"
    private static readonly Regex EngineRegex = new(
        @"Engine\s+Number\s*:[^\r\n]*\r?\n[^\r\n]*?(?<!\d)(?<value>[A-Z0-9]{3,4}[A-Z0-9\s]{1,12}?)(?=\s+\d{2}\/|\s*(?:\r|\n))",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Delivery date ─────────────────────────────────────────────────────────
    // Same value line as C/Order No — last date on that line
    private static readonly Regex DeliveryDateRegex = new(
        @"Delivery\s+Date\s*:[^\r\n]*\r?\n[^\r\n]*?(?<value>\d{2}\/\d{2}\/\d{4})\s*(?:\r|\n|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Chassis number ───────────────────────────────────────────────────────
    // Row: "Stock No: Chassis Number: Key Tag No: Page:"
    // Value line (order): [address_spillover] [stock_no] [chassis] [keytag] [N of N]
    // Right-anchor: chassis is the token immediately before key tag, which is before "N of N".
    // [^\r\n]* greedy maximises the skip so we match the rightmost valid [chassis][keytag][page].
    private static readonly Regex ChassisRegex = new(
        @"Chassis\s+Number\s*:[^\r\n]*\r?\n[^\r\n]*\s+(?<value>[A-Z0-9][A-Z0-9\-]{4,19})\s+[A-Z0-9]{1,12}\s+\d+\s+of\s+\d+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Key Tag No ───────────────────────────────────────────────────────────
    // Key tag is always the last alphanumeric token before the "N of N" page indicator.
    // Anchor from the right so address/stock/chassis ordering doesn't matter.
    private static readonly Regex KeyTagRegex = new(
        @"Key\s+Tag\s+No\s*:[^\r\n]*\r?\n[^\r\n]*\s+(?<value>[A-Z0-9]{1,10})\s+\d+\s+of\s+\d+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Odometer ──────────────────────────────────────────────────────────────
    // Value line same row as customer no — usually blank; only extract if digits present
    private static readonly Regex OdometerRegex = new(
        @"Odometer\s*:[^\r\n]*\r?\n[^\r\n]*?(?<!\d)(?<value>\d{4,7})(?!\d)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Driver mobile phone ──────────────────────────────────────────────────
    // Row: "Driver Mobile Phone: Home Phone: Business Phone: Expected Date/Time In:…"
    // Values: "0418838408 [home] 08 82809899 24/11/2025 00:00"  ← mobile is first
    private static readonly Regex ContactPhoneRegex = new(
        @"Driver\s+Mobile\s+Phone\s*:[^\r\n]*\r?\n\s*(?<value>0\d[\d\s]{7,12}?)(?=\s+(?:0|\+|\d{2}\s)|\s*(?:\r|\n))",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Business phone ───────────────────────────────────────────────────────
    // Same value line — business phone follows home phone (which may be blank)
    private static readonly Regex BusinessPhoneRegex = new(
        @"Business\s+Phone\s*:[^\r\n]*\r?\n\s*(?:0\d[\d\s]{7,12}\s+)?(?:0\d[\d\s]{7,12}\s+)?(?<value>(?:0|\d{2}\s)\d[\d\s]{6,12}?)(?=\s+\d{2}\/|\s*(?:\r|\n))",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Expected date/time in ────────────────────────────────────────────────
    // Same value line as phones — date is the 3rd/4th token
    private static readonly Regex ExpectedInDateRegex = new(
        @"Expected\s+Date(?:\/Time)?\s+In\s*:[^\r\n]*\r?\n\s*(?:\S+\s+){1,3}(?<value>\d{2}\/\d{2}\/\d{4})(?:\s+\d{2}:\d{2})?",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Email ────────────────────────────────────────────────────────────────
    // Row: "Email: Required Date/Time: Ext Warr Ref:"
    // Values: "jason@example.com 24/11/2025 17:00"  ← email is first token
    private static readonly Regex ContactEmailRegex = new(
        @"Email\s*:[^\r\n]*\r?\n\s*(?<value>[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Required date ────────────────────────────────────────────────────────
    // Same value line as email — date follows email
    private static readonly Regex RequiredDateRegex = new(
        @"Required\s+Date(?:\/Time)?\s*:[^\r\n]*\r?\n\s*\S+\s+(?<value>\d{2}\/\d{2}\/\d{4})(?:\s+\d{2}:\d{2})?",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // ── Template code (job table) ────────────────────────────────────────────
    // Job lines: "TP66F R MANUFACTURE…"  "TP66F-CNC R MATERIAL…"
    // Returns the first non-all-letter code that contains a digit or dash
    private static readonly Regex JobLineCodeRegex = new(
        @"^(?<code>[A-Z0-9][A-Z0-9\-]{1,19})\s+R\s",
        RegexOptions.Multiline | RegexOptions.Compiled);

    // ────────────────────────────────────────────────────────────────────────
    public ParsedPdfResult Parse(Stream pdfStream)
    {
        string text;
        try { text = ExtractText(pdfStream); }
        catch { text = string.Empty; }

        // Increase raw text window for debugging — show first 1000 chars
        var rawText = text.Length > 1000 ? text[..1000] : text;

        // Make must be extracted before model — model uses the make word as its right anchor.
        var make = ExtractMake(text);

        var fields = new Dictionary<string, ParsedField>
        {
            // Core
            ["rego"]            = NextLine(RegoRegex, text),
            ["customerName"]    = ExtractCustomerName(text),
            ["requiredDate"]    = ExtractDateNextLine(RequiredDateRegex, text),
            ["make"]            = make,
            ["model"]           = ExtractModel(text, make.Value),
            ["templateCode"]    = ExtractTemplateCode(text),
            ["priority"]        = new ParsedField(null, "NONE"),
            // Vehicle
            ["vin"]             = ExtractVin(text),
            ["paintColour"]     = NextLine(PaintRegex, text),
            ["chassisNumber"]   = NextLine(ChassisRegex, text),
            ["engineNumber"]    = NextLine(EngineRegex, text),
            ["buildDate"]       = ExtractDateNextLine(BuildDateRegex, text),
            ["keyTagNo"]        = NextLine(KeyTagRegex, text),
            ["odometer"]        = ExtractOdometer(text),
            // Source document
            ["sourceRoNumber"]  = NextLine(SourceRoNumberRegex, text),
            ["sourceRoDate"]    = ExtractDateNextLine(SourceRoDateRegex, text),
            ["customerNo"]      = NextLine(CustomerNoRegex, text),
            ["customerAbn"]     = ExtractAbn(text),
            ["ownerName"]       = NextLine(OwnerNameRegex, text),
            ["customerOrderNo"] = NextLine(CustomerOrderNoRegex, text),
            ["contactEmail"]    = NextLine(ContactEmailRegex, text),
            ["contactPhone"]    = NextLine(ContactPhoneRegex, text),
            ["businessPhone"]   = NextLine(BusinessPhoneRegex, text),
            ["expectedInDate"]  = ExtractDateNextLine(ExpectedInDateRegex, text),
            ["deliveryDate"]    = ExtractDateNextLine(DeliveryDateRegex, text),
        };

        return new ParsedPdfResult(fields, rawText);
    }

    private static string ExtractText(Stream pdfStream)
    {
        var sb = new StringBuilder();
        using var reader = new PdfReader(pdfStream);
        using var doc = new PdfDocument(reader);
        // Only parse first 2 pages — the header repeats on every page
        var pages = Math.Min(2, doc.GetNumberOfPages());
        for (var i = 1; i <= pages; i++)
        {
            var strategy = new LocationTextExtractionStrategy();
            sb.AppendLine(PdfTextExtractor.GetTextFromPage(doc.GetPage(i), strategy));
        }
        return sb.ToString();
    }

    // Core extractor: regex already encodes "skip label line, grab value on next line"
    private static ParsedField NextLine(Regex regex, string text)
    {
        var m = regex.Match(text);
        if (!m.Success) return new ParsedField(null, "NONE");
        var value = m.Groups["value"].Value.Trim();
        return string.IsNullOrWhiteSpace(value)
            ? new ParsedField(null, "NONE")
            : new ParsedField(value, "HIGH");
    }

    private static ParsedField ExtractDateNextLine(Regex regex, string text)
    {
        var m = regex.Match(text);
        if (!m.Success) return new ParsedField(null, "NONE");
        var raw = m.Groups["value"].Value.Trim();
        if (TryParseDate(raw, out var parsed))
            return new ParsedField(parsed.ToString("yyyy-MM-dd"), "MEDIUM");
        return string.IsNullOrWhiteSpace(raw) ? new ParsedField(null, "NONE") : new ParsedField(raw, "MEDIUM");
    }

    private static bool TryParseDate(string raw, out DateTime result)
    {
        var formats = new[]
        {
            "d/M/yyyy", "dd/MM/yyyy", "d/M/yy", "dd/MM/yy",
            "d-M-yyyy", "dd-MM-yyyy",
            "d MMM yyyy", "dd MMM yyyy",
            "d MMMM yyyy", "dd MMMM yyyy",
        };
        return DateTime.TryParseExact(raw, formats,
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None, out result);
    }

    private static ParsedField ExtractCustomerName(string text)
    {
        var m = CustomerRegex.Match(text);
        if (!m.Success) return new ParsedField(null, "NONE");
        // Trim trailing address fragments (comma-separated) — keep first segment only
        var raw = m.Groups["value"].Value.Trim();
        var name = raw.Split(',')[0].Trim();
        return string.IsNullOrWhiteSpace(name)
            ? new ParsedField(null, "NONE")
            : new ParsedField(name, "HIGH");
    }

    private static ParsedField ExtractVin(string text)
    {
        var m = VinRegex.Match(text);
        if (!m.Success) return new ParsedField(null, "NONE");
        return new ParsedField(m.Groups["value"].Value.ToUpper(), "HIGH");
    }

    private static ParsedField ExtractMake(string text)
    {
        // Primary: the PDF puts make as the last word(s) before the trailing RO date on the model/make row
        var m = MakeRegex.Match(text);
        if (m.Success)
        {
            var raw = m.Groups["value"].Value.Trim();
            // The make is the last word cluster — take only the last word if multiple
            var words = raw.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (words.Length > 0)
            {
                // If the renderer duplicates the make (e.g. "CAB & CHASSIS SITRAK"), take last unique word
                var make = words[^1];
                return new ParsedField(make, "HIGH");
            }
        }
        // Fallback: look for "Make: ISUZU" on same line (some PDF renderers)
        var fb = MakeFallbackRegex.Match(text);
        if (!fb.Success) return new ParsedField(null, "NONE");
        var val = fb.Groups["value"].Value.Split(' ')[0].Trim();
        return string.IsNullOrWhiteSpace(val) ? new ParsedField(null, "NONE") : new ParsedField(val, "HIGH");
    }

    private static ParsedField ExtractModel(string text, string? make)
    {
        // Primary: use the known make word as exact right anchor.
        // Pattern: skip address block (ends at 4-digit AU postcode), capture up to
        // "[make] [DD/MM/YYYY]" — this prevents any partial make leaking into the value.
        if (!string.IsNullOrWhiteSpace(make))
        {
            var escaped = Regex.Escape(make);
            var m = new Regex(
                $@"Make\s*:[^\r\n]*\r?\n[^\r\n]*\d{{4}}\s+(?<value>[^\r\n]{{3,50}}?)\s+{escaped}\s+\d{{2}}\/\d{{2}}\/\d{{4}}",
                RegexOptions.IgnoreCase).Match(text);
            if (m.Success)
            {
                var v = m.Groups["value"].Value.Trim();
                if (!string.IsNullOrWhiteSpace(v) && !v.Contains(':'))
                    return new ParsedField(v, "HIGH");
            }
        }
        // Static fallback: generic make placeholder — less precise but handles unknown makes.
        var pm = ModelRegex.Match(text);
        if (pm.Success)
        {
            var v = pm.Groups["value"].Value.Trim();
            if (!string.IsNullOrWhiteSpace(v) && !v.Contains(':'))
                return new ParsedField(v, "HIGH");
        }
        // Last resort: same-line match with colon guard.
        var fb = ModelFallbackRegex.Match(text);
        if (!fb.Success) return new ParsedField(null, "NONE");
        var value = fb.Groups["value"].Value.Trim();
        return string.IsNullOrWhiteSpace(value) || value.Contains(':')
            ? new ParsedField(null, "NONE")
            : new ParsedField(value, "HIGH");
    }

    private static ParsedField ExtractTemplateCode(string text)
    {
        // Job lines appear after the header section. Find "Code" column header then scan.
        var headerIdx = text.IndexOf("Code", StringComparison.OrdinalIgnoreCase);
        var searchText = headerIdx >= 0 ? text[headerIdx..] : text;

        foreach (Match m in JobLineCodeRegex.Matches(searchText))
        {
            var code = m.Groups["code"].Value;
            if (code.All(char.IsLetter)) continue; // skip SALESPERSON etc.
            // Prefer base template codes — skip 3-digit accessory prefixes like 003-, 004-
            if (Regex.IsMatch(code, @"^\d{3}-")) continue;
            // Skip sub-operation codes (base code + dash + suffix like -CNC, -FM)
            // A base code has at most ONE dash segment
            var dashCount = code.Count(c => c == '-');
            if (dashCount > 1) continue;
            return new ParsedField(code, "LOW");
        }

        return new ParsedField(null, "NONE");
    }

    private static ParsedField ExtractOdometer(string text)
    {
        var m = OdometerRegex.Match(text);
        if (!m.Success) return new ParsedField(null, "NONE");
        var raw = new string(m.Groups["value"].Value.Where(char.IsDigit).ToArray());
        return raw.Length >= 4 ? new ParsedField(raw, "HIGH") : new ParsedField(null, "NONE");
    }

    private static ParsedField ExtractAbn(string text)
    {
        var m = CustomerAbnRegex.Match(text);
        if (!m.Success) return new ParsedField(null, "NONE");
        var digits = new string(m.Groups["value"].Value.Where(char.IsDigit).ToArray());
        return digits.Length == 11 ? new ParsedField(digits, "HIGH") : new ParsedField(null, "NONE");
    }
}
