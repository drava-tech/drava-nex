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
  "broadcast": "Our Story",
  "screens": "Screens",
  "media": "Media",
  "users": "Users",
  "settings": "Settings",
  "schedules": "Schedules",
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

    // Whiteboards' live push route (/whiteboards/<id>/live/<deviceId>) is
    // the same board, just currently pushed to a screen — keep the trail
    // identical to /whiteboards/<id> instead of tacking on raw
    // "Live"/<deviceId> segments.
    if (segments[0] === "whiteboards" && segments[2] === "live" && index >= 2) {
      return;
    }

    if (segment === "projects") {
      breadcrumbs.push({ label: "Experiences", href });
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
    <Breadcrumb className="py-1">
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
