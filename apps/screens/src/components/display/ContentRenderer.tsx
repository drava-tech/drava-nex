import type { Content } from "@/types/display";
import { VideoRenderer } from "./VideoRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { HtmlRenderer } from "./HtmlRenderer";
import { StreamRenderer } from "./StreamRenderer";

export function ContentRenderer({ content }: { content: Content }) {
  switch (content.type) {
    case "video":
      return <VideoRenderer content={content} />;
    case "image":
      return <ImageRenderer content={content} />;
    case "html":
      return <HtmlRenderer content={content} />;
    case "stream":
      return <StreamRenderer content={content} />;
    default: {
      const _exhaustive = content as never;
      return (
        <div style={{ color: "#ef4444", padding: "2rem" }}>
          Unsupported content type: {(_exhaustive as Content).type}
        </div>
      );
    }
  }
}
