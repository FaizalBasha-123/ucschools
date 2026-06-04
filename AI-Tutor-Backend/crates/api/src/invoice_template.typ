// AI-Tutor Invoice Template — compiled by Typst embedded in the Rust backend.
// Data is injected via a virtual /invoice_data.json file served from InvoiceWorld.
// This replaces Lago's approach: Slim template → HTML → Gotenberg (headless Chromium).
// Typst compiles to PDF directly, in-process, in milliseconds.

#let d = json("invoice_data.json")

// ── Document setup ────────────────────────────────────────────────────────────
#set document(
  title: "Invoice " + d.invoice_number,
  author: "AI-Tutor Platform",
)
#set page(
  paper: "a4",
  margin: (top: 1.5cm, bottom: 2cm, left: 1.8cm, right: 1.8cm),
)
#set text(font: "New Computer Modern", size: 10pt, fill: rgb("#1a1a1a"))

// ── Helpers ───────────────────────────────────────────────────────────────────
#let currency_symbol = if d.currency == "USD" { "$" } else { "₹" }
#let fmt_amount(minor) = {
  let major = float(minor) / 100.0
  currency_symbol + str(calc.round(major, digits: 2))
}
#let status_color = if d.status == "paid" { rgb("#16a34a") } else { rgb("#dc2626") }

// ── Header ────────────────────────────────────────────────────────────────────
#block(width: 100%)[
  #grid(
    columns: (1fr, auto),
    gutter: 1em,
    [
      #text(weight: "bold", size: 22pt, fill: rgb("#000000"))[AI-Tutor]
      #v(2pt)
      #text(size: 8pt, fill: rgb("#6b7280"))[ai-tutor.com · Intelligent Learning Platform]
    ],
    [
      #align(right)[
        #text(size: 20pt, weight: "bold", fill: rgb("#111827"))[INVOICE]
        #v(4pt)
        #text(size: 8pt, fill: rgb("#6b7280"))[#d.invoice_number]
      ]
    ]
  )
]

#line(length: 100%, stroke: 0.5pt + rgb("#e5e7eb"))
#v(8pt)

// ── Billing parties ───────────────────────────────────────────────────────────
#grid(
  columns: (1fr, 1fr),
  gutter: 2em,
  [
    #text(size: 8pt, fill: rgb("#6b7280"), weight: "bold")[BILLED TO]
    #v(4pt)
    #text(weight: "semibold")[#d.customer_name]
    #v(2pt)
    #text(fill: rgb("#374151"))[#d.customer_email]
    #if d.keys().contains("customer_phone") and d.customer_phone != "" [
      #v(1pt)
      #text(fill: rgb("#374151"))[#d.customer_phone]
    ]
    #if d.keys().contains("customer_plan") and d.customer_plan != "" [
      #v(4pt)
      #box(
        fill: rgb("#f3f4f6"),
        inset: (x: 8pt, y: 3pt),
        radius: 4pt,
      )[#text(size: 8pt, fill: rgb("#374151"))[Plan: #d.customer_plan]]
    ]
  ],
  [
    #align(right)[
      #text(size: 8pt, fill: rgb("#6b7280"), weight: "bold")[INVOICE DETAILS]
      #v(4pt)
      #grid(
        columns: (auto, auto),
        gutter: (8pt, 4pt),
        align: (right, left),
        [#text(fill: rgb("#6b7280"))[Invoice Date:]], [#d.invoice_date],
        [#text(fill: rgb("#6b7280"))[Billing Period:]], [#d.billing_period],
        [#text(fill: rgb("#6b7280"))[Status:]],
        [#box(
          fill: if d.status == "paid" { rgb("#dcfce7") } else { rgb("#fee2e2") },
          inset: (x: 6pt, y: 2pt),
          radius: 3pt,
        )[#text(
          fill: status_color,
          weight: "bold",
          size: 8pt,
        )[#upper(d.status)]]],
      )
    ]
  ]
)

#v(16pt)

// ── Line items table ──────────────────────────────────────────────────────────
#block(width: 100%)[
  // Header row
  #block(
    fill: rgb("#f9fafb"),
    inset: (x: 10pt, y: 8pt),
    radius: (top-left: 6pt, top-right: 6pt),
    width: 100%,
  )[
    #grid(
      columns: (1fr, auto, auto, auto),
      gutter: 12pt,
      align: (left, center, right, right),
      [#text(weight: "bold", size: 8pt, fill: rgb("#374151"))[DESCRIPTION]],
      [#text(weight: "bold", size: 8pt, fill: rgb("#374151"))[QTY]],
      [#text(weight: "bold", size: 8pt, fill: rgb("#374151"))[UNIT PRICE]],
      [#text(weight: "bold", size: 8pt, fill: rgb("#374151"))[AMOUNT]],
    )
  ]

  // Line item rows
  #for (i, line) in d.line_items.enumerate() {
    block(
      fill: if calc.rem(i, 2) == 0 { white } else { rgb("#f9fafb") },
      inset: (x: 10pt, y: 8pt),
      width: 100%,
    )[
      #grid(
        columns: (1fr, auto, auto, auto),
        gutter: 12pt,
        align: (left, center, right, right),
        [
          #text(weight: "semibold")[#line.description]
          #if line.keys().contains("note") and line.note != "" [
            #v(1pt)
            #text(size: 8pt, fill: rgb("#6b7280"))[#line.note]
          ]
        ],
        [#str(line.quantity)],
        [#fmt_amount(line.unit_price_cents)],
        [#fmt_amount(line.amount_cents)],
      )
    ]
  }
]

#v(8pt)

// ── Totals ────────────────────────────────────────────────────────────────────
#align(right)[
  #block(width: 260pt)[
    #grid(
      columns: (1fr, auto),
      gutter: (0pt, 4pt),
      align: (left, right),
      [#text(fill: rgb("#6b7280"))][Subtotal],
      [#fmt_amount(d.subtotal_cents)],

      if d.keys().contains("gst_cents") and int(d.gst_cents) > 0 {(
        [#text(fill: rgb("#6b7280"))][GST (18%)],
        [#fmt_amount(d.gst_cents)],
      )} else {()},

      [],
      [],  // spacer

      [
        #line(length: 100%, stroke: 1pt + rgb("#1a1a1a"))
        #v(4pt)
        #text(weight: "bold", size: 12pt)[Total]
      ],
      [
        #line(length: 100%, stroke: 1pt + rgb("#1a1a1a"))
        #v(4pt)
        #text(weight: "bold", size: 12pt)[#fmt_amount(d.total_cents)]
      ],
    )
  ]
]

#v(16pt)

// ── PAID stamp (if applicable) ────────────────────────────────────────────────
#if d.status == "paid" {
  place(
    top + right,
    dx: -1.8cm,
    dy: -9cm,
    rotate(-25deg)[
      #box(
        stroke: 3pt + rgb("#16a34a"),
        inset: (x: 10pt, y: 6pt),
        radius: 4pt,
      )[
        #text(
          fill: rgb("#16a34a"),
          weight: "bold",
          size: 28pt,
        )[PAID]
      ]
    ]
  )
}

// ── Credits granted ───────────────────────────────────────────────────────────
#if d.keys().contains("credits_granted") and float(d.credits_granted) > 0 {
  block(
    fill: rgb("#eff6ff"),
    inset: (x: 12pt, y: 10pt),
    radius: 6pt,
    width: 100%,
  )[
    #grid(
      columns: (auto, 1fr),
      gutter: 10pt,
      align: horizon,
      [#text(size: 18pt)[⚡]],
      [
        #text(weight: "semibold", fill: rgb("#1e40af"))[
          #str(calc.round(float(d.credits_granted), digits: 0)) credits added to your AI-Tutor wallet
        ]
        #v(2pt)
        #text(size: 8pt, fill: rgb("#3b82f6"))[
          Credits are deducted per lesson generated. Promo credits are used first.
        ]
      ]
    )
  ]
  #v(12pt)
}

// ── Footer ────────────────────────────────────────────────────────────────────
#line(length: 100%, stroke: 0.5pt + rgb("#e5e7eb"))
#v(8pt)
#grid(
  columns: (1fr, auto),
  [
    #text(size: 8pt, fill: rgb("#9ca3af"))[
      AI-Tutor Platform · ai-tutor.com \
      This is a computer-generated invoice and does not require a physical signature.
    ]
  ],
  [
    #align(right)[
      #text(size: 8pt, fill: rgb("#9ca3af"))[
        Generated: #d.invoice_date \
        Invoice ID: #d.invoice_number
      ]
    ]
  ]
)
