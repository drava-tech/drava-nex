"use client";

import React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@platform/ui";

const ROUTE_LABELS: Record<string, string> = {
  "projects": "Projects",
  "screens": "Screens",
  "media": "Media",
  "users": "Users",
  "settings": "Settings",
};

const SUB_PROJECT_LABELS: Record<string, string> = {
  "1": "The White Tusker PORT-FOLIO",
  "2": "Gamified Explainer Story",
  "3": "Human Aping",
  "4": "Analytics Dashboard (Digital Twin)",
  "5": "Object Recognition",
  "6": "Lego Kits",
  "7": "Assembly Simulator",
  "8": "EHS Training",
};

export function DashboardBreadcrumb() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const segments = pathname.split("/").filter(Boolean);

  const breadcrumbs = [
    { label: "Dashboard", href: "/" },
    ...segments.map((segment, index) => {
      const href = "/" + segments.slice(0, index + 1).join("/");
      const label = ROUTE_LABELS[segment] || (segment.charAt(0).toUpperCase() + segment.slice(1).replace(/[-_]/g, " "));
      return { label, href };
    })
  ];

  if (pathname.startsWith("/projects")) {
    const projectParam = searchParams.get("project");
    const dashboardParam = searchParams.get("dashboard");

    if (projectParam && SUB_PROJECT_LABELS[projectParam]) {
      breadcrumbs.push({
        label: SUB_PROJECT_LABELS[projectParam],
        href: `/projects?project=${projectParam}`
      });

      if (dashboardParam === "true") {
        breadcrumbs.push({
          label: "Experience Center",
          href: `/projects?project=${projectParam}&dashboard=true`
        });
      }
    }
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          return (
            <React.Fragment key={crumb.href}>
              {index > 0 && <BreadcrumbSeparator className="hidden md:block" />}
              <BreadcrumbItem className={index < breadcrumbs.length - 1 ? "hidden md:block" : ""}>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
