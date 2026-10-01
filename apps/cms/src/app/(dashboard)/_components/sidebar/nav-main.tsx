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
        <SidebarGroup className="px-4 group-data-[collapsible=icon]:px-2">
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarMenu>
                {items.map((item) => {
                    const isItemActive =
                        item.url === "/"
                            ? pathname === "/"
                            : pathname === item.url || pathname?.startsWith(`${item.url}/`)

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
                                            className="h-9 rounded-[0.625rem] px-2.5 group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:!mx-auto group-data-[collapsible=icon]:!justify-center group-data-[collapsible=icon]:[&>span]:hidden"
                                        >
                                            {item.icon && <item.icon className="size-4 shrink-0" />}
                                            <span className="text-sm font-medium">{item.title}</span>
                                            <ChevronRight className="ml-auto transition-transform group-data-[collapsible=icon]:hidden duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                        </SidebarMenuButton>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <SidebarMenuSub>
                                            {item.items.map((subItem) => {
                                                const isSubActive = pathname === subItem.url
                                                return (
                                                    <SidebarMenuSubItem key={subItem.title}>
                                                        <SidebarMenuSubButton asChild isActive={isSubActive} className="h-8 rounded-lg px-2.5">
                                                            <Link href={subItem.url}>
                                                                <span className="text-xs font-medium">{subItem.title}</span>
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
                                className="h-9 rounded-[0.625rem] px-2.5 group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:!mx-auto group-data-[collapsible=icon]:!justify-center group-data-[collapsible=icon]:[&>span]:hidden"
                            >
                                <Link href={item.url} className="flex items-center gap-3 w-full">
                                    {item.icon && <item.icon className="size-4 shrink-0" />}
                                    <span className="text-sm font-medium">{item.title}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    )
                })}
            </SidebarMenu>
        </SidebarGroup>
    )
}
