import { Toaster } from "@workspace/ui/components/sonner"
import { useTheme } from "@/components/theme-provider"

export function AppToaster() {
  const { theme } = useTheme()
  return <Toaster theme={theme} position="bottom-right" />
}
