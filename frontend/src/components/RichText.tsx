import type { ReactElement, ReactNode } from "react";
import { parseRichText, type InlineNode, type RichBlock } from "../lib/richText";

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "bold":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "italic":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline hover:text-primary-hover">
            {node.label}
          </a>
        );
    }
  });
}

function renderBlock(block: RichBlock, index: number): ReactElement {
  if (block.kind === "list") {
    return (
      <ul key={index} className="list-disc space-y-0.5 pl-5">
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex} className="whitespace-pre-wrap">
            {renderInline(item)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p key={index} className="whitespace-pre-wrap">
      {renderInline(block.children)}
    </p>
  );
}

export default function RichText({ text }: { text: string }): ReactElement {
  return <div className="space-y-1.5 break-words text-sm leading-6">{parseRichText(text).map(renderBlock)}</div>;
}
