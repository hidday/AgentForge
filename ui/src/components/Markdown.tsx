import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils.ts";

interface MarkdownProps {
  children: string;
  className?: string;
}

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc pl-4 mb-2 last:mb-0 space-y-0.5 marker:text-text-muted">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-0.5 marker:text-text-muted">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-text-primary">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children, className: codeClass }) => {
    const isBlock = (codeClass ?? "").includes("language-");
    if (isBlock) {
      return (
        <code className="block rounded bg-surface-subtle/60 border border-border-subtle p-2 my-2 font-mono text-[11px] overflow-x-auto whitespace-pre">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-surface-subtle/60 border border-border-subtle px-1 py-0.5 font-mono text-[0.9em]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  ),
  h1: ({ children }) => (
    <h1 className="text-sm font-semibold mt-3 mb-1 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-semibold mt-3 mb-1 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-xs font-semibold mt-2 mb-1 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-xs font-semibold mt-2 mb-1 first:mt-0">{children}</h4>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-2 my-2 text-text-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2 border-border-subtle" />,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="text-[11px] border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border-subtle px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border-subtle px-2 py-1 align-top">{children}</td>
  ),
};

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn("text-text-secondary", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
