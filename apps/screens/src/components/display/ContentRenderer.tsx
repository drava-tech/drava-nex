import type { Content } from "@/types/display";
import { VideoRenderer } from "./VideoRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { HtmlRenderer } from "./HtmlRenderer";
import { StreamRenderer } from "./StreamRenderer";
import { ExperienceDisplay } from "./ExperienceDisplay";

export function ContentRenderer({ content, screenId }: { content: Content; screenId?: string }) {
  switch (content.type) {
    case "video":
      return <VideoRenderer content={content} />;
    case "image":
      return <ImageRenderer content={content} />;
    case "html":
      return <HtmlRenderer content={content} />;
    case "stream":
      return <StreamRenderer content={content} />;
    case "experience":
      return <ExperienceDisplay title={content.title} screenId={screenId} />;
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
