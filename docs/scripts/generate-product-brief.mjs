import fs from "fs";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak
} from "docx";

// Brand colors
const ACCENT = "1A56DB";    // deep blue
const ACCENT_LIGHT = "E8F0FE"; // light blue bg
const DARK = "111827";      // near-black body text
const GRAY = "6B7280";      // secondary text
const GREEN = "059669";     // [Live] badge
const AMBER = "D97706";     // [Planned] badge
const BORDER = "E5E7EB";    // light border

const tableBorder = { style: BorderStyle.SINGLE, size: 1, color: BORDER };
const cellBorders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder };
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

// Helpers
function spacer(pts = 120) {
  return new Paragraph({ spacing: { before: pts, after: 0 }, children: [] });
}

function bodyText(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 160, line: 300 },
    ...opts.paragraphOpts,
    children: [new TextRun({ text, size: 22, font: "Georgia", color: DARK, ...opts.runOpts })]
  });
}

function bodyRuns(runs, opts = {}) {
  return new Paragraph({
    spacing: { after: 160, line: 300 },
    ...opts,
    children: runs
  });
}

function sectionHeading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 200 },
    children: [new TextRun({ text, size: 36, bold: true, font: "Arial", color: ACCENT })]
  });
}

function subHeading(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text, size: 28, bold: true, font: "Arial", color: DARK })]
  });
}

function accentDivider() {
  return new Table({
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders: { top: noBorder, bottom: { style: BorderStyle.SINGLE, size: 3, color: ACCENT }, left: noBorder, right: noBorder },
        width: { size: 9360, type: WidthType.DXA },
        children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [] })]
      })]
    })]
  });
}

// Feature list item with [Live] or [Planned] badge
function featureItem(status, text, listRef) {
  const isLive = status === "Live";
  return new Paragraph({
    numbering: { reference: listRef, level: 0 },
    spacing: { after: 80, line: 276 },
    children: [
      new TextRun({ text: `[${status}]`, bold: true, size: 20, font: "Arial", color: isLive ? GREEN : AMBER }),
      new TextRun({ text: `  ${text}`, size: 21, font: "Georgia", color: DARK })
    ]
  });
}

// Build the document
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Georgia", size: 22, color: DARK } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal",
        run: { size: 56, bold: true, color: ACCENT, font: "Arial" },
        paragraph: { spacing: { before: 0, after: 80 }, alignment: AlignmentType.LEFT } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, color: ACCENT, font: "Arial" },
        paragraph: { spacing: { before: 480, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, color: DARK, font: "Arial" },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, color: GRAY, font: "Arial" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 } }
    ]
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "feat-1", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "feat-2", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "feat-3", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "feat-4", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "feat-5", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "feat-6", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "feat-7", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "feat-8", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "feat-9", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }
    ]
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          pageNumbers: { start: 1 }
        }
      },
      headers: {
        default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "CONFIDENTIAL", size: 16, font: "Arial", color: GRAY, italics: true })] })] })
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [
          new TextRun({ text: "Hedgehox  |  ", size: 16, font: "Arial", color: GRAY }),
          new TextRun({ text: "Page ", size: 16, font: "Arial", color: GRAY }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial", color: GRAY }),
          new TextRun({ text: " of ", size: 16, font: "Arial", color: GRAY }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: "Arial", color: GRAY })
        ] })] })
      },
      children: [
        // ===== COVER PAGE =====
        spacer(2400),
        new Table({
          columnWidths: [9360],
          rows: [new TableRow({
            children: [new TableCell({
              borders: noBorders,
              width: { size: 9360, type: WidthType.DXA },
              shading: { fill: ACCENT, type: ShadingType.CLEAR },
              children: [new Paragraph({ spacing: { before: 40, after: 40 }, children: [] })]
            })]
          })]
        }),
        spacer(400),
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: "Claims Detector", size: 64, bold: true, font: "Arial", color: DARK })]
        }),
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: "AI-powered MLR pre-screening platform", size: 32, font: "Arial", color: ACCENT })]
        }),
        spacer(200),
        accentDivider(),
        spacer(200),
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: "Product feature brief", size: 24, font: "Georgia", color: GRAY })]
        }),
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: "February 2026", size: 24, font: "Georgia", color: GRAY })]
        }),
        spacer(1800),
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: "Prepared by Hedgehox", size: 20, font: "Arial", color: GRAY })]
        }),

        // ===== THE PROBLEM =====
        new Paragraph({ children: [new PageBreak()] }),

        sectionHeading("The problem"),

        bodyText("Before pharma promo materials can go to market, MLR reviewers read every slide, check each claim against approved source documents, and flag anything unsupported. This takes hours per deck. Miss a claim and the client risks an FDA warning letter. Over-flag and you've burned a reviewer's afternoon on nothing."),

        bodyText("Claims Detector runs AI over the document, pulls out the claims, and matches them to the brand's approved references. Reviewers get a prioritized list instead of a blank document. They still make the call. They just don't start from zero."),

        subHeading("Why it matters"),

        bodyText("Reviewers miss things when they're tired. AI doesn't get tired. It reads text, charts, tables, footnote markers, speaker notes. Multiple models cross-check each other's work. In testing, what used to take hours of manual reading takes minutes, and we measure accuracy against annotated answer keys from the review team so the numbers are real."),

        // ===== WHAT THE PROTOTYPE DOES =====
        new Paragraph({ children: [new PageBreak()] }),

        sectionHeading("What the prototype already does"),

        bodyText("The prototype is live. This is what it does right now."),

        subHeading("Upload and scan"),
        bodyText("Upload a PDF (promo deck, leave-behind, whatever goes through MLR). The AI reads it and returns a list of detected claims, each with a confidence score and its location in the document."),

        subHeading("Visual detection"),
        bodyText("The AI doesn't just read text. It scans charts, graphs, tables, and data visualizations. A bar chart showing \"47% reduction in symptoms\" is a claim, and the system catches it. It also flags annotation markers (daggers, asterisks, double daggers) that link to footnotes, since those often contain regulatory language."),

        subHeading("Brand reference library"),
        bodyText("Each brand gets its own reference library: package inserts, clinical trial data, supporting materials. Upload them once, and the system uses them as the source of truth when matching claims. The AI pre-indexes every reference document, extracting structured facts across eight categories (efficacy, safety, dosage, mechanism, population, endpoints, statistical findings, regulatory status)."),

        subHeading("Claim-to-reference matching"),
        bodyText("When a claim is detected, the system searches the brand's reference library for supporting evidence. It uses a three-tier pipeline: instant fact lookup (no AI cost), keyword search to narrow candidates, then AI confirmation with hybrid scoring that weighs semantic similarity, keyword overlap, and numeric precision. Each matched claim shows the source document, the relevant passage, and the page number. Reviewers can click through to the original PDF, which shows highlighted supporting text for the claim it's supporting."),

        subHeading("Reviewer feedback loop"),
        bodyText("Every approve, reject, and missed-claim report becomes a training label. On the next run, the AI sees what reviewers confirmed, what it got wrong, and what it missed entirely. These labels are scoped three ways: same document (highest priority), same brand, and cross-brand (so a pattern caught on one brand informs detection on another). No model retraining required. The AI gets smarter through better instructions, not new weights."),

        subHeading("Interactive document viewer"),
        bodyText("The PDF viewer shows claim locations as pins on the actual document pages. Reviewers can zoom, pan, and click any pin to jump to that claim's details."),

        // ===== THE FULL APPLICATION =====
        new Paragraph({ children: [new PageBreak()] }),

        sectionHeading("The full application"),

        bodyRuns([
          new TextRun({ text: "Everything below ships in the final product. Features marked ", size: 22, font: "Georgia", color: DARK }),
          new TextRun({ text: "[Live]", bold: true, size: 22, font: "Arial", color: GREEN }),
          new TextRun({ text: " are working in the current prototype. Features marked ", size: 22, font: "Georgia", color: DARK }),
          new TextRun({ text: "[Planned]", bold: true, size: 22, font: "Arial", color: AMBER }),
          new TextRun({ text: " will be built during the development engagement.", size: 22, font: "Georgia", color: DARK })
        ]),

        // --- 1. Document intake ---
        subHeading("1. Document intake"),
        featureItem("Live", "PDF upload with drag-and-drop", "feat-1"),
        featureItem("Live", "Multi-page document support with page-by-page rendering", "feat-1"),
        featureItem("Planned", "Batch upload (queue multiple documents for sequential processing)", "feat-1"),
        featureItem("Planned", "Microsoft PowerPoint (.pptx) native support (no PDF conversion needed)", "feat-1"),
        featureItem("Planned", "Word document (.docx) support for narrative promo materials", "feat-1"),
        featureItem("Planned", "Email/HTML promo material support", "feat-1"),
        featureItem("Planned", "Automatic document type identification", "feat-1"),

        // --- 2. AI claim detection ---
        subHeading("2. AI claim detection"),
        featureItem("Live", "Full-text claim detection with confidence scoring (0-100%)", "feat-2"),
        featureItem("Live", "Visual claim detection in charts, graphs, tables, and data visualizations", "feat-2"),
        featureItem("Live", "Annotation marker detection (daggers, asterisks, superscripts linking to footnotes)", "feat-2"),
        featureItem("Live", "Speaker notes and slide region awareness (deduplication built in)", "feat-2"),
        featureItem("Live", "Document type selection", "feat-2"),
        featureItem("Live", "Customizable detection prompts (reviewers can adjust what the AI looks for)", "feat-2"),
        featureItem("Planned", "Claim categorization by type (efficacy, safety, comparative, statistical, regulatory)", "feat-2"),
        featureItem("Planned", "Historical claim tracking (has this exact claim appeared in previous submissions)", "feat-2"),

        // --- 3. Reference library management ---
        subHeading("3. Reference library management"),
        featureItem("Live", "Brand-scoped reference libraries (each product gets its own set of approved sources)", "feat-3"),
        featureItem("Live", "PDF upload with text extraction", "feat-3"),
        featureItem("Live", "Folder organization with bulk move/archive/delete", "feat-3"),
        featureItem("Live", "Soft delete with trash/restore (nothing is permanently lost by accident)", "feat-3"),
        featureItem("Live", "AI-powered fact indexing across eight categories per reference", "feat-3"),
        featureItem("Live", "Semantic embeddings for intelligent passage search", "feat-3"),
        featureItem("Live", "Editable display names for uploaded references", "feat-3"),
        featureItem("Planned", "Version control for references (track when a PI is updated, flag claims against outdated versions)", "feat-3"),
        featureItem("Planned", "Expiration dates on references (auto-flag when supporting docs are past their review date)", "feat-3"),
        featureItem("Planned", "Reference sharing across brands (for shared class-level data)", "feat-3"),

        // --- 4. Claim-to-reference matching ---
        subHeading("4. Claim-to-reference matching"),
        featureItem("Live", "Three-tier matching pipeline (fact lookup, keyword pre-filter, AI confirmation)", "feat-4"),
        featureItem("Live", "Hybrid scoring: semantic similarity, keyword overlap, numeric precision", "feat-4"),
        featureItem("Live", "Diversity selection (returns varied supporting evidence, not just the top-scoring single match)", "feat-4"),
        featureItem("Live", "Click-through to source document with page number and highlighted passage", "feat-4"),
        featureItem("Live", "Match confidence tiers (high-confidence, auto-confirmed, direct, keyword fallback)", "feat-4"),
        featureItem("Live", "Add missed claims through pinpoint feature", "feat-4"),
        featureItem("Planned", "Bulk re-matching when new references are added to a library", "feat-4"),
        featureItem("Planned", "Match explanation (plain-English summary of why a reference was selected)", "feat-4"),
        featureItem("Planned", "Negative matching (flag claims where no supporting reference exists in the library)", "feat-4"),
        featureItem("Planned", "Highlight text directly in the application when adding a missed claim and its supporting reference PDF", "feat-4"),

        // --- 5. Review workflow ---
        subHeading("5. Review workflow"),
        featureItem("Live", "Approve/reject controls on each claim with structured rejection reasons", "feat-5"),
        featureItem("Live", "Claim filtering by status, type, confidence level, and free-text search", "feat-5"),
        featureItem("Live", "Sorting by confidence (high-to-low, low-to-high)", "feat-5"),
        featureItem("Live", "Missed claim reporting (reviewers flag claims the AI didn't catch)", "feat-5"),
        featureItem("Live", "Training data export (approved/rejected claims exportable as structured data)", "feat-5"),
        featureItem("Planned", "Reviewer assignment (assign documents to specific team members)", "feat-5"),
        featureItem("Planned", "Review status dashboard (progress across all pending documents)", "feat-5"),
        featureItem("Planned", "Comment threads on individual claims (reviewer-to-reviewer discussion)", "feat-5"),
        featureItem("Planned", "Review completion sign-off (formal \"this document has been pre-screened\" stamp)", "feat-5"),

        // --- 6. Analytics and reporting ---
        subHeading("6. Analytics and reporting"),
        featureItem("Planned", "Detection accuracy dashboards (precision/recall tracked over time)", "feat-6"),
        featureItem("Planned", "Reviewer productivity metrics (documents reviewed, time per document, claims per document)", "feat-6"),
        featureItem("Planned", "Monthly/quarterly reporting exports", "feat-6"),
        featureItem("Planned", "Trend analysis (are certain claim types increasing across submissions)", "feat-6"),

        // --- 7. Administration ---
        subHeading("7. Administration"),
        featureItem("Planned", "User authentication and role-based access (admin, reviewer, viewer)", "feat-7"),
        featureItem("Planned", "SSO integration (SAML/OAuth for enterprise environments)", "feat-7"),
        featureItem("Planned", "Audit trail (who reviewed what, when, and what they decided)", "feat-7"),
        featureItem("Planned", "Brand/team permissions (control who can access which brand libraries)", "feat-7"),
        featureItem("Planned", "Custom branding (client logo, color scheme)", "feat-7"),

        // --- 8. Exportables ---
        subHeading("8. Exportables"),
        featureItem("Planned", "Export document with annotations directly on PDF for submission", "feat-8"),

        // --- 9. Infrastructure ---
        subHeading("9. Infrastructure"),
        featureItem("Live", "Cloud-hosted (currently Vercel, portable to any cloud provider)", "feat-9"),
        featureItem("Live", "Automatic database migrations", "feat-9"),
        featureItem("Planned", "Production database migration (PostgreSQL for multi-user concurrency)", "feat-9"),
        featureItem("Planned", "File storage migration (S3-compatible object storage for reference documents)", "feat-9"),
        featureItem("Planned", "Automated backups and disaster recovery", "feat-9"),
        featureItem("Planned", "HIPAA-compliant hosting option", "feat-9"),

        // ===== WHAT HAPPENS NEXT =====
        new Paragraph({ children: [new PageBreak()] }),

        sectionHeading("What happens next"),

        bodyText("The prototype proves the core pipeline works: upload a document, detect claims, match them to references, let reviewers verify. The full product build takes that foundation and adds the infrastructure, access controls, and workflow features needed for production use across a team."),

        spacer(200),

        // Closing callout box
        new Table({
          columnWidths: [9360],
          rows: [new TableRow({
            children: [new TableCell({
              borders: { top: { style: BorderStyle.SINGLE, size: 2, color: ACCENT }, bottom: { style: BorderStyle.SINGLE, size: 2, color: ACCENT }, left: { style: BorderStyle.SINGLE, size: 6, color: ACCENT }, right: { style: BorderStyle.SINGLE, size: 2, color: ACCENT } },
              width: { size: 9360, type: WidthType.DXA },
              shading: { fill: ACCENT_LIGHT, type: ShadingType.CLEAR },
              margins: { top: 200, bottom: 200, left: 300, right: 300 },
              children: [
                new Paragraph({
                  spacing: { after: 80 },
                  children: [new TextRun({ text: "Hedgehox builds it. You own it.", size: 26, bold: true, font: "Arial", color: ACCENT })]
                }),
                new Paragraph({
                  children: [new TextRun({ text: "When you need updates, we're a phone call away.", size: 22, font: "Georgia", color: DARK })]
                })
              ]
            })]
          })]
        }),

        spacer(600),

        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: "hedgehox.com", size: 20, font: "Arial", color: ACCENT })]
        })
      ]
    }
  ]
});

const outPath = "/Users/wallymo/claims_detector/docs/Claims_Detector_Product_Brief.docx";
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log(`Written to ${outPath}`);
