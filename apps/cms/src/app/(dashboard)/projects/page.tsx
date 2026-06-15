import React from "react"
import { requireAdmin } from "@/lib/auth-helpers"

const projects = [
    { id: 1, title: "The White Tusker\nPORT-FOLIO" },
    { id: 2, title: "Gamified\nExplainer Story" },
    { id: 3, title: "Human Aping" },
    { id: 4, title: "Analytics\nDashboard\n(Digital Twin)" },
    { id: 5, title: "Object\nRecognition" },
    { id: 6, title: "Lego Kits" },
    { id: 7, title: "Assembly\nSimulator" },
    { id: 8, title: "EHS Training" },
]

export default async function ProjectsPage() {
    await requireAdmin()
    return (
        <div className="flex flex-1 flex-col p-8 bg-zinc-100 dark:bg-black h-full">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6 w-full mx-auto">
                {projects.map((project) => (
                    <div
                        key={project.id}
                        className="group relative flex flex-col h-[350px] md:h-[400px] bg-[#d6d6d6] dark:bg-black dark:border dark:border-white/10 shadow-xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl dark:hover:border-white/30 p-8 pt-0"
                    >
                        {/* Large background number */}
                        <div className="text-[12rem] md:text-[14rem] font-light leading-none text-white dark:text-white/10 select-none pointer-events-none transition-colors duration-300 -mt-6 -ml-4">
                            {project.id}
                        </div>

                        {/* Text content positioned naturally below the number */}
                        <div className="relative z-10 mt-2">
                            <h3 className="text-xl md:text-2xl font-normal text-zinc-800 dark:text-white whitespace-pre-line leading-tight">
                                {project.title}
                            </h3>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
