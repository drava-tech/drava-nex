"use client";

import React from "react";
import { usePathname } from "next/navigation";
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
  "projects": "Experiences",
  "screens": "Screens",
  "media": "Media",
  "users": "Users",
  "settings": "Settings",
};

const toLabel = (segment: string) =>
  segment.charAt(0).toUpperCase() + segment.slice(1).replace(/[-_]/g, " ");

export function DashboardBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const breadcrumbs: { label: string; href: string }[] = [
    { label: "Dashboard", href: "/" },
  ];

  segments.forEach((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/");

    if (segment === "projects") {
      breadcrumbs.push({ label: "Experiences", href });
      return;
    }

    // Single-screen control page (/screen/<id>) reads as "Screens / <id>",
    // linking back to the Screens list.
    if (index === 0 && segment === "screen") {
      breadcrumbs.push({ label: "Screens", href: "/screens" });
      return;
    }

    // Segment[1]: project or portfolio slug
    if (index === 1 && segments[0] === "projects") {
      if (segment === "the-white-tusker-portfolio") {
        breadcrumbs.push({ label: "The White Tusker PORT-FOLIO", href });
      } else {
        breadcrumbs.push({ label: toLabel(segment), href });
      }
      return;
    }

    // Segment[2]: category ID under portfolio
    if (index === 2 && segments[1] === "the-white-tusker-portfolio") {
      breadcrumbs.push({ label: toLabel(segment), href });
      return;
    }

    // Segment[3]: project slug under portfolio category
    if (index === 3 && segments[1] === "the-white-tusker-portfolio") {
      breadcrumbs.push({ label: toLabel(segment), href });
      return;
    }

    // Segment[4+]: template sub-pages — title-case the slug
    breadcrumbs.push({ label: ROUTE_LABELS[segment] ?? toLabel(segment), href });
  });

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
                    <Link href={crumb.href}>{crumb.label}</Link>
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
