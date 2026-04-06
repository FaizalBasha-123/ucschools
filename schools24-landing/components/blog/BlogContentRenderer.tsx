import React from 'react';

export type BlogBlock = {
  type: 'header' | 'paragraph' | 'hyperlink' | 'quote' | 'list';
  text?: string;
  url?: string;
  label?: string;
  level?: number;
};

interface BlogContentRendererProps {
  blocks: BlogBlock[];
}

export function estimateReadTime(title: string, excerpt: string, blocks: BlogBlock[]): number {
  const words = [
    title,
    excerpt,
    ...blocks.map((block) => `${block.text || ''} ${block.label || ''}`),
  ]
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return Math.max(1, Math.ceil(words / 180));
}

const BlogContentRenderer: React.FC<BlogContentRendererProps> = ({ blocks }) => {
  return (
    <div className="space-y-8">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;

        if (block.type === 'header') {
          const text = block.text?.trim() || 'Untitled section';
          if (block.level === 1) {
            return <h1 key={key} className="font-editorial-sans text-[2.1rem] font-extrabold tracking-[-0.04em] text-[#0d2346] md:text-[2.55rem]">{text}</h1>;
          }
          if (block.level === 3) {
            return <h3 key={key} className="font-editorial-sans text-[1.3rem] font-bold tracking-[-0.03em] text-[#0d2346] md:text-[1.45rem]">{text}</h3>;
          }
          return <h2 key={key} className="font-editorial-sans text-[1.75rem] font-extrabold tracking-[-0.04em] text-[#0d2346] md:text-[2rem]">{text}</h2>;
        }

        if (block.type === 'paragraph') {
          return <p key={key} className="font-editorial-serif text-[1.02rem] leading-[1.95] text-[#3e5476]">{block.text?.trim() || 'Content coming soon.'}</p>;
        }

        if (block.type === 'quote') {
          return (
            <blockquote key={key} className="border-l-[3px] border-[#9eb5da] pl-5 font-editorial-serif text-[1.12rem] leading-[1.9] italic text-[#26466f]">
              {block.text?.trim() || 'Quote coming soon.'}
            </blockquote>
          );
        }

        if (block.type === 'list') {
          const items = (block.text || '').split('\n').map((item) => item.trim()).filter(Boolean);
          return (
            <ul key={key} className="list-disc space-y-2.5 pl-6 font-editorial-serif text-[1.02rem] leading-[1.95] text-[#3e5476]">
              {(items.length > 0 ? items : ['List item']).map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }

        return (
          <a
            key={key}
            href={block.url?.trim() || '#'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center font-editorial-sans text-[0.95rem] font-semibold text-[#2b5fd7] underline underline-offset-4"
          >
            {block.label?.trim() || block.url?.trim() || 'Open link'}
          </a>
        );
      })}
    </div>
  );
};

export default BlogContentRenderer;
