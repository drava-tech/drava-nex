import { MonitorPlayIcon } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router"

import { LoginForm } from "@/components/login-form"
import { safeNext } from "@/lib/session"

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
            <MonitorPlayIcon className="size-4" />
          </div>
          Push
        </div>
        <LoginForm onSignedIn={() => navigate(safeNext(params.get("next")), { replace: true })} />
      </div>
    </div>
  )
}
