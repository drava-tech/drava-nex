import {
  FileSpreadsheetIcon,
  FileTextIcon,
  FileTypeIcon,
  ImageIcon,
  LinkIcon,
  PresentationIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react"
import type { MediaType } from "@workspace/types"

export const MEDIA_ICONS: Record<MediaType, LucideIcon> = {
  image: ImageIcon,
  video: VideoIcon,
  document: FileTextIcon,
  sheet: FileSpreadsheetIcon,
  presentation: PresentationIcon,
  word: FileTypeIcon,
  link: LinkIcon,
}

export const MEDIA_LABELS: Record<MediaType, string> = {
  image: "Image",
  video: "Video",
  document: "PDF",
  sheet: "Spreadsheet",
  presentation: "Slides",
  word: "Document",
  link: "Link",
}
