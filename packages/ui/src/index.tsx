"use client";

import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Monitor, MapPin, Tag } from "lucide-react";
import type { Screen } from "@platform/types";
import { cn } from "./lib/utils";
import { dispatchReplayableEvent, useReplayableWindowEvent, lastReplayableDetail } from "./lib/replayable-window-event";
import { useInView } from "./lib/use-in-view";

export { cn };
export { dispatchReplayableEvent, useReplayableWindowEvent, lastReplayableDetail };
export { useInView };

// ==========================================
// 1. SHADCN BUTTON
// ==========================================
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

// ==========================================
// 2. SHADCN BADGE
// ==========================================
export const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/85",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground border-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
};

// ==========================================
// 3. SHADCN CARD
// ==========================================
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      // min-w-0: a card inside a grid/flex row must be allowed to shrink
      // below its content's intrinsic width (e.g. an SVG chart sized only via
      // viewBox) — without it, that content's natural size can force the
      // whole row wider than the viewport, causing page-level horizontal scroll.
      "min-w-0 rounded-xl border bg-card text-card-foreground shadow-sm",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

// ==========================================
// 4. SCREEN COMPONENT IMPLEMENTATIONS
// ==========================================
export const StatusBadge = ({ status }: { status: Screen["status"] }) => {
  const colors = {
    online: "bg-[#4DDD00]/10 text-[#4DDD00] border-[#4DDD00]/30",
    offline: "bg-[#E21D3E]/10 text-[#E21D3E] border-[#E21D3E]/30",
    maintenance: "bg-[#FF3000]/10 text-[#FF3000] border-[#FF3000]/30",
  };

  const statusLabel = {
    online: "Online",
    offline: "Offline",
    maintenance: "Maintenance",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        colors[status]
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "online"
            ? "bg-[#4DDD00]"
            : status === "offline"
            ? "bg-[#E21D3E]"
            : "bg-[#FF2400]"
        )}
      />
      {statusLabel[status]}
    </span>
  );
};

export interface ScreenCardProps {
  screen: Screen;
  onClick?: () => void;
}

export const ScreenCard = ({ screen, onClick }: ScreenCardProps) => {
  return (
    <Card
      onClick={onClick}
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden transition-all duration-250 hover:-translate-y-0.5 hover:shadow-md border-border bg-card",
        onClick && "cursor-pointer"
      )}
    >
      <CardHeader className="p-5 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5 text-primary">
              <Monitor className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold tracking-tight text-foreground">
                {screen.name}
              </CardTitle>
              {screen.location && (
                <CardDescription className="flex items-center gap-1 mt-1 text-xs">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {screen.location}
                </CardDescription>
              )}
            </div>
          </div>
          <StatusBadge status={screen.status} />
        </div>
      </CardHeader>

      <CardContent className="px-5 py-2">
        <div className="flex flex-wrap gap-1.5">
          {screen.tags && screen.tags.length > 0 ? (
            screen.tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="text-[10px] font-medium tracking-wide px-2 py-0.5 flex items-center gap-1"
              >
                <Tag className="h-2.5 w-2.5 text-muted-foreground" />
                {tag}
              </Badge>
            ))
          ) : (
            <span className="text-[10px] text-muted-foreground italic">
              No tags
            </span>
          )}
        </div>
      </CardContent>

      <CardFooter className="mt-3 p-5 pt-3 border-t bg-muted/20 dark:bg-muted/10 text-xs text-muted-foreground flex justify-between items-center">
        <span className="font-mono text-[10px]">ID: {screen.id}</span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
          {screen.status === "online" ? "Active" : "Idle"}
        </span>
      </CardFooter>
    </Card>
  );
};

export interface VideoPlayerProps {
  url: string;
  className?: string;
}

export const VideoPlayer = ({ url, className = "" }: VideoPlayerProps) => {
  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl border bg-black shadow-inner",
        className
      )}
    >
      <video
        src={url}
        autoPlay
        muted
        loop
        className="h-full w-full object-cover"
      />
    </div>
  );
};

// UI Primitives
export * from "./components/ui/avatar";
export * from "./components/ui/breadcrumb";
export * from "./components/ui/collapsible";
export * from "./components/ui/dropdown-menu";
export * from "./components/ui/separator";
export * from "./components/ui/sheet";
export * from "./components/ui/sidebar";
export * from "./components/ui/table";
export * from "./components/ui/tooltip";
export { useIsMobile } from "./hooks/use-mobile";
