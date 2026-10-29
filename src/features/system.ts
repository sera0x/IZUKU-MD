import { arch, cpus, platform, totalmem } from 'node:os'

export function formatUptime(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000))
    const days = Math.floor(total / 86400)
    const hours = Math.floor((total % 86400) / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`, `${seconds}s`]
        .filter(Boolean)
        .join(' ')
}

export function memoryMb(bytes: number): number {
    return Math.round(bytes / 1024 / 1024)
}

export function memoryLine(): string {
    return `${memoryMb(process.memoryUsage().rss)}/${memoryMb(totalmem())}MB`
}

export function platformLabel(): string {
    return `${platform()} (${arch()})`
}

export function cpuCount(): number {
    return cpus().length
}

export function runtimeLabel(): string {
    const versions = process.versions as Record<string, string | undefined>
    return versions.bun ? `Bun ${versions.bun}` : `Node ${versions.node ?? 'unknown'}`
}

export function dateLines(now = new Date()): { time: string; day: string; date: string } {
    return {
        // Keep the menu header compact so it does not wrap on a phone.
        time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now),
        day: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now),
        date: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(now),
    }
}
