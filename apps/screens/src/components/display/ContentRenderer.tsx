import type { Content } from "@/types/display";
import { VideoRenderer } from "./VideoRenderer";

interface ContentRendererProps {
  content: Content;
}

/**
 * Switch-based dispatcher. Add new content types here as branches.
 * TypeScript exhaustive-check ensures all union members are handled.
 */
export function ContentRenderer({ content }: ContentRendererProps) {
  switch (content.type) {
    case "video":
      return <VideoRenderer content={content} />;

    // Future:
    // case "stream":
    //   return <StreamRenderer content={content} />;
    // case "experience":
    //   return <ExperienceRenderer content={content} />;

    default: {
      // Exhaustive check — TS will error if a union member is unhandled
      const _exhaustive = content as never;
      return (
        <div style={{ color: "#ef4444", padding: "2rem" }}>
          Unsupported content type: {(_exhaustive as Content).type}
        </div>
      );
    }
  }
}
