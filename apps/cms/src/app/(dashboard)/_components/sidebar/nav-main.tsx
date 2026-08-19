"use client"

import { ChevronRight, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
} from "@platform/ui"
import { panelBorderStyle, ACTIVE_NAV_BACKGROUND } from "@/app/(dashboard)/_components/dashboard/liquid-glass"

export function NavMain({
    items,
}: {
    items: {
        title: string
        url: string
        icon?: LucideIcon
        isActive?: boolean
        items?: {
            title: string
            url: string
        }[]
    }[]
}) {
    const pathname = usePathname()

    return (
        <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarMenu>
                {items.map((item) => {
                    const isItemActive = item.url === "/" ? pathname === "/" : pathname?.startsWith(item.url)

                    if (item.items && item.items.length > 0) {
                        return (
                            <Collapsible
                                key={item.title}
                                asChild
                                defaultOpen={isItemActive || item.isActive}
                                className="group/collapsible"
                            >
                                <SidebarMenuItem>
                                    <CollapsibleTrigger asChild>
                                        <SidebarMenuButton
                                            tooltip={item.title}
                                            isActive={isItemActive}
                                            className={isItemActive ? "rounded-full border hover:bg-transparent" : "hover:bg-transparent"}
                                            style={isItemActive ? { ...panelBorderStyle("solid"), background: ACTIVE_NAV_BACKGROUND } : undefined}
                                        >
                                            {item.icon && <item.icon className="ml-2.5" />}
                                            <span className="text-base ml-2.5">{item.title}</span>
                                            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                        </SidebarMenuButton>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <SidebarMenuSub>
                                            {item.items.map((subItem) => {
                                                const isSubActive = pathname === subItem.url
                                                return (
                                                    <SidebarMenuSubItem key={subItem.title}>
                                                        <SidebarMenuSubButton asChild isActive={isSubActive}>
                                                            <Link href={subItem.url}>
                                                                <span className="text-base">{subItem.title}</span>
                                                            </Link>
                                                        </SidebarMenuSubButton>
                                                    </SidebarMenuSubItem>
                                                )
                                            })}
                                        </SidebarMenuSub>
                                    </CollapsibleContent>
                                </SidebarMenuItem>
                            </Collapsible>
                        )
                    }

                    const isThisActive = isItemActive || item.isActive

                    return (
                        <SidebarMenuItem key={item.title}>
                            <SidebarMenuButton
                                asChild
                                tooltip={item.title}
                                isActive={isThisActive}
                                className={isThisActive ? "rounded-full border hover:bg-transparent" : "hover:bg-transparent"}
                                style={isThisActive ? { ...panelBorderStyle("solid"), background: ACTIVE_NAV_BACKGROUND } : undefined}
                            >
                                <Link href={item.url}>
                                    {item.icon && <item.icon className="ml-2.5" />}
                                    <span className="text-base ml-1">{item.title}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    )
                })}
            </SidebarMenu>
        </SidebarGroup>
    )
}
