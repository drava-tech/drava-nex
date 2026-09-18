import { useState } from "react"
import { Loader2Icon, MonitorPlayIcon } from "lucide-react"
import { PAIRING_ALPHABET, PAIRING_CODE_LENGTH, type PairResponse } from "@workspace/types"

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@workspace/ui/components/input-otp"
import { api, ApiError } from "@/lib/api"
import { saveDevice } from "@/lib/device"

// Accept the alphabet in either case; the server upper-cases.
const PATTERN = `^[${PAIRING_ALPHABET}${PAIRING_ALPHABET.toLowerCase()}]*$`

/**
 * What an unpaired display shows: a large code entry an operator can type into
 * from across the room. Submits automatically on the sixth character.
 */
export function PairForm({ onPaired, notice }: { onPaired: (p: PairResponse) => void; notice?: string }) {
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(value: string) {
    setPending(true)
    setError(null)
    try {
      const paired = await api<PairResponse>("/api/pair", { method: "POST", json: { code: value } })
      saveDevice(paired)
      onPaired(paired)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "RATE_LIMITED"
          ? "Too many attempts. Wait a minute, then try again."
          : err instanceof ApiError && err.code === "NOT_FOUND"
            ? "That code is wrong or has expired. Ask for a new one."
            : "Couldn't reach the server. Check the network and try again."
      )
      setCode("")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="dark bg-background text-foreground flex min-h-svh flex-col items-center justify-center gap-10 p-8 text-center">
      <div className="flex items-center gap-3 text-2xl font-semibold">
        <div className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-lg">
          <MonitorPlayIcon className="size-6" />
        </div>
        Push
      </div>
      <div className="grid gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Pair this display</h1>
        <p className="text-muted-foreground text-lg">
          {notice ?? "In the console, open Screens → Pair display, and type the code shown there."}
        </p>
      </div>
      <InputOTP
        maxLength={PAIRING_CODE_LENGTH}
        pattern={PATTERN}
        value={code}
        disabled={pending}
        autoFocus
        aria-label="Pairing code"
        onChange={(v) => setCode(v.toUpperCase())}
        onComplete={(v) => void submit(v.toUpperCase())}
      >
        <InputOTPGroup>
          {Array.from({ length: PAIRING_CODE_LENGTH }, (_, i) => (
            <InputOTPSlot key={i} index={i} className="size-16 font-mono text-3xl md:size-20 md:text-4xl" />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <div className="h-6 text-lg" aria-live="polite">
        {pending ? (
          <span className="text-muted-foreground inline-flex items-center gap-2">
            <Loader2Icon className="size-5 animate-spin" /> Pairing…
          </span>
        ) : error ? (
          <span className="text-destructive" data-testid="pair-error">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  )
}
