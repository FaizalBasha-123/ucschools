import type { PublicBlogBlock } from "@/lib/public-blog"

type PublicBlogContentProps = {
  blocks: PublicBlogBlock[]
}

function normalizeUrl(value?: string) {
  const raw = value?.trim()
  if (!raw) return "#"
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw
  return `https://${raw}`
}

export function PublicBlogContent({ blocks }: PublicBlogContentProps) {
  return (
    <div className="space-y-6">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`

        if (block.type === "header") {
          const level = block.level || 2
          const text = block.text?.trim() || "Untitled section"

          if (level === 1) {
            return <h1 key={key} className="text-[2.2rem] font-extrabold leading-[1.05] tracking-[-0.05em] text-[#0d2346] md:text-[2.7rem]">{text}</h1>
          }
          if (level === 3) {
            return <h3 key={key} className="text-[1.22rem] font-bold leading-[1.3] tracking-[-0.03em] text-[#0d2346]">{text}</h3>
          }
          return <h2 key={key} className="text-[1.7rem] font-extrabold leading-[1.18] tracking-[-0.04em] text-[#0d2346]">{text}</h2>
        }

        if (block.type === "paragraph") {
          return (
            <p key={key} className="text-[1.02rem] leading-[1.95] text-[#445b7c]">
              {block.text?.trim() || "Start writing your paragraph here."}
            </p>
          )
        }

        if (block.type === "quote") {
          return (
            <blockquote key={key} className="border-l-[3px] border-[#a9bddf] pl-5 text-[1.06rem] italic leading-[1.9] text-[#2e4667]">
              {block.text?.trim() || "Add a quote."}
            </blockquote>
          )
        }

        if (block.type === "list") {
          const items = (block.text || "")
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean)

          return (
            <ul key={key} className="list-disc space-y-2.5 pl-6 text-[1.02rem] leading-[1.9] text-[#445b7c]">
              {(items.length > 0 ? items : ["List item"]).map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          )
        }

        return (
          <a
            key={key}
            href={normalizeUrl(block.url)}
            className="inline-flex items-center gap-2 text-sm font-bold text-[#1f59ff] underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            {block.label?.trim() || block.url?.trim() || "Link"}
          </a>
        )
      })}
    </div>
  )
}
