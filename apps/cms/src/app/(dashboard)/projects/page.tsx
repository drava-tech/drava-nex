import React from "react"
import { requireAdmin } from "@/lib/auth-helpers"
import { ProjectsGrid } from "./_components/projects-grid"

export default async function ProjectsPage() {
    await requireAdmin()
    return (
        <div className="flex flex-col p-6 md:p-8 bg-zinc-100 dark:bg-black h-[calc(100vh-56px)] overflow-hidden">
            <ProjectsGrid />
        </div>
    )
}


